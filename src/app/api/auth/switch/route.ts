import { NextRequest, NextResponse } from "next/server"
import { encode, decode } from "next-auth/jwt"
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit"
import { checkAndRecord } from "@/lib/rate-limit"

// Cambio rápido de usuario estilo POS: en una PC compartida el staff cambia de
// cuenta con su PIN sin cerrar sesión. ADMIN entra a cualquier cuenta sin PIN.
// Si alguien con sesión activa cambia a otra cuenta, guardamos `impersonator`
// en el token para ofrecer "Volver a mi cuenta" sin pedir PIN de regreso.

function isSecureRequest(req: NextRequest) {
  return (
    req.nextUrl.protocol === "https:" ||
    (process.env.TRUST_PROXY_HEADERS === "true" && req.headers.get("x-forwarded-proto") === "https")
  )
}

function sessionCookieName(req: NextRequest) {
  return isSecureRequest(req) ? "__Secure-authjs.session-token" : "authjs.session-token"
}

function passwordVersion(password: string | null) {
  return createHash("sha256").update(password ?? "").digest("hex")
}

async function mintSession(req: NextRequest, user: {
  id: string; name: string; email: string | null; phone: string | null;
  role: "ADMIN" | "EMPLOYEE" | "CUSTOMER" | "WORKSHOP"; status: string;
  customerType: "NORMAL" | "STORE" | "TECHNICIAN"; password: string | null;
  jobTitle: string | null; businessId: string;
  isSuperAdmin?: boolean | null;
  allowedModules?: string[] | null;
  allowedBranchIds?: string[] | null;
}, impersonator: string | null, impersonatedAt: number | null) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET no configurado")
  const cookieName = sessionCookieName(req)
  const token = await encode({
    token: {
      id: user.id,
      name: user.name,
      email: user.email ?? user.phone ?? "",
      role: user.role,
      status: user.status,
      customerType: user.customerType,
      jobTitle: user.jobTitle,
      businessId: user.businessId,
      isSuperAdmin: user.isSuperAdmin ?? false,
      allowedModules: user.allowedModules ?? [],
      allowedBranchIds: user.allowedBranchIds ?? [],
      passwordVersion: passwordVersion(user.password),
      impersonator,
      // El JWT vive 30 días pero la impersonación caduca a las 8 h
      // (lib/session-policy) — el timestamp viaja firmado en la cookie.
      impersonatedAt,
    },
    secret,
    salt: cookieName,
    maxAge: 30 * 24 * 60 * 60,
  })
  return { cookieName, token }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const caller = session?.user
  if (!caller || (caller.role !== "ADMIN" && caller.role !== "EMPLOYEE") || caller.status !== "APPROVED") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  // Freno de fuerza bruta por sesión: 15 intentos de PIN cada 15 minutos.
  if (!checkAndRecord("switch-user", caller.id, 15 * 60 * 1000, 15)) {
    return NextResponse.json({ error: "Demasiados intentos, espera un momento" }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { userId?: string; pin?: string; restore?: boolean; reason?: string } | null
  // Motivo opcional del modo soporte (consola /platform): queda en el
  // PlatformEvent y en la bitácora del tenant — acotado a 200 chars.
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : ""
  const cookieName = sessionCookieName(req)
  const rawCookie = req.cookies.get(cookieName)?.value
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ""

  let targetId = body?.userId

  // Claim impersonator vigente (si la sesión actual YA era impersonada): se
  // necesita para el restore y queda en la bitácora como estado anterior.
  const decoded = rawCookie && secret
    ? await decode({ token: rawCookie, secret, salt: cookieName }).catch(() => null)
    : null
  const previousImpersonator = typeof decoded?.impersonator === "string" ? decoded.impersonator : null
  const previousImpersonatedAt = typeof decoded?.impersonatedAt === "number" ? decoded.impersonatedAt : null

  // Impersonación encadenada: si esta sesión YA era impersonada, "Volver a mi
  // cuenta" debe regresar al impersonador RAÍZ (el operador), no a la cuenta
  // intermedia — así el TTL también se mide desde la entrada original.
  let impersonator: string | null = previousImpersonator ?? caller.id

  // Restaurar: vuelve a la cuenta que originó el cambio, sin PIN.
  if (body?.restore) {
    if (!previousImpersonator) {
      return NextResponse.json({ error: "No hay cuenta original a la que volver" }, { status: 400 })
    }
    targetId = previousImpersonator
    impersonator = null
  }

  if (!targetId || typeof targetId !== "string" || targetId.length > 64) {
    return NextResponse.json({ error: "Usuario inválido" }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      customerType: true,
      password: true,
      jobTitle: true,
      businessId: true,
      isSuperAdmin: true,
      quickPin: true,
      allowedModules: true,
      allowedBranchIds: true,
      business: { select: { name: true, slug: true, isActive: true } },
    },
  })
  // El cambio rápido normal nunca cruza negocios. Excepción exclusiva:
  // un operador de plataforma (caller.isSuperAdmin === true) entrando en modo
  // soporte desde /platform, o volviendo (restore) a su cuenta superadmin.
  const canCrossTenant = caller.isSuperAdmin === true || Boolean(body?.restore && target?.isSuperAdmin === true)
  if (!target || (!canCrossTenant && target.businessId !== caller.businessId) || target.status !== "APPROVED" || (target.role !== "ADMIN" && target.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Usuario no disponible" }, { status: 404 })
  }

  // Negocio suspendido: mintear la sesión impersonada serviría de nada — el
  // siguiente request la revocaría (refreshSessionToken) y el OPERADOR
  // quedaría fuera, con su cookie original ya reemplazada. Los superadmins
  // sí sobreviven la suspensión de su propio tenant (restore a la consola).
  if (target.business?.isActive === false && target.isSuperAdmin !== true) {
    return NextResponse.json({ error: "El negocio está suspendido" }, { status: 409 })
  }

  // Reglas: ADMIN o Superadmin entran sin PIN; staff necesita el PIN del destino.
  if (!body?.restore && caller.role !== "ADMIN" && !caller.isSuperAdmin && target.id !== caller.id) {
    // El PIN nunca sube de privilegio: un quickPin de 4-6 dígitos se agota
    // por fuerza bruta dentro del rate limit, así que entrar a una cuenta
    // ADMIN (o de plataforma) exige el login con contraseña o que el propio
    // ADMIN inicie el cambio. El intento queda en bitácora — la molienda
    // de PIN contra cuentas admin deja de ser invisible. NUNCA se registra
    // el PIN, solo quién intentó contra qué cuenta.
    if (target.role === "ADMIN" || target.isSuperAdmin === true) {
      await recordAudit(prisma, {
        businessId: target.businessId,
        actorId: caller.id,
        action: "AUTH_SWITCH_DENIED",
        entity: "user",
        entityId: target.id,
        entityName: target.name,
        summary: `"${caller.name}" intentó entrar con PIN a la cuenta de administrador "${target.name}"`,
        changes: {
          cuenta: { before: caller.id, after: target.id },
          motivo: { before: null, after: "ESCALACION_POR_PIN_BLOQUEADA" },
        },
      })
      return NextResponse.json(
        { error: "Cambiar a una cuenta de administrador requiere su contraseña, no el PIN." },
        { status: 403 }
      )
    }
    const pin = typeof body?.pin === "string" ? body.pin : ""
    if (!target.quickPin || !/^\d{4,6}$/.test(pin) || !(await bcrypt.compare(pin, target.quickPin))) {
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 403 })
    }
  }

  // El TTL corre desde la entrada original: en una cadena de cambios
  // (op → caja → otra caja) se conserva el impersonatedAt vigente.
  const impersonatedAt = impersonator ? (previousImpersonatedAt ?? Date.now()) : null
  const { token } = await mintSession(req, target, impersonator, impersonatedAt)

  // Bitácora: el cambio de cuenta es un evento de acceso — quién operó como
  // quién. En el restore el actor real es la cuenta impersonadora (target):
  // la sesión venía trabajando como `caller` solo de forma prestada. NUNCA
  // se registra el PIN.
  await recordAudit(prisma, {
    businessId: body?.restore ? caller.businessId : target.businessId,
    actorId: body?.restore ? target.id : caller.id,
    action: body?.restore ? "AUTH_SWITCH_RESTORE" : "AUTH_SWITCH",
    entity: "user",
    entityId: target.id,
    entityName: target.name,
    summary: body?.restore
      ? `"${target.name}" volvió a su cuenta (la sesión operaba como "${caller.name}")`
      : `"${caller.name}" cambió a la cuenta "${target.name}"`,
    changes: {
      cuenta: { before: caller.id, after: target.id },
      impersonador: { before: previousImpersonator, after: impersonator },
      // El motivo declarado al entrar en modo soporte queda en el diff del
      // tenant (solo en AUTH_SWITCH; el restore no lleva reason).
      ...(reason && !body?.restore ? { motivo: { before: null, after: reason } } : {}),
    },
  })

  // Modo soporte de plataforma: cuando un superadmin entra o sale de la
  // cuenta de un tenant, deja rastro en PlatformEvent para el historial de
  // plataforma del negocio.
  if (!body?.restore && caller.isSuperAdmin === true && target.id !== caller.id) {
    try {
      await prisma.platformEvent?.create({
        data: {
          kind: "SUPPORT_ENTERED",
          businessId: target.businessId,
          businessSlug: target.business?.slug ?? "",
          businessName: target.business?.name ?? "",
          actorId: caller.id,
          actorEmail: caller.email ?? null,
          detail: {
            targetUserId: target.id,
            targetEmail: target.email ?? target.phone ?? null,
            ...(reason ? { reason } : {}),
          },
        },
      })
    } catch (error) {
      console.error("[auth/switch] No se pudo registrar SUPPORT_ENTERED:", error)
    }
    // Aviso visible al tenant: el dueño ve en su campana que un operador de
    // plataforma entró a su panel (y con qué motivo, si se declaró).
    // Notification.type es string libre — "support_access" se muestra con el
    // icono por defecto y sin navegación (solo marca leída).
    try {
      await prisma.notification?.create({
        data: {
          businessId: target.businessId,
          type: "support_access",
          audience: "ADMIN",
          title: "Acceso de soporte",
          message: reason
            ? `Un operador de soporte entró a tu panel. Motivo: ${reason}`
            : "Un operador de soporte entró a tu panel.",
          data: reason ? { reason } : undefined,
        },
      })
    } catch (error) {
      console.error("[auth/switch] No se pudo crear la notificación de acceso de soporte:", error)
    }
  } else if (body?.restore && target.isSuperAdmin === true) {
    try {
      const tenantBiz = await prisma.business
        ?.findUnique?.({
          where: { id: caller.businessId },
          select: { name: true, slug: true },
        })
        .catch(() => null)
      await prisma.platformEvent?.create({
        data: {
          kind: "SUPPORT_EXITED",
          businessId: caller.businessId,
          businessSlug: tenantBiz?.slug ?? "",
          businessName: tenantBiz?.name ?? "",
          actorId: target.id,
          actorEmail: target.email ?? null,
          detail: {
            targetUserId: caller.id,
            targetEmail: caller.email ?? null,
          },
        },
      })
    } catch (error) {
      console.error("[auth/switch] No se pudo registrar SUPPORT_EXITED:", error)
    }
  }

  const res = NextResponse.json({
    ok: true,
    user: {
      id: target.id,
      name: target.name,
      role: target.role,
      jobTitle: target.jobTitle,
      isSuperAdmin: target.isSuperAdmin ?? false,
    },
  })
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureRequest(req),
    maxAge: 30 * 24 * 60 * 60,
  })
  return res
}
