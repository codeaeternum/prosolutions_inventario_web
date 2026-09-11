import { NextRequest } from "next/server"
import { handlers } from "@/lib/auth"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

export const GET = handlers.GET
export async function POST(req: Request) {
  if (new URL(req.url).pathname.endsWith("/callback/credentials")) {
    // Count every callback regardless of body encoding, before parsing or password work.
    if (!checkAndRecord("login", getClientIp(req), 15 * 60 * 1000, 30)) {
      return Response.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429, headers: { "Retry-After": "900" } })
    }
    const size = Number(req.headers.get("content-length"))
    if (size > 16384) return new Response(null, { status: 413 })
  }
  return handlers.POST(req as NextRequest)
}
