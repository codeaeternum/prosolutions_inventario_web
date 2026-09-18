import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { DEFAULT_SETTINGS as DEFAULTS, getBusinessSettingsMap, getDefaultBusinessId, setBusinessSetting } from "@/lib/settings"

const DEFAULT_SETTINGS = {
  id: "default",
  ...DEFAULTS,
  updatedAt: new Date().toISOString(),
}

// GET - Obtener configuración.
// Anónimo (checkout público /carrito): solo los campos que la reserva pública
// necesita — nunca datos bancarios (CLABE/cuentas) ni textos del ticket.
// Con sesión: respuesta completa para la pantalla de configuración.
// El GET es de solo lectura: si el negocio no tiene fila Settings todavía se
// responde con los defaults sin crearla (un GET anónimo no debe escribir).
export async function GET() {
  try {
    const session = await auth()
    const businessId = session ? businessIdOf(session) : await getDefaultBusinessId()
    const settings = await prisma.settings.findFirst({
      where: { businessId },
    })

    if (!session) {
      return NextResponse.json({
        tempReservationMinutes: settings?.tempReservationMinutes ?? DEFAULTS.tempReservationMinutes,
        depositPercentage: settings?.depositPercentage ?? DEFAULTS.depositPercentage,
        depositReservationHours: settings?.depositReservationHours ?? DEFAULTS.depositReservationHours,
        pendingVerificationHours: settings?.pendingVerificationHours ?? DEFAULTS.pendingVerificationHours,
        exchangeRate: settings?.exchangeRate ?? DEFAULTS.exchangeRate,
      })
    }

    const systemSettings = await getBusinessSettingsMap(businessId, [
      "bank_transfer_info", "bank_cash_info",
      "ticket_business_name", "ticket_subtitle", "ticket_footer",
    ])

    return NextResponse.json({
      ...(settings ?? {
        id: "default",
        businessId,
        tempReservationMinutes: DEFAULTS.tempReservationMinutes,
        depositPercentage: DEFAULTS.depositPercentage,
        depositReservationHours: DEFAULTS.depositReservationHours,
        pendingVerificationHours: DEFAULTS.pendingVerificationHours,
        exchangeRate: DEFAULTS.exchangeRate,
        createdAt: null,
        updatedAt: null,
      }),
      bankTransferInfo: systemSettings.get("bank_transfer_info") || DEFAULTS.bankTransferInfo,
      bankCashInfo: systemSettings.get("bank_cash_info") || DEFAULTS.bankCashInfo,
      ticketBusinessName: systemSettings.get("ticket_business_name") || "PROSOLUTIONS",
      ticketSubtitle: systemSettings.get("ticket_subtitle") || "Venta de refacciones y\nReparación profesional",
      ticketFooter: systemSettings.get("ticket_footer") || "¡Gracias por tu preferencia!",
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
    const businessId = businessIdOf(getSession(result)!)

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

    const updateData = {
      ...(tempReservationMinutes !== undefined && { tempReservationMinutes }),
      ...(depositPercentage !== undefined && { depositPercentage }),
      ...(depositReservationHours !== undefined && { depositReservationHours }),
      ...(pendingVerificationHours !== undefined && { pendingVerificationHours }),
      ...(exchangeRate !== undefined && { exchangeRate }),
    }
    const existing = await prisma.settings.findFirst({ where: { businessId }, select: { id: true } })
    const settings = existing
      ? await prisma.settings.update({ where: { id: existing.id }, data: updateData })
      : await prisma.settings.create({
          data: {
            businessId,
            tempReservationMinutes: tempReservationMinutes ?? 30,
            depositPercentage: depositPercentage ?? 50,
            depositReservationHours: depositReservationHours ?? 48,
            pendingVerificationHours: pendingVerificationHours ?? 24,
            exchangeRate: exchangeRate ?? 17.50,
          },
        })

    if (bankTransferInfo !== undefined) {
      await setBusinessSetting(businessId, "bank_transfer_info", bankTransferInfo ?? DEFAULTS.bankTransferInfo)
    }

    if (bankCashInfo !== undefined) {
      await setBusinessSetting(businessId, "bank_cash_info", bankCashInfo ?? DEFAULTS.bankCashInfo)
    }

    // Ticket customization
    for (const [key, val] of [
      ["ticket_business_name", ticketBusinessName],
      ["ticket_subtitle", ticketSubtitle],
      ["ticket_footer", ticketFooter],
    ] as const) {
      if (val !== undefined) {
        await setBusinessSetting(businessId, key, val)
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
