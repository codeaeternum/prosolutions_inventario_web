import { NextResponse } from "next/server"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { loadStatementByToken } from "@/lib/customer-statement"

// Estado de cuenta público del cliente por su statementToken (el token es el
// secreto; llega por WhatsApp). Respuesta limitada a lo que el documento
// muestra: nombre del negocio y del cliente, saldo/límite, movimientos y
// apartados — nunca businessId, ids internos, email, teléfono ni costos.
// 404 genérico si el token no existe: no revelar si es válido o no.
const NO_STORE = { "Cache-Control": "private, no-store" } as const
const NOT_FOUND = { error: "Estado de cuenta no encontrado." }
const EXPIRED = { error: "Este link ya no está vigente. Pide uno nuevo en la tienda." }
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 30

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!checkAndRecord("cuenta", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: NO_STORE },
      )
    }

    const { token } = await params
    const result = await loadStatementByToken(token)
    // 410 ≠ 404: la página muestra "link vencido, pide uno nuevo" en vez del
    // genérico de enlace inválido.
    if (result.kind === "not_found") return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    if (result.kind === "expired") return NextResponse.json(EXPIRED, { status: 410, headers: NO_STORE })
    return NextResponse.json({ statement: result.statement }, { headers: NO_STORE })
  } catch (error) {
    console.error("[cuenta] Error al consultar el estado de cuenta:", error)
    return NextResponse.json(
      { error: "No pudimos consultar el estado de cuenta. Intenta más tarde." },
      { status: 500, headers: NO_STORE },
    )
  }
}
