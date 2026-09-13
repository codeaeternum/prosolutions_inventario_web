import { NextRequest, NextResponse } from "next/server"
import { encode, decode } from "next-auth/jwt"
import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkAndRecord } from "@/lib/rate-limit"

// Cambio rápido de usuario estilo POS: en una PC compartida el staff cambia de
// cuenta con su PIN sin cerrar sesión. ADMIN entra a cualquier cuenta sin PIN.
// Si alguien con sesión activa cambia a otra cuenta, guardamos `impersonator`
// en el token para ofrecer "Volver a mi cuenta" sin pedir PIN de regreso.

function sessionCookieName(req: NextRequest) {
  return req.nextUrl.protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token"
}

function passwordVersion(password: string | null) {
  return createHash("sha256").update(password ?? "").digest("hex")
}

async function mintSession(req: NextRequest, user: {
  id: string; name: string; email: string | null; phone: string | null;
  role: "ADMIN" | "EMPLOYEE" | "CUSTOMER" | "WORKSHOP"; status: string;
  customerType: "NORMAL" | "STORE" | "TECHNICIAN"; password: string | null;
  jobTitle: string | null; businessId: string
}, impersonator: string | null) {
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
      passwordVersion: passwordVersion(user.password),
      impersonator,
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

  const body = await req.json().catch(() => null) as { userId?: string; pin?: string; restore?: boolean } | null
  const cookieName = sessionCookieName(req)
  const rawCookie = req.cookies.get(cookieName)?.value
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ""

  let targetId = body?.userId
  let impersonator: string | null = caller.id

  // Restaurar: vuelve a la cuenta que originó el cambio, sin PIN.
  if (body?.restore) {
    const decoded = rawCookie && secret
      ? await decode({ token: rawCookie, secret, salt: cookieName }).catch(() => null)
      : null
    if (!decoded?.impersonator || typeof decoded.impersonator !== "string") {
      return NextResponse.json({ error: "No hay cuenta original a la que volver" }, { status: 400 })
    }
    targetId = decoded.impersonator
    impersonator = null
  }

  if (!targetId || typeof targetId !== "string" || targetId.length > 64) {
    return NextResponse.json({ error: "Usuario inválido" }, { status: 400 })
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  // Una cuenta de otra empresa responde igual que una inexistente: el cambio
  // rápido de usuario nunca cruza negocios.
  if (!target || target.businessId !== caller.businessId || target.status !== "APPROVED" || (target.role !== "ADMIN" && target.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Usuario no disponible" }, { status: 404 })
  }

  // Reglas: ADMIN entra a cualquier cuenta; staff necesita el PIN del destino.
  if (!body?.restore && caller.role !== "ADMIN" && target.id !== caller.id) {
    const pin = typeof body?.pin === "string" ? body.pin : ""
    if (!target.quickPin || !/^\d{4,6}$/.test(pin) || !(await bcrypt.compare(pin, target.quickPin))) {
      return NextResponse.json({ error: "PIN incorrecto" }, { status: 403 })
    }
  }

  const { token } = await mintSession(req, target, impersonator)
  const res = NextResponse.json({ ok: true, user: { id: target.id, name: target.name, role: target.role, jobTitle: target.jobTitle } })
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 30 * 24 * 60 * 60,
  })
  return res
}
