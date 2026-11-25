import { createHash } from "node:crypto"
import type { JWT } from "@auth/core/jwt"

// El resto de claims del JWT se declara en lib/auth.config.ts; éstos los
// escribe /api/auth/switch al mintear una sesión impersonada (epoch ms) y el
// refresco de sesión para el tope de operador de plataforma.
declare module "@auth/core/jwt" {
  interface JWT {
    impersonatedAt?: number | null
    /** Epoch ms en que arrancó la ventana de sesión superadmin (tope 10 h). */
    superAdminIat?: number | null
  }
}

export type CurrentUser = {
  id: string; email: string | null; phone: string | null; name: string;
  role: "ADMIN" | "EMPLOYEE" | "CUSTOMER" | "WORKSHOP";
  status: "PENDING" | "APPROVED" | "REJECTED";
  customerType: "NORMAL" | "STORE" | "TECHNICIAN"; password: string | null;
  jobTitle: string | null
  businessId: string
  isSuperAdmin: boolean
  /** Restricciones de staff: vacío = sin restricción (lib/access.ts). */
  allowedModules: string[]
  allowedBranchIds: string[]
  /** Cargada por auth.ts para revocar sesiones cuando la empresa se suspende. */
  business?: { isActive: boolean } | null
}

/**
 * La cookie JWT dura 30 días, pero operar "como" otra cuenta (cambio rápido
 * POS o modo soporte de /platform) se acota a un turno de ~8 h: pasado ese
 * tiempo la sesión cae a null como cualquier otra revocación. El operador
 * de soporte vuelve a entrar desde la consola si sigue haciendo falta.
 */
export const IMPERSONATION_TTL_MS = 8 * 60 * 60 * 1000

/**
 * Tope de la sesión de un operador de plataforma (isSuperAdmin): la cookie
 * dura 30 días como cualquier otra, pero una sesión superadmin viva ese
 * tiempo es demasiado poder para una cookie robada u olvidada en una PC —
 * pasadas 10 h la sesión cae a null y toca re-ingresar con contraseña. El
 * arranque de la ventana viaja firmado en el claim superAdminIat: se estampa
 * al entrar con contraseña y lo preserva /api/auth/switch a través del modo
 * soporte (cambiar de cuenta y volver NO reinicia el reloj). Si la cuenta se
 * eleva a superadmin con la sesión ya abierta, la ventana arranca en ese
 * refresh — la elevación exige escritura en BD, no la puede forjar el cliente.
 */
export const SUPERADMIN_SESSION_TTL_MS = 10 * 60 * 60 * 1000

/** A cookie proves identity; authorization always comes from the current database row. */
export function refreshSessionToken(token: JWT, current: CurrentUser | null, signingIn = false): JWT | null {
  if (!current || current.status === "REJECTED") return null
  // Empresa suspendida: revoca la sesión de sus usuarios en el próximo
  // request. Los superadmins de plataforma conservan acceso a la consola.
  if (current.business?.isActive === false && !current.isSuperAdmin) return null
  // Impersonación vencida: el claim impersonator sigue en el token pero su
  // timestamp ya superó el TTL — o el token es viejo y nunca lo tuvo (se
  // trata como expirado: volver a entrar es un cambio de un clic).
  if (token.impersonator) {
    const at = token.impersonatedAt
    if (typeof at !== "number" || !Number.isFinite(at) || Date.now() - at > IMPERSONATION_TTL_MS) {
      return null
    }
  }
  // Tope superadmin (ver SUPERADMIN_SESSION_TTL_MS). El claim se conserva en
  // tokens de NO superadmin sin tocarlo: la cadena de impersonación de un
  // operador lo trae consigo y el restore recupera el arranque original.
  let superAdminIat = token.superAdminIat ?? null
  if (current.isSuperAdmin) {
    const now = Date.now()
    if (signingIn || typeof superAdminIat !== "number" || !Number.isFinite(superAdminIat)) {
      superAdminIat = now
    }
    if (now - superAdminIat > SUPERADMIN_SESSION_TTL_MS) return null
  }
  const passwordVersion = createHash("sha256").update(current.password ?? "").digest("hex")
  // Old cookies without a credential version must sign in again once after this upgrade.
  if (!signingIn && token.passwordVersion !== passwordVersion) return null
  return {
    ...token, id: current.id, name: current.name, email: current.email ?? current.phone ?? "",
    role: current.role, status: current.status, customerType: current.customerType, passwordVersion,
    jobTitle: current.jobTitle, businessId: current.businessId, isSuperAdmin: current.isSuperAdmin,
    allowedModules: current.allowedModules, allowedBranchIds: current.allowedBranchIds,
    superAdminIat,
  }
}
