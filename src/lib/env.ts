/**
 * Validación de variables de entorno al arranque.
 * En producción exige las necesarias para auth y BD; en desarrollo solo advierte.
 */

const requiredInProduction = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
] as const

const optionalButRecommended = [
  "CRON_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "DEVICE_SECRET_KEY",
] as const

function getEnv(name: string): string | undefined {
  return process.env[name]
}

/**
 * Valida que las variables críticas existan en producción.
 * Lanza si falta alguna; en desarrollo solo escribe advertencias en consola.
 */
export function validateEnv(): void {
  const isProduction = process.env.NODE_ENV === "production"

  for (const key of requiredInProduction) {
    const value = getEnv(key)
    if (!value || value.trim() === "") {
      if (isProduction) {
        throw new Error(
          `[env] ${key} es requerida en producción. Configure la variable de entorno.`
        )
      }
      console.warn(`[env] ${key} no está definida (recomendado en desarrollo).`)
    }
  }

  if (isProduction) {
    for (const key of optionalButRecommended) {
      const value = getEnv(key)
      if (!value || value.trim() === "") {
        console.warn(
          `[env] ${key} no está definida; algunas funciones (cron, bot, push) pueden no estar disponibles.`
        )
      }
    }
  }
}
