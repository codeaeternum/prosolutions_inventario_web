import { NextRequest } from "next/server"
import { handlers } from "@/lib/auth"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10

export const GET = handlers.GET

export async function POST(req: Request) {
  const url = new URL(req.url)
  const isCredentialsCallback =
    url.pathname.includes("callback/credentials") ||
    url.pathname.endsWith("nextauth") // POST al catch-all

  if (isCredentialsCallback) {
    const body = await req.text()
    const isLoginAttempt =
      body.includes("identifier") ||
      body.includes("credentials") ||
      body.includes("password")
    if (isLoginAttempt) {
      const ip = getClientIp(req)
      if (!checkAndRecord("login", ip, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS)) {
        return new Response(
          JSON.stringify({
            error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
          }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        )
      }
    }
    const nextReq = new NextRequest(req.url, { method: "POST", headers: req.headers, body })
    return handlers.POST(nextReq)
  }
  return handlers.POST(req as NextRequest)
}
