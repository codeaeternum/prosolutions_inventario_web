import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { ZodError } from "zod"
import { BusinessError } from "./operations"

// Logging estructurado de fallos de negocio: UNA línea JSON por fallo, pensada
// para los logs json-file de Docker (grep/jq sin multilínea). Nunca expone
// nada nuevo al cliente — las respuestas se mantienen byte a byte.
//
//   {"level":"error","event":"business_failure","requestId":"…","code":"…","errorName":"…","message":"…"}
//
// · requestId: el x-request-id que propagó src/proxy.ts (los route handlers lo
//   reciben en sus headers upstream). "si disponible": fuera de scope de
//   request (tests, scripts) headers() lanza y el log sale sin el campo.
// · message: primeras 200 chars — cota anti-PII/anti-secretos: los errores de
//   pg a veces incrustan valores de la fila en el texto (duplicate key…). No
//   loguear más contexto que ese recorte (nunca body, params ni stack aquí).
const MESSAGE_LOG_LIMIT = 200

async function currentRequestId(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id")
  } catch {
    return null // fuera de scope de request (tests unitarios, scripts, bot)
  }
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return error.name || "Error"
  return typeof error
}

function messagePreview(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Una línea física por fallo: colapsa saltos antes del recorte (JSON.stringify
  // escaparía \n pero el recorte debe medirse sobre lo legible).
  const flat = raw.replace(/\s*\n\s*/g, " ")
  return flat.length <= MESSAGE_LOG_LIMIT ? flat : flat.slice(0, MESSAGE_LOG_LIMIT)
}

function logBusinessFailure(level: "warn" | "error", requestId: string | null, code: string, error: unknown) {
  const line = JSON.stringify({
    level,
    event: "business_failure",
    ...(requestId ? { requestId } : {}),
    code,
    errorName: errorNameOf(error),
    message: messagePreview(error),
  })
  if (level === "error") console.error(line)
  else console.warn(line)
}

export async function businessFailure(error: unknown) {
  const requestId = await currentRequestId()
  if (error instanceof BusinessError) {
    // Fallo esperado de regla de negocio: el mensaje ya es user-facing (va en
    // la respuesta), log a nivel warn para rastro sin ruido de "error".
    logBusinessFailure("warn", requestId, error.code, error)
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    logBusinessFailure("warn", requestId, "VALIDATION", error)
    return NextResponse.json({ error: "Datos inválidos. Revisa cantidades, importes e identificador de operación." }, { status: 400 })
  }
  logBusinessFailure("error", requestId, error && typeof error === "object" && "code" in error ? String(error.code) : "UNEXPECTED", error)
  return NextResponse.json({ error: "No se confirmó la operación. Reintenta con el mismo identificador." }, { status: 500 })
}
