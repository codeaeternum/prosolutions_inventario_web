import { NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth"
import { hasBranchAccess, hasModule, type ModuleKey } from "@/lib/access"
import { PRINCIPAL_BRANCH_ID } from "@/lib/domain/operations"
import { prisma } from "@/lib/prisma"

export type ApiSession = Session
export type AuthResult = { session: ApiSession; error?: never } | { session?: never; error: NextResponse }
export function getSession(result: AuthResult): ApiSession | null { return result.error ? null : result.session }

export async function requireAuth(): Promise<AuthResult> {
  // auth's JWT callback refreshes role/status and revokes deleted/rejected/password-changed users.
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) }
  if (session.user.status !== "APPROVED") return { error: NextResponse.json({ error: "Cuenta pendiente de aprobación" }, { status: 403 }) }
  return { session }
}
async function requireRoles(roles: string[]): Promise<AuthResult> {
  const result = await requireAuth()
  if (result.error) return result
  if (!roles.includes(result.session.user.role)) return { error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }) }
  return result
}
export async function requireAdmin(): Promise<AuthResult> { return requireRoles(["ADMIN"]) }
export async function requireAdminOrEmployee(): Promise<AuthResult> { return requireRoles(["ADMIN", "EMPLOYEE"]) }

/**
 * Staff con el módulo asignado: mismo gate que requireAdminOrEmployee más la
 * restricción User.allowedModules (vacío = sin restricción; ADMIN siempre pasa).
 */
export async function requireModule(module: ModuleKey): Promise<AuthResult> {
  const result = await requireAdminOrEmployee()
  if (result.error) return result
  if (!hasModule(result.session.user, module)) {
    return { error: NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 }) }
  }
  return result
}

/** 403 si el usuario no puede operar el módulo; null cuando tiene acceso. */
export function assertModuleAllowed(session: ApiSession, module: ModuleKey): NextResponse | null {
  if (hasModule(session.user, module)) return null
  return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
}

/** 403 si el usuario no puede operar en la sucursal indicada; null cuando puede. */
export function assertBranchAllowed(session: ApiSession, branchId: string | null | undefined): NextResponse | null {
  if (hasBranchAccess(session.user, branchId)) return null
  return NextResponse.json({ error: "No tienes acceso a esta sucursal." }, { status: 403 })
}

/**
 * Verifica la sucursal EFECTIVA de una operación contra User.allowedBranchIds:
 * la que pidió el cliente o, si no llegó, la que usará el dominio como
 * respaldo (sucursal base del usuario y, en última instancia, la principal).
 * Así un empleado restringido no puede "omitir" branchId para caer en una
 * sucursal que no tiene asignada. `homeFallback: false` replica a los dominios
 * que no usan homeBranchId (inventario cae directo a la principal).
 */
export async function assertOperationBranch(
  session: ApiSession,
  requestedBranchId: string | null | undefined,
  opts: { homeFallback?: boolean } = {},
): Promise<NextResponse | null> {
  if (session.user.role === "ADMIN") return null
  const allowed = session.user.allowedBranchIds
  if (!allowed || allowed.length === 0) return null
  const businessId = session.user.businessId
  let branchId = requestedBranchId ?? null
  if (!branchId && opts.homeFallback !== false) {
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })
    branchId = me?.homeBranchId ?? null
  }
  if (!branchId) {
    const principal = await prisma.branch.findFirst({ where: { id: PRINCIPAL_BRANCH_ID, businessId }, select: { id: true } })
      ?? await prisma.branch.findFirst({ where: { businessId, isActive: true }, select: { id: true }, orderBy: { createdAt: "asc" } })
    branchId = principal?.id ?? null
  }
  return assertBranchAllowed(session, branchId)
}
export async function requireMarketplaceViewer(): Promise<AuthResult> { return requireRoles(["ADMIN", "EMPLOYEE", "WORKSHOP"]) }
/** Operador de plataforma: ve y administra TODAS las empresas (consola Reficio). */
export async function requireSuperAdmin(): Promise<AuthResult> {
  const result = await requireAuth()
  if (result.error) return result
  if (!result.session.user.isSuperAdmin) return { error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }) }
  return result
}
