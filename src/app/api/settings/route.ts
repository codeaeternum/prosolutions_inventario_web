import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { DEFAULT_SETTINGS as DEFAULTS, getBusinessSettingsMap, getDefaultBusinessId, setBusinessSetting } from "@/lib/settings"
import { diffChanges, maskSensitiveChanges, recordAudit } from "@/lib/audit"

const DEFAULT_SETTINGS = {
  id: "default",
  ...DEFAULTS,
  updatedAt: new Date().toISOString(),
}

// Consecutivo del folio de órdenes: dígitos permitidos (order_folio_digits).
const FOLIO_DIGITS_MIN = 4
const FOLIO_DIGITS_MAX = 8
const FOLIO_DIGITS_DEFAULT = 6

// Vigencia de la cotización pública (quote_validity_days): 1–90, default 15.
const QUOTE_DAYS_MIN = 1
const QUOTE_DAYS_MAX = 90
const QUOTE_DAYS_DEFAULT = 15
// Términos impresos al pie de la cotización (quote_terms); vacío = default.
const DEFAULT_QUOTE_TERMS =
  "Esta cotización es un estimado basado en el diagnóstico inicial. Si se detectan daños adicionales se le contactará antes de proceder."
const QUOTE_TERMS_MAX = 2000
// Cómo acredita el cliente la recepción (repair_signature_mode).
const SIGNATURE_MODES = ["canvas", "ticket", "pin"] as const
type SignatureMode = (typeof SIGNATURE_MODES)[number]
const SIGNATURE_MODE_DEFAULT: SignatureMode = "canvas"

/** Parsea `repair_signature_mode`; ausente/inválido cae a "canvas". */
function parseSignatureMode(raw: string | undefined): SignatureMode {
  return (SIGNATURE_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as SignatureMode)
    : SIGNATURE_MODE_DEFAULT
}

/** Parsea `quote_validity_days`; ausente/inválido cae al default 15. */
function parseQuoteDays(raw: string | undefined): number {
  const days = Number(raw)
  return Number.isInteger(days) && days >= QUOTE_DAYS_MIN && days <= QUOTE_DAYS_MAX
    ? days
    : QUOTE_DAYS_DEFAULT
}

/** Parsea `order_folio_digits`; cualquier valor inválido cae al default 6. */
function parseFolioDigits(raw: string | undefined): number {
  const digits = Number.parseInt(raw ?? "", 10)
  return Number.isInteger(digits) && digits >= FOLIO_DIGITS_MIN && digits <= FOLIO_DIGITS_MAX
    ? digits
    : FOLIO_DIGITS_DEFAULT
}

// GET - Obtener configuración.
// Sin sesión staff (anónimo, CUSTOMER, WORKSHOP o cuenta pendiente): solo los
// campos que la reserva pública /carrito necesita — nunca datos bancarios
// (CLABE/cuentas), el taller asociado ni textos del ticket. Antes bastaba
// CUALQUIER sesión para recibir el payload completo.
// Con sesión de staff (ADMIN/EMPLOYEE aprobado): respuesta completa para la
// pantalla de configuración.
// El GET es de solo lectura: si el negocio no tiene fila Settings todavía se
// responde con los defaults sin crearla (un GET anónimo no debe escribir).
export async function GET() {
  try {
    const session = await auth()
    const businessId = session ? businessIdOf(session) : await getDefaultBusinessId()
    const settings = await prisma.settings.findFirst({
      where: { businessId },
    })

    const staffViewer =
      session?.user?.status === "APPROVED" &&
      (session.user.role === "ADMIN" || session.user.role === "EMPLOYEE")
    if (!staffViewer) {
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
      "sale_auto_ticket", "repair_signature_mode",
      "quote_validity_days", "quote_terms",
      "label_show_problem", "label_show_access",
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
      // Mostrador: tras cobrar una venta se abre el ticket en pestaña nueva
      // (con ?copias=2 cuando hay tarjeta). Default activado.
      saleAutoTicket: systemSettings.get("sale_auto_ticket") !== "false",
      // Recepción de equipos: "canvas" (firma digital), "ticket" (firma en el
      // comprobante impreso) o "pin" (terminación telefónica).
      repairSignatureMode: parseSignatureMode(systemSettings.get("repair_signature_mode")),
      // Cotización pública: días de vigencia (1–90) y términos del pie.
      quoteValidityDays: parseQuoteDays(systemSettings.get("quote_validity_days")),
      quoteTerms: systemSettings.get("quote_terms") || DEFAULT_QUOTE_TERMS,
      // Etiqueta 50×40 del equipo: imprimir la falla y el desbloqueo.
      labelShowProblem: systemSettings.get("label_show_problem") !== "false",
      labelShowAccess: systemSettings.get("label_show_access") !== "false",
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

// Llaves de SystemSettings que este PATCH puede escribir (para el diff de
// la bitácora se leen ANTES de cualquier setBusinessSetting).
const AUDITED_SYSTEM_KEYS = [
  "bank_transfer_info", "bank_cash_info",
  "ticket_business_name", "ticket_subtitle", "ticket_footer",
  "order_prefix", "order_folio_digits",
  "partner_intake_enabled", "repair_partner_business_id",
  "sale_auto_ticket", "repair_signature_mode",
  "quote_validity_days", "quote_terms",
  "label_show_problem", "label_show_access",
]

// PATCH - Actualizar configuración (módulo configuración)
export async function PATCH(req: Request) {
  try {
    const result = await requireModule("configuracion")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

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
      saleAutoTicket,
      repairSignatureMode,
      quoteValidityDays,
      quoteTerms,
      labelShowProblem,
      labelShowAccess,
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

    // Vigencia de la cotización pública: entero 1–90 días.
    let quoteDays: number | undefined
    if (quoteValidityDays !== undefined) {
      const parsed = Number(quoteValidityDays)
      if (!Number.isInteger(parsed) || parsed < QUOTE_DAYS_MIN || parsed > QUOTE_DAYS_MAX) {
        return NextResponse.json(
          { error: `La vigencia de la cotización debe ser un entero entre ${QUOTE_DAYS_MIN} y ${QUOTE_DAYS_MAX} días` },
          { status: 400 }
        )
      }
      quoteDays = parsed
    }

    // Modo de firma en recepción: solo los valores conocidos.
    let signatureMode: SignatureMode | undefined
    if (repairSignatureMode !== undefined) {
      if (!(SIGNATURE_MODES as readonly string[]).includes(String(repairSignatureMode))) {
        return NextResponse.json(
          { error: `El modo de firma debe ser uno de: ${SIGNATURE_MODES.join(", ")}` },
          { status: 400 }
        )
      }
      signatureMode = repairSignatureMode as SignatureMode
    }

    // Términos de la cotización: texto libre acotado; vacío = texto default.
    let cleanQuoteTerms: string | undefined
    if (quoteTerms !== undefined) {
      if (typeof quoteTerms !== "string") {
        return NextResponse.json(
          { error: "Los términos de la cotización deben ser texto" },
          { status: 400 }
        )
      }
      cleanQuoteTerms = quoteTerms.trim().slice(0, QUOTE_TERMS_MAX)
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
    // Estado previo para la bitácora: la fila Settings (columnas numéricas)
    // y las llaves SystemSettings que este PATCH puede tocar.
    const existing = await prisma.settings.findFirst({
      where: { businessId },
      select: {
        id: true,
        tempReservationMinutes: true,
        depositPercentage: true,
        depositReservationHours: true,
        pendingVerificationHours: true,
        exchangeRate: true,
      },
    })
    const beforeSys = await getBusinessSettingsMap(businessId, AUDITED_SYSTEM_KEYS)
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

    // Mostrador e impresión: toggles BOOLEAN guardados "true"/"false".
    for (const [key, val] of [
      ["sale_auto_ticket", saleAutoTicket],
      ["label_show_problem", labelShowProblem],
      ["label_show_access", labelShowAccess],
    ] as const) {
      if (val !== undefined) {
        await setBusinessSetting(businessId, key, val ? "true" : "false", "BOOLEAN")
      }
    }

    // Firma en recepción (ya validado arriba).
    if (signatureMode !== undefined) {
      await setBusinessSetting(businessId, "repair_signature_mode", signatureMode)
    }

    // Vigencia y términos de la cotización pública (ya validados arriba).
    if (quoteDays !== undefined) {
      await setBusinessSetting(businessId, "quote_validity_days", String(quoteDays), "NUMBER")
    }
    if (cleanQuoteTerms !== undefined) {
      await setBusinessSetting(businessId, "quote_terms", cleanQuoteTerms)
    }

    // Bitácora: solo las llaves que llegaron en el body, con su valor
    // EFECTIVO guardado (normalizado: prefijo saneado, booleanos "true"/
    // "false", números como texto tal como quedan en SystemSettings).
    const sentValues: Record<string, unknown> = {
      ...(tempReservationMinutes !== undefined && { tempReservationMinutes }),
      ...(depositPercentage !== undefined && { depositPercentage }),
      ...(depositReservationHours !== undefined && { depositReservationHours }),
      ...(pendingVerificationHours !== undefined && { pendingVerificationHours }),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(bankTransferInfo !== undefined && { bank_transfer_info: bankTransferInfo ?? DEFAULTS.bankTransferInfo }),
      ...(bankCashInfo !== undefined && { bank_cash_info: bankCashInfo ?? DEFAULTS.bankCashInfo }),
      ...(ticketBusinessName !== undefined && { ticket_business_name: ticketBusinessName }),
      ...(ticketSubtitle !== undefined && { ticket_subtitle: ticketSubtitle }),
      ...(ticketFooter !== undefined && { ticket_footer: ticketFooter }),
      ...(savedOrderPrefix !== undefined && { order_prefix: savedOrderPrefix }),
      ...(folioDigits !== undefined && { order_folio_digits: String(folioDigits) }),
      ...(savedPartnerIntake !== undefined && { partner_intake_enabled: savedPartnerIntake ? "true" : "false" }),
      ...(repairPartnerId !== undefined && { repair_partner_business_id: repairPartnerId }),
      ...(saleAutoTicket !== undefined && { sale_auto_ticket: saleAutoTicket ? "true" : "false" }),
      ...(signatureMode !== undefined && { repair_signature_mode: signatureMode }),
      ...(quoteDays !== undefined && { quote_validity_days: String(quoteDays) }),
      ...(cleanQuoteTerms !== undefined && { quote_terms: cleanQuoteTerms }),
      ...(labelShowProblem !== undefined && { label_show_problem: labelShowProblem ? "true" : "false" }),
      ...(labelShowAccess !== undefined && { label_show_access: labelShowAccess ? "true" : "false" }),
    }
    const sentKeys = Object.keys(sentValues)
    if (sentKeys.length > 0) {
      const beforeValues: Record<string, unknown> = {
        tempReservationMinutes: existing?.tempReservationMinutes ?? null,
        depositPercentage: existing?.depositPercentage ?? null,
        depositReservationHours: existing?.depositReservationHours ?? null,
        pendingVerificationHours: existing?.pendingVerificationHours ?? null,
        exchangeRate: existing?.exchangeRate ?? null,
      }
      for (const key of sentKeys) {
        if (!(key in beforeValues)) beforeValues[key] = beforeSys.get(key) ?? null
      }
      // Las llaves cuyo nombre delate secreto quedan censuradas (defensa en
      // profundidad; las llaves actuales son datos públicos del negocio).
      const changes = maskSensitiveChanges(diffChanges(beforeValues, sentValues, sentKeys))
      if (changes) {
        const changedKeys = Object.keys(changes)
        await recordAudit(prisma, {
          businessId,
          actorId: session.user.id,
          action: "SETTINGS_UPDATE",
          entity: "settings",
          entityId: settings.id,
          entityName: "Configuración del negocio",
          summary: `Cambió configuración: ${changedKeys.slice(0, 5).join(", ")}${changedKeys.length > 5 ? ` (+${changedKeys.length - 5} más)` : ""}`,
          changes,
        })
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
      saleAutoTicket,
      repairSignatureMode: signatureMode,
      quoteValidityDays: quoteDays,
      quoteTerms: cleanQuoteTerms,
      labelShowProblem,
      labelShowAccess,
    })
  } catch (error) {
    console.error("Error updating settings:", error)
    return NextResponse.json(
      { error: "Error al actualizar configuración" },
      { status: 500 }
    )
  }
}
