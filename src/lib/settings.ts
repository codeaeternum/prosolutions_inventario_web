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

/**
 * Obtiene la configuración desde la BD. Si la tabla Settings no existe (P2021)
 * o hay error, devuelve valores por defecto.
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: "default" },
    })
    
    const bankTransferSetting = await prisma.systemSettings.findUnique({
        where: { key: "bank_transfer_info" }
    })
    
    const bankCashSetting = await prisma.systemSettings.findUnique({
        where: { key: "bank_cash_info" }
    })

    if (!row) return DEFAULT_SETTINGS
    return {
      tempReservationMinutes: row.tempReservationMinutes,
      depositPercentage: row.depositPercentage,
      depositReservationHours: row.depositReservationHours,
      pendingVerificationHours: row.pendingVerificationHours,
      exchangeRate: row.exchangeRate,
      bankTransferInfo: bankTransferSetting?.value || DEFAULT_SETTINGS.bankTransferInfo,
      bankCashInfo: bankCashSetting?.value || DEFAULT_SETTINGS.bankCashInfo
    }
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code: string }).code : null
    if (code === "P2021") {
      console.warn("[settings] Tabla Settings no existe. Ejecuta: npx prisma db push")
    }
    return DEFAULT_SETTINGS
  }
}
