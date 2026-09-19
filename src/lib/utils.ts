import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  const d = new Date(date)
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Solo fecha (sin hora): para promesas de pago, vencimientos, etc. */
export function formatDay(date: Date | string): string {
  const d = new Date(date)
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(price)
}

/**
 * Normaliza un teléfono a sus últimos 10 dígitos para empalmar formatos
 * distintos del mismo número: "811 234 5678", "+52 811 234 5678" y
 * "+52 1 811 234 5678" terminan como "8112345678". Números cortos
 * (locales, extensiones) devuelven solo sus dígitos sin recortar.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  return digits.length > 10 ? digits.slice(-10) : digits
}

/**
 * Patrón de desbloqueo para humanos: se guarda como índices 0-8 ("0-4-8")
 * pero los puntos se cuentan 1-9 (esquina superior izquierda = 1). Devuelve
 * la cadena con cada punto +1 ("1-5-9"). Si el valor no es numérico se
 * devuelve tal cual (dato histórico o capturado a mano).
 */
export function formatAccessPattern(value: string): string {
  return value
    .split("-")
    .map(part => {
      const n = Number(part)
      return Number.isInteger(n) && n >= 0 && n <= 8 ? String(n + 1) : part
    })
    .join("-")
}

/**
 * Mayúsculas de nombre propio para la captura en mostrador:
 * "MARIA MARTINBEZ" → "Maria Martinbez". Conserva partículas con apóstrofe
 * ("O'Brien"), el "Mc" escocés ("McDonald") y los guiones ("Maria-Jose").
 * Se aplica al salir del campo (onBlur), no mientras se escribe.
 */
export function titleCaseName(value: string): string {
  const upper = (c: string) => c.toLocaleUpperCase("es-MX")
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(word =>
      word
        .split("-")
        .filter(Boolean)
        .map(part => {
          const lower = part.toLocaleLowerCase("es-MX")
          const titled = lower ? upper(lower.charAt(0)) + lower.slice(1) : lower
          return titled
            // O'Brien / D'Angelo: la letra tras el apóstrofe también es mayúscula.
            .replace(/'([a-záéíóúñü])/g, (_m, c: string) => `'${upper(c)}`)
            // McDonald: la "Mc" escocesa lleva mayúscula también en la 3ª letra.
            .replace(/^mc([a-záéíóúñü])/i, (_m, c: string) => `Mc${upper(c)}`)
        })
        .join("-"),
    )
    .join(" ")
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/(^-|-$)/g, "") // Remove leading/trailing hyphens
}
