import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { safeRedirectPath } from "@/lib/safe-redirect"

// Destino post-login por rol. /login navega aquí (con ?next= cuando el flujo
// traía un callbackUrl explícito) y este handler decide la ruta real según la
// sesión — antes el fallback era "/" y todo usuario aterrizaba en la landing.
// Espeja la regla 4 de getAuthRedirect (auth.config.ts) para /login.
export async function GET(req: Request) {
  // En standalone req.url usa la dirección de bind (0.0.0.0:puerto), no el
  // Host real — el origen se reconstruye de los headers del proxy/cliente.
  const reqUrl = new URL(req.url)
  const proto = req.headers.get("x-forwarded-proto") ?? reqUrl.protocol.replace(/:$/, "")
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? reqUrl.host
  const origin = `${proto}://${host}`
  const session = await auth()

  // Un destino explícito y seguro (callbackUrl del login) gana sobre el rol.
  const next = reqUrl.searchParams.get("next")
  if (next) {
    return NextResponse.redirect(new URL(safeRedirectPath(next), origin))
  }

  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", origin))
  }

  const { role, status } = session.user
  let dest = "/pending"
  if (status === "APPROVED") {
    if (role === "ADMIN" || role === "EMPLOYEE") dest = "/admin"
    else if (role === "WORKSHOP") dest = "/admin/mercado"
    else dest = "/catalogo"
  }

  return NextResponse.redirect(new URL(dest, origin))
}
