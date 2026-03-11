import type { NextAuthConfig } from "next-auth"

// Definimos los tipos localmente para evitar problemas con Edge runtime
type UserRole = "ADMIN" | "CUSTOMER" | "EMPLOYEE"
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
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
      customerType: CustomerType
      status: UserStatus
    }
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string
    role: UserRole
    customerType: CustomerType
    status: UserStatus
  }
}

// Rutas públicas (no requieren login)
const PUBLIC_PATHS = ["/", "/login", "/register", "/api/auth", "/catalogo"]
// Rutas legacy que sin login redirigen a /?redirect=bot
const LEGACY_PATHS = ["/catalogo", "/carrito", "/mis-reservas", "/perfil"]
// Rutas protegidas (requieren login + approved, o admin)
const PROTECTED_PATHS = ["/mis-reservas", "/perfil", "/carrito"]

type AuthSession = { user?: { role: UserRole; status: UserStatus } } | null

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path)) ||
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
  const isLoggedIn = !!auth?.user
  const role = auth?.user?.role
  const status = auth?.user?.status
  const isAdmin = role === "ADMIN"
  const isEmployee = role === "EMPLOYEE"
  const isApproved = status === "APPROVED"
  const isPending = status === "PENDING"

  // 1) Rutas legacy sin login -> /?redirect=bot
  if (isLegacyPath(pathname) && !isLoggedIn) {
    const url = new URL("/", nextUrl)
    url.searchParams.set("redirect", "bot")
    return Response.redirect(url)
  }

  // 2) /admin: sin login -> /login; con login pero rol distinto de ADMIN/EMPLOYEE -> /
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return Response.redirect(new URL("/login", nextUrl))
    }
    if (role !== "ADMIN" && role !== "EMPLOYEE") {
      return Response.redirect(new URL("/", nextUrl))
    }
    
    // 2.1) EMPLOYEE restrictions
    if (role === "EMPLOYEE") {
      const restrictedForEmployee = ["/admin/usuarios", "/admin/credito", "/admin/reportes", "/admin/notificaciones", "/admin/configuracion"]
      if (restrictedForEmployee.some(path => pathname.startsWith(path))) {
        return Response.redirect(new URL("/admin", nextUrl))
      }
    }
    
    return null
  }

  // 3) Ruta protegida con auth pero no APPROVED y no ADMIN -> /pending
  if (isProtectedPath(pathname) && isLoggedIn && status !== "APPROVED" && role !== "ADMIN") {
    return Response.redirect(new URL("/pending", nextUrl))
  }

  // 4) /login o /register con auth: ADMIN -> /admin, APPROVED -> /catalogo, sino -> /pending
  if ((pathname === "/login" || pathname === "/register") && isLoggedIn) {
    if (isAdmin) return Response.redirect(new URL("/admin", nextUrl))
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
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.customerType = token.customerType
        session.user.status = token.status
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
