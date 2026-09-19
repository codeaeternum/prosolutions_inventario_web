import { createHash } from "node:crypto"
import type { JWT } from "@auth/core/jwt"

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

/** A cookie proves identity; authorization always comes from the current database row. */
export function refreshSessionToken(token: JWT, current: CurrentUser | null, signingIn = false): JWT | null {
  if (!current || current.status === "REJECTED") return null
  // Empresa suspendida: revoca la sesión de sus usuarios en el próximo
  // request. Los superadmins de plataforma conservan acceso a la consola.
  if (current.business?.isActive === false && !current.isSuperAdmin) return null
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
