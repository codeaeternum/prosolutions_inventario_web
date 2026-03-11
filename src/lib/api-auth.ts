import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

/**
 * Helpers de autorización para Route Handlers.
 * Rutas que usan estos helpers: categories, products, inventory, brands, models,
 * settings, users, users/[id], reports, search, search/pos, notifications (telegram, send, stream),
 * reservations, reservations/[id], reservations/verify, admin/reservations/[id],
 * products/[id], products/excel. Usar requireAuth() para lógica owner/admin; requireAdmin()
 * o requireAdminOrEmployee() para rutas solo de panel.
 */

export type AuthResult =
  | { session: Awaited<ReturnType<typeof auth>>; error?: never }
  | { session?: never; error: NextResponse }

/** Tipo de sesión con user (evita conflicto de tipos en build con NextMiddleware). */
export type ApiSession = { user: { id: string; role: string; status: string; customerType?: string } }

/** Tras comprobar result.error, usar getSession(result) para obtener la sesión tipada. */
export function getSession(result: AuthResult): ApiSession | null {
  if (result.error) return null
  return result.session as unknown as ApiSession
}

/**
 * Exige sesión. Si no hay usuario logueado, devuelve 401.
 * Uso: const result = await requireAuth(); if (result.error) return result.error; const { session } = result;
 */
export async function requireAuth(): Promise<AuthResult> {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) }
  }
  return { session } as unknown as AuthResult
}

/**
 * Exige sesión y rol ADMIN. Para rutas solo de administradores.
 * Uso: const result = await requireAdmin(); if (result.error) return result.error; const { session } = result;
 */
export async function requireAdmin(): Promise<AuthResult> {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) }
  }
  if (session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }) }
  }
  return { session } as unknown as AuthResult
}

/**
 * Exige sesión y rol ADMIN o EMPLOYEE. Para rutas del panel que pueden usar empleados.
 * Uso: const result = await requireAdminOrEmployee(); if (result.error) return result.error; const { session } = result;
 */
export async function requireAdminOrEmployee(): Promise<AuthResult> {
  const session = await auth()
  if (!session?.user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) }
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "EMPLOYEE") {
    return { error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }) }
  }
  return { session } as unknown as AuthResult
}
