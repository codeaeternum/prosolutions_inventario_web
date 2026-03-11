/**
 * Se ejecuta una vez al arrancar el servidor Next.js.
 * Usado para validar env y, si aplica, otros inicializadores.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env")
    validateEnv()
  }
}
