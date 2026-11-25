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

  // TRUST_PROXY_HEADERS sin TRUST_PROXY_SECRET: los headers de IP del proxy
  // (CF-Connecting-IP / X-Forwarded-For) se honran de CUALQUIER peer que
  // alcance el origen — y la app también se publica en la LAN del taller
  // (:3005) para operación directa. Un equipo en la LAN puede forjar la IP
  // por request: abre buckets infinitos de rate-limit y siembra la IP falsa
  // en auditoría. No se bloquea el arranque: la app LAN de dev depende de
  // poder correr sin la Transform Rule de Cloudflare — pero el warning debe
  // ser imposible de ignorar en el log de arranque. Configuración documentada
  // en .env.docker.example (secreto + Transform Rule x-origin-secret).
  const trustProxy = getEnv("TRUST_PROXY_HEADERS")?.trim().toLowerCase() === "true"
  const proxySecret = getEnv("TRUST_PROXY_SECRET")?.trim()
  if (trustProxy && !proxySecret) {
    console.warn(
      "[env] ⚠ TRUST_PROXY_HEADERS=true sin TRUST_PROXY_SECRET: cualquier cliente que alcance " +
      "el origen (incluida la LAN :3005) puede forjar CF-Connecting-IP/X-Forwarded-For y esquivar " +
      "el rate limit por IP. Genera el secreto (openssl rand -hex 32), declara TRUST_PROXY_SECRET " +
      "y crea la Transform Rule de Cloudflare documentada en .env.docker.example."
    )
  }
}
