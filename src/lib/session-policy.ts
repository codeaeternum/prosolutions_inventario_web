import { createHash } from "node:crypto"
import type { JWT } from "@auth/core/jwt"

// El resto de claims del JWT se declara en lib/auth.config.ts; éste lo escribe
// /api/auth/switch al mintear una sesión impersonada (epoch ms).
declare module "@auth/core/jwt" {
  interface JWT {
    impersonatedAt?: number | null
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
  const passwordVersion = createHash("sha256").update(current.password ?? "").digest("hex")
  // Old cookies without a credential version must sign in again once after this upgrade.
  if (!signingIn && token.passwordVersion !== passwordVersion) return null
  return {
    ...token, id: current.id, name: current.name, email: current.email ?? current.phone ?? "",
    role: current.role, status: current.status, customerType: current.customerType, passwordVersion,
    jobTitle: current.jobTitle, businessId: current.businessId, isSuperAdmin: current.isSuperAdmin,
    allowedModules: current.allowedModules, allowedBranchIds: current.allowedBranchIds,
  }
}
