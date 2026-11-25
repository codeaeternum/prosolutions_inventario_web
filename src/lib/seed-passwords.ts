/**
 * Resolución de contraseñas para prisma/seed.ts (extraída para pruebas).
 *
 * Las cuentas admin/superadmin solo necesitan contraseña cuando se CREAN por
 * primera vez: el upsert de una cuenta existente no toca el password, así que
 * en corridas contra una BD ya sembrada las variables pueden omitirse (con
 * aviso). No hay contraseña por defecto — el fallback `admin123` dejaba la
 * instalación abierta a cualquiera que conociera el correo semilla.
 *
 * Devuelve la contraseña a sembrar, o null cuando la cuenta ya existe y no
 * hace falta. Lanza si la cuenta va a crearse sin contraseña explícita.
 */
export function resolveSeedPassword(
  envValue: string | undefined,
  envName: string,
  email: string,
  accountExists: boolean,
  warn: (message: string) => void = console.warn,
): string | null {
  const value = envValue?.trim() ?? ""
  if (value) return value
  if (accountExists) {
    warn(`[seed] ${envName} no definida: la cuenta ${email} ya existe — se conserva su contraseña actual.`)
    return null
  }
  throw new Error(
    `[seed] ${envName} es obligatoria para crear la cuenta ${email} por primera vez. ` +
    "No hay contraseña por defecto: exporta la variable de entorno y vuelve a correr el seed."
  )
}
