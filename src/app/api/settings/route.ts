import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { DEFAULT_SETTINGS as DEFAULTS, getBusinessSettingsMap, getDefaultBusinessId, setBusinessSetting } from "@/lib/settings"

const DEFAULT_SETTINGS = {
  id: "default",
  ...DEFAULTS,
  updatedAt: new Date().toISOString(),
}

// Consecutivo del folio de órdenes: dígitos permitidos (order_folio_digits).
const FOLIO_DIGITS_MIN = 4
const FOLIO_DIGITS_MAX = 8
const FOLIO_DIGITS_DEFAULT = 6

/** Parsea `order_folio_digits`; cualquier valor inválido cae al default 6. */
function parseFolioDigits(raw: string | undefined): number {
  const digits = Number.parseInt(raw ?? "", 10)
  return Number.isInteger(digits) && digits >= FOLIO_DIGITS_MIN && digits <= FOLIO_DIGITS_MAX
    ? digits
    : FOLIO_DIGITS_DEFAULT
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
      "order_prefix", "order_folio_digits",
      "partner_intake_enabled", "repair_partner_business_id",
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
      // Prefijo del folio de órdenes de taller (OT-000001 → p. ej. PS-000001).
      orderPrefix: systemSettings.get("order_prefix") || "OT",
      // Dígitos del consecutivo del folio (4–8; default 6 → OT-000001).
      orderFolioDigits: parseFolioDigits(systemSettings.get("order_folio_digits")),
      // Modelo taller asociado: este negocio acepta órdenes de captadores.
      partnerIntakeEnabled: systemSettings.get("partner_intake_enabled") === "true",
      // Taller reparador al que este negocio (captador) envía sus órdenes.
      repairPartnerBusinessId: systemSettings.get("repair_partner_business_id") || "",
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

// PATCH - Actualizar configuración (módulo configuración)
export async function PATCH(req: Request) {
  try {
    const result = await requireModule("configuracion")
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
      orderPrefix,
      orderFolioDigits,
      partnerIntakeEnabled,
      repairPartnerBusinessId,
    } = body

    // Validaciones previas a cualquier escritura: si fallan, el PATCH no deja
    // el negocio a medias (el update de Settings todavía no corre).
    let folioDigits: number | undefined
    if (orderFolioDigits !== undefined) {
      const parsed = Number(orderFolioDigits)
      if (!Number.isInteger(parsed) || parsed < FOLIO_DIGITS_MIN || parsed > FOLIO_DIGITS_MAX) {
        return NextResponse.json(
          { error: `Los dígitos del folio deben ser un entero entre ${FOLIO_DIGITS_MIN} y ${FOLIO_DIGITS_MAX}` },
          { status: 400 }
        )
      }
      folioDigits = parsed
    }

    // Taller reparador asociado (modelo captador): debe ser OTRO negocio
    // activo; cadena vacía/null desvincula.
    let repairPartnerId: string | null | undefined
    if (repairPartnerBusinessId !== undefined) {
      const candidate =
        typeof repairPartnerBusinessId === "string" ? repairPartnerBusinessId.trim() : ""
      if (!candidate) {
        repairPartnerId = null
      } else {
        if (candidate === businessId) {
          return NextResponse.json(
            { error: "El taller asociado no puede ser tu propio negocio" },
            { status: 400 }
          )
        }
        const target = await prisma.business.findUnique({
          where: { id: candidate },
          select: { isActive: true },
        })
        if (!target?.isActive) {
          return NextResponse.json(
            { error: "El taller asociado no existe o está inactivo" },
            { status: 400 }
          )
        }
        repairPartnerId = candidate
      }
    }

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

    // Prefijo del folio impreso: solo letras/dígitos, máx. 8; vacío = default OT.
    let savedOrderPrefix: string | undefined
    if (orderPrefix !== undefined) {
      const clean = String(orderPrefix).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
      savedOrderPrefix = clean || "OT"
      await setBusinessSetting(businessId, "order_prefix", savedOrderPrefix)
    }

    // Dígitos del consecutivo del folio (ya validados arriba).
    if (folioDigits !== undefined) {
      await setBusinessSetting(businessId, "order_folio_digits", String(folioDigits), "NUMBER")
    }

    // Intake de captadores: este taller acepta recibir órdenes delegadas.
    let savedPartnerIntake: boolean | undefined
    if (partnerIntakeEnabled !== undefined) {
      savedPartnerIntake = Boolean(partnerIntakeEnabled)
      await setBusinessSetting(
        businessId,
        "partner_intake_enabled",
        savedPartnerIntake ? "true" : "false"
      )
    }

    // Vínculo captador → taller reparador (ya validado arriba). null = quitar.
    if (repairPartnerId !== undefined) {
      if (repairPartnerId === null) {
        await prisma.systemSettings.deleteMany({
          where: { businessId, key: "repair_partner_business_id" },
        })
      } else {
        await setBusinessSetting(businessId, "repair_partner_business_id", repairPartnerId)
      }
    }

    return NextResponse.json({
      ...settings,
      bankTransferInfo,
      bankCashInfo,
      ticketBusinessName,
      ticketSubtitle,
      ticketFooter,
      orderPrefix: savedOrderPrefix,
      orderFolioDigits: folioDigits,
      partnerIntakeEnabled: savedPartnerIntake,
      repairPartnerBusinessId: repairPartnerId,
    })
  } catch (error) {
    console.error("Error updating settings:", error)
    return NextResponse.json(
      { error: "Error al actualizar configuración" },
      { status: 500 }
    )
  }
}
