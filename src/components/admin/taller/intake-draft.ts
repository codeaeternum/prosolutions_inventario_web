// Borrador de la recepción de taller en localStorage: el wizard de 5 pasos
// captura decenas de campos y un crash, un corte de luz o un cierre accidental
// de la pestaña no debe perderlos. Es un BORRADOR — el servidor valida todo al
// crear la orden; lo restaurado equivale a la captura a medias que era.
//
// Qué NO se persiste, aunque forme parte del formulario:
// - deviceAccessValue / pattern (PIN, contraseña y patrón del equipo): son
//   credenciales del cliente — dejarlas en localStorage las expone a cualquier
//   script del origen y sobrevivirían en la computadora compartida del
//   mostrador mucho después de entregado el equipo.
// - pinConfirm: igual de sensible (terminación telefónica) y además se deriva
//   del teléfono, que sí se restaura — confirmarla de nuevo son 4 teclas.
// - signatureData: la firma es biométrica (y pesada como dataURL); el cliente
//   está físicamente en mostrador y firmar de nuevo toma segundos.
// Los datos de contacto del cliente SÍ se persisten: se capturan en mostrador
// de todos modos y sin ellos el borrador no serviría de nada.

export const INTAKE_DRAFT_KEY = "taller:intake-draft"
/** El borrador vive un turno: más viejo se descarta (datos de captura obsoletos). */
export const INTAKE_DRAFT_TTL_MS = 12 * 60 * 60 * 1000

type AccessType = "NONE" | "PATTERN" | "PIN" | "PASSWORD"
type FunctionalCondition = "ENCENDIDO" | "APAGADO" | "MOJADO" | "MANIPULADO" | "ROTO" | "INCOMPLETO"
type Aesthetics = "BUENO" | "REGULAR" | "MALO"
type AdvanceMethod = "CASH" | "CARD" | "TRANSFER"

const ACCESS_TYPES: AccessType[] = ["NONE", "PATTERN", "PIN", "PASSWORD"]
const FUNCTIONAL_CONDITIONS: FunctionalCondition[] = ["ENCENDIDO", "APAGADO", "MOJADO", "MANIPULADO", "ROTO", "INCOMPLETO"]
const AESTHETICS: Aesthetics[] = ["BUENO", "REGULAR", "MALO"]
const ADVANCE_METHODS: AdvanceMethod[] = ["CASH", "CARD", "TRANSFER"]

export interface IntakeDraftService {
    id: string
    name: string
    description: string | null
    priceCents: number | null
    equipmentType: string | null
    prices?: { deviceModelId: string | null; equipmentType: string | null; priceCents: number }[]
}

export interface IntakeDraftModel {
    id: string
    brand: string
    model: string
    code: string | null
    type: string
}

/** Los campos persistidos del formulario de recepción (ver nota superior). */
export interface IntakeFormDraft {
    customerName: string
    customerPhone: string
    customerPhoneDial: string
    phoneAltVisible: boolean
    customerPhoneAlt: string
    customerPhoneAltDial: string
    intakeBranchId: string
    assignedToId: string
    equipmentType: string
    equipmentTypeOther: string
    brand: string
    model: string
    equipmentColor: string
    equipmentColorCustom: boolean
    serialNumber: string
    serialLast4: boolean
    serviceName: string
    servicePriceCents: number | null
    otherService: string
    budgetAmount: string
    services: IntakeDraftService[]
    accessType: AccessType
    accessories: string[]
    accessoryOther: string
    components: string[]
    functionalConditions: FunctionalCondition[]
    aesthetics: Aesthetics | ""
    intakeCondition: string
    reportedIssue: string
    promisedAt: string
    scheduledAt: string
    location: string
    advanceEnabled: boolean
    advanceAmount: string
    advanceMethod: AdvanceMethod
    partnerDrop: boolean
    originBusinessName: string
    originContact: string
    partnerPrice: string
}

export interface IntakeDraft {
    step: number
    form: IntakeFormDraft
    pickedModel: IntakeDraftModel | null
}

interface IntakeDraftStored extends IntakeDraft {
    savedAt: number
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function str(value: unknown, maxLength: number): string {
    return typeof value === "string" ? value.slice(0, maxLength) : ""
}

function bool(value: unknown): boolean {
    return value === true
}

function strEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
    return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback
}

function strArray(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string").slice(0, maxItems).map(item => item.slice(0, maxLength))
}

function sanitizeService(raw: unknown): IntakeDraftService | null {
    if (!raw || typeof raw !== "object") return null
    const s = raw as Partial<IntakeDraftService>
    if (typeof s.id !== "string" || !s.id || typeof s.name !== "string" || !s.name) return null
    const prices = Array.isArray(s.prices)
        ? s.prices.flatMap(p => {
            if (!p || typeof p !== "object" || !isFiniteNumber((p as { priceCents?: unknown }).priceCents)) return []
            return [{
                deviceModelId: typeof p.deviceModelId === "string" ? p.deviceModelId : null,
                equipmentType: typeof p.equipmentType === "string" ? p.equipmentType : null,
                priceCents: p.priceCents,
            }]
        })
        : undefined
    return {
        id: s.id,
        name: s.name.slice(0, 120),
        description: typeof s.description === "string" ? s.description.slice(0, 500) : null,
        priceCents: isFiniteNumber(s.priceCents) ? s.priceCents : null,
        equipmentType: typeof s.equipmentType === "string" ? s.equipmentType.slice(0, 60) : null,
        ...(prices ? { prices } : {}),
    }
}

function sanitizeModel(raw: unknown): IntakeDraftModel | null {
    if (!raw || typeof raw !== "object") return null
    const m = raw as Partial<IntakeDraftModel>
    if (typeof m.id !== "string" || !m.id || typeof m.brand !== "string" || typeof m.model !== "string") return null
    return {
        id: m.id,
        brand: m.brand.slice(0, 60),
        model: m.model.slice(0, 120),
        code: typeof m.code === "string" ? m.code.slice(0, 60) : null,
        type: typeof m.type === "string" ? m.type.slice(0, 60) : "",
    }
}

/**
 * Forma vacía del borrador: los defaults coinciden con emptyForm de la página
 * (los campos excluidos — credenciales y firma — los rellena el merge de allá).
 */
export function emptyIntakeFormDraft(): IntakeFormDraft {
    return {
        customerName: "", customerPhone: "", customerPhoneDial: "+52",
        phoneAltVisible: false, customerPhoneAlt: "", customerPhoneAltDial: "+52",
        intakeBranchId: "", assignedToId: "",
        equipmentType: "", equipmentTypeOther: "", brand: "", model: "",
        equipmentColor: "", equipmentColorCustom: false, serialNumber: "", serialLast4: false,
        serviceName: "", servicePriceCents: null, otherService: "", budgetAmount: "",
        services: [], accessType: "NONE", accessories: [], accessoryOther: "", components: [],
        functionalConditions: [], aesthetics: "", intakeCondition: "", reportedIssue: "",
        promisedAt: "", scheduledAt: "", location: "",
        advanceEnabled: false, advanceAmount: "", advanceMethod: "CASH",
        partnerDrop: false, originBusinessName: "", originContact: "", partnerPrice: "",
    }
}

/** Campos del formulario de la página que sí viajan al borrador (whitelist). */
export function intakeDraftFromForm(form: IntakeFormDraft): IntakeFormDraft {
    return {
        customerName: form.customerName, customerPhone: form.customerPhone, customerPhoneDial: form.customerPhoneDial,
        phoneAltVisible: form.phoneAltVisible, customerPhoneAlt: form.customerPhoneAlt, customerPhoneAltDial: form.customerPhoneAltDial,
        intakeBranchId: form.intakeBranchId, assignedToId: form.assignedToId,
        equipmentType: form.equipmentType, equipmentTypeOther: form.equipmentTypeOther,
        brand: form.brand, model: form.model, equipmentColor: form.equipmentColor, equipmentColorCustom: form.equipmentColorCustom,
        serialNumber: form.serialNumber, serialLast4: form.serialLast4,
        serviceName: form.serviceName, servicePriceCents: form.servicePriceCents, otherService: form.otherService, budgetAmount: form.budgetAmount,
        services: form.services, accessType: form.accessType, accessories: form.accessories, accessoryOther: form.accessoryOther,
        components: form.components, functionalConditions: form.functionalConditions, aesthetics: form.aesthetics,
        intakeCondition: form.intakeCondition, reportedIssue: form.reportedIssue,
        promisedAt: form.promisedAt, scheduledAt: form.scheduledAt, location: form.location,
        advanceEnabled: form.advanceEnabled, advanceAmount: form.advanceAmount, advanceMethod: form.advanceMethod,
        partnerDrop: form.partnerDrop, originBusinessName: form.originBusinessName, originContact: form.originContact, partnerPrice: form.partnerPrice,
    }
}

/** Sin captura real no hay nada que persistir: equivalente al ticket vacío del POS. */
export function intakeFormIsEmpty(form: IntakeFormDraft): boolean {
    return !form.customerName.trim()
        && !form.customerPhone.trim()
        && !form.equipmentType
        && !form.reportedIssue.trim()
        && form.services.length === 0
        && !form.brand.trim()
        && !form.model.trim()
}

export function serializeIntakeDraft(draft: IntakeDraft, nowMs = Date.now()): string {
    const stored: IntakeDraftStored = { savedAt: nowMs, ...draft }
    return JSON.stringify(stored)
}

/** Borrador → estado restaurable, o null si venció, está corrupto o está vacío. */
export function parseIntakeDraft(json: string | null, nowMs: number): IntakeDraft | null {
    if (!json) return null
    try {
        const raw = JSON.parse(json) as Partial<IntakeDraftStored>
        if (!isFiniteNumber(raw.savedAt) || nowMs - raw.savedAt > INTAKE_DRAFT_TTL_MS || raw.savedAt > nowMs) return null
        const rawForm = (raw.form ?? {}) as Record<string, unknown>
        const form: IntakeFormDraft = {
            customerName: str(rawForm.customerName, 100),
            customerPhone: str(rawForm.customerPhone, 40),
            customerPhoneDial: str(rawForm.customerPhoneDial, 8) || "+52",
            phoneAltVisible: bool(rawForm.phoneAltVisible),
            customerPhoneAlt: str(rawForm.customerPhoneAlt, 40),
            customerPhoneAltDial: str(rawForm.customerPhoneAltDial, 8) || "+52",
            intakeBranchId: str(rawForm.intakeBranchId, 80),
            assignedToId: str(rawForm.assignedToId, 80),
            equipmentType: str(rawForm.equipmentType, 60),
            equipmentTypeOther: str(rawForm.equipmentTypeOther, 100),
            brand: str(rawForm.brand, 60),
            model: str(rawForm.model, 120),
            equipmentColor: str(rawForm.equipmentColor, 60),
            equipmentColorCustom: bool(rawForm.equipmentColorCustom),
            serialNumber: str(rawForm.serialNumber, 100),
            serialLast4: bool(rawForm.serialLast4),
            serviceName: str(rawForm.serviceName, 500),
            servicePriceCents: isFiniteNumber(rawForm.servicePriceCents) ? rawForm.servicePriceCents : null,
            otherService: str(rawForm.otherService, 120),
            budgetAmount: str(rawForm.budgetAmount, 20),
            services: (Array.isArray(rawForm.services) ? rawForm.services : [])
                .map(sanitizeService)
                .filter((s): s is IntakeDraftService => s !== null)
                .slice(0, 4),
            accessType: strEnum(rawForm.accessType, ACCESS_TYPES, "NONE"),
            accessories: strArray(rawForm.accessories, 30, 120),
            accessoryOther: str(rawForm.accessoryOther, 120),
            components: strArray(rawForm.components, 30, 120),
            functionalConditions: strArray(rawForm.functionalConditions, 10, 30)
                .filter((c): c is FunctionalCondition => (FUNCTIONAL_CONDITIONS as string[]).includes(c)),
            aesthetics: (AESTHETICS as string[]).includes(rawForm.aesthetics as string) ? rawForm.aesthetics as Aesthetics : "",
            intakeCondition: str(rawForm.intakeCondition, 500),
            reportedIssue: str(rawForm.reportedIssue, 500),
            promisedAt: str(rawForm.promisedAt, 30),
            scheduledAt: str(rawForm.scheduledAt, 30),
            location: str(rawForm.location, 80),
            advanceEnabled: bool(rawForm.advanceEnabled),
            advanceAmount: str(rawForm.advanceAmount, 20),
            advanceMethod: strEnum(rawForm.advanceMethod, ADVANCE_METHODS, "CASH"),
            partnerDrop: bool(rawForm.partnerDrop),
            originBusinessName: str(rawForm.originBusinessName, 80),
            originContact: str(rawForm.originContact, 120),
            partnerPrice: str(rawForm.partnerPrice, 20),
        }
        if (intakeFormIsEmpty(form)) return null
        const step = isFiniteNumber(raw.step) ? Math.min(4, Math.max(0, Math.floor(raw.step))) : 0
        return { step, form, pickedModel: sanitizeModel(raw.pickedModel) }
    } catch {
        return null
    }
}
