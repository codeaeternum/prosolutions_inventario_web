import NextAuth from "next-auth"
import { authConfig, getAuthRedirect } from "@/lib/auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const redirect = getAuthRedirect(req.auth, req.nextUrl)
  if (redirect) return redirect
  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*|icons|uploads).*)",
  ],
}
