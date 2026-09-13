import { prisma } from "@/lib/prisma"

export const DEFAULT_SETTINGS = {
  tempReservationMinutes: 30,
  depositPercentage: 50,
  depositReservationHours: 48,
  pendingVerificationHours: 24,
  exchangeRate: 17.5,
  bankTransferInfo: "BBVA\nProSolutions SA\n0123456789",
  bankCashInfo: "OXXO\nJuan Pérez\n4152 3133 4444 5555"
}

export type AppSettings = typeof DEFAULT_SETTINGS

// ── Ajustes por empresa (SystemSettings quedó scoped por businessId) ──────────

/** Id del negocio semilla creado por la migración multi_tenant_foundation. */
export const DEFAULT_BUSINESS_ID = "biz-default"

/** Lee una llave de SystemSettings de un negocio. */
export async function getBusinessSetting(businessId: string, key: string): Promise<string | null> {
  const row = await prisma.systemSettings.findUnique({
    where: { businessId_key: { businessId, key } },
    select: { value: true },
  })
  return row?.value ?? null
}

/** Lee varias llaves de una vez. Devuelve mapa key→value. */
export async function getBusinessSettingsMap(
  businessId: string,
  keys: string[]
): Promise<Map<string, string>> {
  const rows = await prisma.systemSettings.findMany({
    where: { businessId, key: { in: keys } },
    select: { key: true, value: true },
  })
  return new Map(rows.map((r) => [r.key, r.value]))
}

/** Escribe una llave de SystemSettings del negocio. */
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
}

/**
 * Resuelve el negocio "por defecto" del deployment. Mientras Reficio corre en
 * modo single-tenant (una empresa por instancia) todos los ajustes apuntan a
 * él. La fase 2 del multi-tenant reemplaza los llamados por el businessId de
 * la sesión o del slug público.
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
 */
export async function getSettings(businessId?: string): Promise<AppSettings> {
  try {
    const biz = businessId ?? (await getDefaultBusinessId())
    const row = await prisma.settings.findFirst({
      where: { businessId: biz },
    })

    const kv = await getBusinessSettingsMap(biz, ["bank_transfer_info", "bank_cash_info"])
    const bankTransferSetting = kv.get("bank_transfer_info")
    const bankCashSetting = kv.get("bank_cash_info")

    if (!row) return DEFAULT_SETTINGS
    return {
      tempReservationMinutes: row.tempReservationMinutes,
      depositPercentage: row.depositPercentage,
      depositReservationHours: row.depositReservationHours,
      pendingVerificationHours: row.pendingVerificationHours,
      exchangeRate: row.exchangeRate,
      bankTransferInfo: bankTransferSetting || DEFAULT_SETTINGS.bankTransferInfo,
      bankCashInfo: bankCashSetting || DEFAULT_SETTINGS.bankCashInfo
    }
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code: string }).code : null
    if (code === "P2021") {
      console.warn("[settings] Tabla Settings no existe. Ejecuta: npx prisma db push")
    }
    return DEFAULT_SETTINGS
  }
}
