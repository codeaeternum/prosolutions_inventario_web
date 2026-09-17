import { safeRedirectPath } from "./safe-redirect"
import type { NextAuthConfig } from "next-auth"

// Definimos los tipos localmente para evitar problemas con Edge runtime
type UserRole = "ADMIN" | "CUSTOMER" | "EMPLOYEE" | "WORKSHOP"
type CustomerType = "TECHNICIAN" | "STORE" | "NORMAL"
type UserStatus = "PENDING" | "APPROVED" | "REJECTED"

declare module "next-auth" {
  interface User {
    id: string
    email: string
    name: string
    role: UserRole
    customerType: CustomerType
    status: UserStatus
    businessId: string
    isSuperAdmin?: boolean
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
      customerType: CustomerType
      status: UserStatus
      businessId: string
      isSuperAdmin?: boolean
      jobTitle?: string | null
      // Id del staff que inició esta sesión vía cambio rápido de usuario.
      impersonator?: string | null
    }
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string
    passwordVersion?: string
    role: UserRole
    customerType: CustomerType
    status: UserStatus
    businessId: string
    isSuperAdmin?: boolean
    jobTitle?: string | null
    impersonator?: string | null
  }
}

// Rutas públicas (no requieren login)
const PUBLIC_PATHS = ["/", "/login", "/register", "/registro", "/api/auth", "/api/signup", "/catalogo", "/mercado", "/seguimiento", "/evidencia", "/cotizacion"]
// Rutas legacy que sin login redirigen a /?redirect=bot
const LEGACY_PATHS = [ "/carrito", "/mis-reservas", "/perfil"]
// Rutas protegidas (requieren login + approved, o admin)
const PROTECTED_PATHS = ["/mis-reservas", "/perfil", "/carrito"]

type AuthSession = { user?: { role: UserRole; status: UserStatus; isSuperAdmin?: boolean } } | null

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`))) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/catalogo")
  )
}

function isLegacyPath(pathname: string): boolean {
  return LEGACY_PATHS.some((path) => pathname.startsWith(path))
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname.startsWith(path))
}

/**
 * Concentra toda la lógica de redirección de autenticación.
 * Devuelve Response (redirect) o null si la petición puede continuar.
 */
export function getAuthRedirect(
  auth: AuthSession,
  nextUrl: URL
): Response | null {
  const pathname = nextUrl.pathname
  // Route handlers return JSON authorization errors, never HTML redirects.
  if (pathname.startsWith("/api/")) return null
  const isLoggedIn = !!auth?.user
  const role = auth?.user?.role
  const status = auth?.user?.status
  const isAdmin = role === "ADMIN"
  const isApproved = status === "APPROVED"
  const isPending = status === "PENDING"

  // 1) Rutas legacy sin login -> /?redirect=bot
  if (isLegacyPath(pathname) && !isLoggedIn) {
    const url = new URL("/", nextUrl)
    url.searchParams.set("redirect", "bot")
    return Response.redirect(url)
  }

  // 2) /admin: sin login -> /login; con login pero rol distinto de ADMIN/EMPLOYEE/WORKSHOP -> /
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/login", nextUrl))
    }
    if (status !== "APPROVED") return Response.redirect(new URL("/pending", nextUrl))
    if (role !== "ADMIN" && role !== "EMPLOYEE" && role !== "WORKSHOP") {
      return Response.redirect(new URL("/", nextUrl))
    }

    // 2.1) WORKSHOP: taller aliado externo; solo puede ver el Mercado B2B.
    if (role === "WORKSHOP") {
      if (!pathname.startsWith("/admin/mercado")) {
        return Response.redirect(new URL("/admin/mercado", nextUrl))
      }
      return null
    }

    // 2.2) EMPLOYEE restrictions
    if (role === "EMPLOYEE") {
      const restrictedForEmployee = ["/admin/usuarios", "/admin/credito", "/admin/reportes", "/admin/notificaciones", "/admin/configuracion"]
      if (restrictedForEmployee.some(path => pathname.startsWith(path))) {
        return Response.redirect(new URL("/admin", nextUrl))
      }
    }
    
    return null
  }

  // 2.3) /platform: consola de plataforma; exige login aprobado + superadmin.
  // La página también lo valida server-side por si el middleware no corre.
  if (pathname.startsWith("/platform")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/login", nextUrl))
    }
    if (status !== "APPROVED") return Response.redirect(new URL("/pending", nextUrl))
    if (!auth?.user?.isSuperAdmin) {
      return Response.redirect(new URL("/", nextUrl))
    }
    return null
  }

  // 3) Ruta protegida con auth pero no APPROVED y no ADMIN -> /pending
  if (isProtectedPath(pathname) && isLoggedIn && status !== "APPROVED") {
    return Response.redirect(new URL("/pending", nextUrl))
  }

  // 4) /login o /register con auth: ADMIN -> /admin, WORKSHOP -> /admin/mercado, APPROVED -> /catalogo, sino -> /pending
  if ((pathname === "/login" || pathname === "/register") && isLoggedIn) {
    if (isAdmin && isApproved) return Response.redirect(new URL("/admin", nextUrl))
    if (role === "WORKSHOP" && isApproved) return Response.redirect(new URL("/admin/mercado", nextUrl))
    if (isApproved) return Response.redirect(new URL("/catalogo", nextUrl))
    return Response.redirect(new URL("/pending", nextUrl))
  }

  // 5) Logueado y pending, y no es ruta pública ni /pending -> /pending
  if (isLoggedIn && isPending && !isPublicPath(pathname) && pathname !== "/pending") {
    return Response.redirect(new URL("/pending", nextUrl))
  }

  return null
}

// Configuración base de auth que puede ser usada en Edge runtime
export const authConfig: NextAuthConfig = {
  providers: [], // Se agregan en auth.ts
  callbacks: {
    async redirect({ url, baseUrl }) {
      const relative = url.startsWith(`${baseUrl}/`) ? url.slice(baseUrl.length) : url
      return new URL(safeRedirectPath(relative), baseUrl).toString()
    },
    authorized({ auth, request: { nextUrl } }) {
      const redirect = getAuthRedirect(auth, nextUrl)
      if (redirect) return redirect
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.customerType = user.customerType
        token.status = user.status
        token.businessId = user.businessId
        token.isSuperAdmin = user.isSuperAdmin ?? false
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.customerType = token.customerType
        session.user.status = token.status
        session.user.businessId = token.businessId
        session.user.isSuperAdmin = token.isSuperAdmin ?? false
        session.user.jobTitle = token.jobTitle ?? null
        session.user.impersonator = token.impersonator ?? null
      }
      return session
    }
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  trustHost: true,
}
