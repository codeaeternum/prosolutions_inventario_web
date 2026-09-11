import { auth } from "@/lib/auth"
import { getAuthRedirect } from "@/lib/auth.config"
import { NextResponse } from "next/server"

export default auth((req) => {
  const pathname = req.nextUrl.pathname
  // Intercept legacy public files BEFORE Next's static file handler, including file extensions.
  if (pathname.startsWith("/uploads/payments/")) {
    if (!req.auth?.user || req.auth.user.status !== "APPROVED") return new NextResponse(null, { status: 401, headers: { "Cache-Control": "private, no-store" } })
    const target = req.nextUrl.clone()
    target.pathname = pathname.replace("/uploads/payments/", "/api/payment-proofs/")
    return NextResponse.rewrite(target)
  }
  // Proof images must never be cached or fetched without the authenticated file handler.
  if (pathname === "/_next/image") {
    let imageUrl = req.nextUrl.searchParams.get("url") ?? ""
    try { imageUrl = decodeURIComponent(imageUrl) } catch { return new NextResponse(null, { status: 400 }) }
    if (imageUrl.includes("/uploads/payments/") || imageUrl.includes("/api/payment-proofs/")) return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } })
    return NextResponse.next()
  }
  const redirect = getAuthRedirect(req.auth, req.nextUrl)
  return redirect ?? NextResponse.next()
})

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*|icons|uploads).*)", "/uploads/payments/:path*", "/_next/image"],
}
