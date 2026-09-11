import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { BusinessError } from "./operations"

export function businessFailure(error: unknown) {
  if (error instanceof BusinessError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Datos inválidos. Revisa cantidades, importes e identificador de operación." }, { status: 400 })
  console.error("Business operation failed", { code: error && typeof error === "object" && "code" in error ? error.code : "UNEXPECTED" })
  return NextResponse.json({ error: "No se confirmó la operación. Reintenta con el mismo identificador." }, { status: 500 })
}
