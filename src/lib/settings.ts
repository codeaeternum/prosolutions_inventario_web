import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { ORDER_FOLIO_DIGITS_KEY, parseFolioDigits } from "@/lib/workshop-labels"

export const DEFAULT_SETTINGS = {
  tempReservationMinutes: 30,
  depositPercentage: 50,
  depositReservationHours: 48,
  pendingVerificationHours: 24,
  exchangeRate: 17.5,
  // Vacíos a propósito: un tenant nuevo no debe mostrar la cuenta/CLABE de
  // otro negocio. El admin los captura en /admin/configuracion.
  bankTransferInfo: "",
  bankCashInfo: ""
}

export type AppSettings = typeof DEFAULT_SETTINGS

// ── Ajustes por empresa (SystemSettings quedó scoped por businessId) ──────────

/** Id del negocio semilla creado por la migración multi_tenant_foundation. */
export const DEFAULT_BUSINESS_ID = "biz-default"

// ── Caché en memoria de las lecturas de ajustes ───────────────────────────────
// Rutas públicas (vitrina, seguimiento, cotización), tickets y el bot leen las
// mismas llaves en cada request/comando: un TTL corto (30 s) amortiza esas
// lecturas sin sacrificar frescura apreciable.
//
// SOLO se usa fuera de transacción. Cuando el llamador pasa `tx` (lector con
// los delegates de la transacción) SIEMPRE se lee fresco y nada se escribe al
// caché: una tx puede ver escritos aún no commiteados y un valor cacheado del
// cliente global la contaminaría — y al revés, un valor leído dentro de la tx
// tampoco debe quedar cacheado para lecturas de fuera.
const SETTINGS_CACHE_TTL_MS = 30_000

type CacheEntry = { value: unknown; expiresAt: number }
const settingsCache = new Map<string, CacheEntry>()

/** Vacía la caché de ajustes. Solo para tests (aisla casos entre sí). */
export function resetSettingsCacheForTests(): void {
  settingsCache.clear()
}

function cachedGet<T>(key: string): { hit: boolean; value: T | null } {
  const entry = settingsCache.get(key)
  if (!entry) return { hit: false, value: null }
  if (entry.expiresAt <= Date.now()) {
    settingsCache.delete(key)
    return { hit: false, value: null }
  }
  return { hit: true, value: entry.value as T | null }
}

function cachedSet(key: string, value: unknown): void {
  settingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS })
}

const settingCacheKey = (businessId: string, key: string) => `ss:${businessId}:${key}`
const appSettingsCacheKey = (businessId: string) => `app:${businessId}`

/** Lector mínimo de SystemSettings: lo cumplen el cliente global `prisma` y
 *  el tx de las operaciones (Prisma.TransactionClient). */
type SystemSettingsReader = Pick<Prisma.TransactionClient, "systemSettings">

/** Lector mínimo para getSettings (Settings + SystemSettings). */
type SettingsReader = Pick<Prisma.TransactionClient, "settings" | "systemSettings">

/** Lee una llave de SystemSettings de un negocio. */
export async function getBusinessSetting(
  businessId: string,
  key: string,
  tx?: SystemSettingsReader
): Promise<string | null> {
  const cacheKey = settingCacheKey(businessId, key)
  if (!tx) {
    const hit = cachedGet<string>(cacheKey)
    if (hit.hit) return hit.value
  }
  const row = await (tx ?? prisma).systemSettings.findUnique({
    where: { businessId_key: { businessId, key } },
    select: { value: true },
  })
  const value = row?.value ?? null
  // La ausencia también se cachea: una llave inexistente no re-consulta
  // durante el TTL (caso común de llaves opcionales nunca escritas).
  if (!tx) cachedSet(cacheKey, value)
  return value
}

/** Lee varias llaves de una vez. Devuelve mapa key→value (las ausentes no
 *  aparecen). Fuera de tx consulta solo las llaves no cacheadas: mezclar
 *  llamadas con distintos sets de llaves comparte las entradas ya leídas. */
export async function getBusinessSettingsMap(
  businessId: string,
  keys: string[],
  tx?: SystemSettingsReader
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const pending: string[] = []
  for (const key of keys) {
    if (!tx) {
      const hit = cachedGet<string>(settingCacheKey(businessId, key))
      if (hit.hit) {
        if (hit.value != null) result.set(key, hit.value)
        continue
      }
    }
    pending.push(key)
  }
  if (pending.length === 0) return result

  const rows = await (tx ?? prisma).systemSettings.findMany({
    where: { businessId, key: { in: pending } },
    select: { key: true, value: true },
  })
  const found = new Map(rows.map((r) => [r.key, r.value]))
  for (const key of pending) {
    const value = found.get(key) ?? null
    if (value != null) result.set(key, value)
    if (!tx) cachedSet(settingCacheKey(businessId, key), value)
  }
  return result
}

/** Dígitos del consecutivo del folio de taller del negocio
 *  (SystemSettings `order_folio_digits`: 4–8, default 6). Una llave ausente,
 *  valor inválido o falla de lectura cae al default — el folio siempre sale. */
export async function getOrderFolioDigits(
  businessId: string,
  tx?: SystemSettingsReader
): Promise<number> {
  const raw = await getBusinessSetting(businessId, ORDER_FOLIO_DIGITS_KEY, tx).catch(() => null)
  return parseFolioDigits(raw)
}

/** Escribe una llave de SystemSettings del negocio e invalida sus entradas
 *  de caché (la lectura siguiente del proceso ve el valor nuevo sin esperar
 *  al TTL; escritos de OTROS procesos los cubre la expiración de 30 s). */
export async function setBusinessSetting(
  businessId: string,
  key: string,
  value: string,
  type = "STRING"
): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { businessId_key: { businessId, key } },
    update: { value, type },
    create: { businessId, key, value, type },
  })
  settingsCache.delete(settingCacheKey(businessId, key))
  settingsCache.delete(appSettingsCacheKey(businessId))
}

/**
 * Resuelve el negocio "por defecto" del deployment. Mientras Reficio corre en
 * modo single-tenant (una empresa por instancia) todos los ajustes apuntan a
 * él. La fase 2 del multi-tenant reemplaza los llamados por el businessId de
 * la sesión o del slug público.
 *
 * A propósito SIN caché: alta/baja del primer negocio o cambios de isActive
 * se reflejan de inmediato (la lectura es un findFirst barato e indexado).
 */
export async function getDefaultBusinessId(): Promise<string> {
  const first = await prisma.business.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  return first?.id ?? DEFAULT_BUSINESS_ID
}

/**
 * Obtiene la configuración desde la BD. Si la tabla Settings no existe (P2021)
 * o hay error, devuelve valores por defecto.
 *
 * Con businessId de sesión hace solo 2 queries (settings.findFirst +
 * systemSettings.findMany) y NO toca getDefaultBusinessId; sin él resuelve el
 * tenant primero. Fuera de tx el resultado se cachea 30 s por negocio.
 */
export async function getSettings(businessId?: string, tx?: SettingsReader): Promise<AppSettings> {
  try {
    const biz = businessId ?? (await getDefaultBusinessId())
    const cacheKey = appSettingsCacheKey(biz)
    if (!tx) {
      const hit = cachedGet<AppSettings>(cacheKey)
      // Copia superficial: el objeto cacheado no se comparte con el caller,
      // que podría mutarlo y envenenar la caché.
      if (hit.hit && hit.value) return { ...hit.value }
    }

    const db = tx ?? prisma
    const [row, kv] = await Promise.all([
      db.settings.findFirst({
        where: { businessId: biz },
      }),
      db.systemSettings.findMany({
        where: { businessId: biz, key: { in: ["bank_transfer_info", "bank_cash_info"] } },
        select: { key: true, value: true },
      }),
    ])
    const bankByKey = new Map(kv.map((r) => [r.key, r.value]))

    const settings: AppSettings = !row
      ? DEFAULT_SETTINGS
      : {
          tempReservationMinutes: row.tempReservationMinutes,
          depositPercentage: row.depositPercentage,
          depositReservationHours: row.depositReservationHours,
          pendingVerificationHours: row.pendingVerificationHours,
          exchangeRate: row.exchangeRate,
          bankTransferInfo: bankByKey.get("bank_transfer_info") || DEFAULT_SETTINGS.bankTransferInfo,
          bankCashInfo: bankByKey.get("bank_cash_info") || DEFAULT_SETTINGS.bankCashInfo
        }
    // Se cachea una copia: el objeto devuelto lo puede mutar el caller y no
    // debe envenenar la entrada.
    if (!tx) cachedSet(cacheKey, { ...settings })
    return settings
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code: string }).code : null
    if (code === "P2021") {
      console.warn("[settings] Tabla Settings no existe. Ejecuta: npx prisma db push")
    }
    return DEFAULT_SETTINGS
  }
}
