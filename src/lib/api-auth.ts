import { NextResponse } from "next/server"
import type { Session } from "next-auth"
import { auth } from "@/lib/auth"

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
