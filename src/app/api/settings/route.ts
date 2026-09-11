import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_SETTINGS as DEFAULTS } from "@/lib/settings"

const DEFAULT_SETTINGS = {
  id: "default",
  ...DEFAULTS,
  updatedAt: new Date().toISOString(),
}

// GET - Obtener configuración
export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: "default" },
    })

    // Si no existe, crear con valores por defecto
    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: "default",
          tempReservationMinutes: DEFAULTS.tempReservationMinutes,
          depositPercentage: DEFAULTS.depositPercentage,
          depositReservationHours: DEFAULTS.depositReservationHours,
          pendingVerificationHours: DEFAULTS.pendingVerificationHours,
          exchangeRate: DEFAULTS.exchangeRate,
        },
      })
    }

    const bankTransferInfoSetting = await prisma.systemSettings.findUnique({
      where: { key: "bank_transfer_info" }
    })
    
    const bankCashInfoSetting = await prisma.systemSettings.findUnique({
      where: { key: "bank_cash_info" }
    })

    const ticketBusinessName = await prisma.systemSettings.findUnique({
      where: { key: "ticket_business_name" }
    })
    const ticketSubtitle = await prisma.systemSettings.findUnique({
      where: { key: "ticket_subtitle" }
    })
    const ticketFooter = await prisma.systemSettings.findUnique({
      where: { key: "ticket_footer" }
    })

    return NextResponse.json({
      ...settings,
      bankTransferInfo: bankTransferInfoSetting?.value || DEFAULTS.bankTransferInfo,
      bankCashInfo: bankCashInfoSetting?.value || DEFAULTS.bankCashInfo,
      ticketBusinessName: ticketBusinessName?.value || "PROSOLUTIONS",
      ticketSubtitle: ticketSubtitle?.value || "Venta de refacciones y\nReparación profesional",
      ticketFooter: ticketFooter?.value || "¡Gracias por tu preferencia!",
    })
  } catch (error: unknown) {
    // Tabla Settings no existe (P2021): devolver valores por defecto hasta que se ejecute prisma db push
    const isPrisma = error && typeof error === "object" && "code" in error
    if (isPrisma && (error as { code: string }).code === "P2021") {
      console.warn("[settings] Tabla Settings no existe. Ejecuta: npx prisma db push")
      return NextResponse.json(DEFAULT_SETTINGS)
    }
    console.error("Error fetching settings:", error)
    return NextResponse.json(
      { error: "Error al obtener configuración" },
      { status: 500 }
    )
  }
}

// PATCH - Actualizar configuración (solo admin)
export async function PATCH(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const body = await req.json()
    const {
      tempReservationMinutes,
      depositPercentage,
      depositReservationHours,
      pendingVerificationHours,
      exchangeRate,
      bankTransferInfo,
      bankCashInfo,
      ticketBusinessName,
      ticketSubtitle,
      ticketFooter,
    } = body

    const settings = await prisma.settings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        tempReservationMinutes: tempReservationMinutes ?? 30,
        depositPercentage: depositPercentage ?? 50,
        depositReservationHours: depositReservationHours ?? 48,
        pendingVerificationHours: pendingVerificationHours ?? 24,
        exchangeRate: exchangeRate ?? 17.50,
      },
      update: {
        ...(tempReservationMinutes !== undefined && { tempReservationMinutes }),
        ...(depositPercentage !== undefined && { depositPercentage }),
        ...(depositReservationHours !== undefined && { depositReservationHours }),
        ...(pendingVerificationHours !== undefined && { pendingVerificationHours }),
        ...(exchangeRate !== undefined && { exchangeRate }),
      },
    })

    if (bankTransferInfo !== undefined) {
      await prisma.systemSettings.upsert({
        where: { key: "bank_transfer_info" },
        create: { key: "bank_transfer_info", value: bankTransferInfo ?? DEFAULTS.bankTransferInfo },
        update: { value: bankTransferInfo ?? DEFAULTS.bankTransferInfo },
      })
    }

    if (bankCashInfo !== undefined) {
      await prisma.systemSettings.upsert({
        where: { key: "bank_cash_info" },
        create: { key: "bank_cash_info", value: bankCashInfo ?? DEFAULTS.bankCashInfo },
        update: { value: bankCashInfo ?? DEFAULTS.bankCashInfo },
      })
    }

    // Ticket customization
    for (const [key, val] of [
      ["ticket_business_name", ticketBusinessName],
      ["ticket_subtitle", ticketSubtitle],
      ["ticket_footer", ticketFooter],
    ] as const) {
      if (val !== undefined) {
        await prisma.systemSettings.upsert({
          where: { key },
          create: { key, value: val },
          update: { value: val },
        })
      }
    }

    return NextResponse.json({ ...settings, bankTransferInfo, bankCashInfo, ticketBusinessName, ticketSubtitle, ticketFooter })
  } catch (error) {
    console.error("Error updating settings:", error)
    return NextResponse.json(
      { error: "Error al actualizar configuración" },
      { status: 500 }
    )
  }
}
