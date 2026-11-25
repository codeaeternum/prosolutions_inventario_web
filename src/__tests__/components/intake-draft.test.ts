import { describe, expect, it } from "vitest"
import {
    INTAKE_DRAFT_TTL_MS,
    emptyIntakeFormDraft,
    intakeDraftFromForm,
    intakeFormIsEmpty,
    parseIntakeDraft,
    serializeIntakeDraft,
    type IntakeFormDraft,
} from "@/components/admin/taller/intake-draft"

const NOW = new Date("2026-03-10T12:00:00Z").getTime()

const filledForm = (over: Partial<IntakeFormDraft> = {}): IntakeFormDraft => ({
    ...emptyIntakeFormDraft(),
    customerName: "María López",
    customerPhone: "+52 667 123 4567",
    equipmentType: "Celular",
    brand: "Samsung",
    model: "Galaxy A54",
    reportedIssue: "No enciende",
    intakeBranchId: "b1",
    services: [
        { id: "s1", name: "Cambio de pantalla", description: null, priceCents: 150000, equipmentType: "Celular" },
    ],
    accessories: ["Cargador", "Funda"],
    functionalConditions: ["APAGADO"],
    aesthetics: "REGULAR",
    advanceEnabled: true,
    advanceAmount: "200",
    advanceMethod: "CARD",
    partnerDrop: true,
    originBusinessName: "Telcel Centro",
    ...over,
})

// El borrador de recepción salva la captura del wizard ante un crash/cierre —
// pero sin credenciales del equipo ni firma: esas se vuelven a pedir.
describe("taller intake draft", () => {
    it("round-trip: serializa y restaura paso, formulario y modelo elegido", () => {
        const form = filledForm()
        const json = serializeIntakeDraft({
            step: 3,
            form,
            pickedModel: { id: "m1", brand: "Samsung", model: "Galaxy A54", code: "SM-A546", type: "Celular" },
        }, NOW)
        const restored = parseIntakeDraft(json, NOW + 60_000)
        expect(restored).not.toBeNull()
        expect(restored!.step).toBe(3)
        expect(restored!.form.customerName).toBe("María López")
        expect(restored!.form.advanceMethod).toBe("CARD")
        expect(restored!.form.services).toHaveLength(1)
        expect(restored!.form.functionalConditions).toEqual(["APAGADO"])
        expect(restored!.pickedModel?.code).toBe("SM-A546")
    })

    it("vencido, futuro o corrupto devuelve null", () => {
        const json = serializeIntakeDraft({ step: 0, form: filledForm(), pickedModel: null }, NOW)
        expect(parseIntakeDraft(json, NOW + INTAKE_DRAFT_TTL_MS + 1)).toBeNull()
        expect(parseIntakeDraft(serializeIntakeDraft({ step: 0, form: filledForm(), pickedModel: null }, NOW + 60_000), NOW)).toBeNull()
        expect(parseIntakeDraft("{no-json", NOW)).toBeNull()
        expect(parseIntakeDraft(null, NOW)).toBeNull()
        expect(parseIntakeDraft('"texto"', NOW)).toBeNull()
    })

    it("formulario vacío no restaura nada (equivalente a no haber capturado)", () => {
        const json = serializeIntakeDraft({ step: 2, form: emptyIntakeFormDraft(), pickedModel: null }, NOW)
        expect(parseIntakeDraft(json, NOW + 1000)).toBeNull()
    })

    it("el paso restaurado se acota al rango del wizard (0-4)", () => {
        const form = filledForm()
        const json = JSON.stringify({ savedAt: NOW, step: 99, form })
        expect(parseIntakeDraft(json, NOW + 1000)!.step).toBe(4)
        const negative = JSON.stringify({ savedAt: NOW, step: -3, form })
        expect(parseIntakeDraft(negative, NOW + 1000)!.step).toBe(0)
    })

    it("campos con tipo corrupto caen a defaults sin tirar el borrador entero", () => {
        const json = JSON.stringify({
            savedAt: NOW,
            step: 1,
            form: {
                ...filledForm(),
                customerName: 42,                  // no string → ""
                accessories: "no-array",            // no array → []
                functionalConditions: ["APAGADO", "INVENTADA", 7], // filtra inválidas
                advanceMethod: "CHEQUE",            // fuera del enum → CASH
                services: [{ id: "ok", name: "S" }, { sinId: true }, null],
            },
        })
        const restored = parseIntakeDraft(json, NOW + 1000)!
        expect(restored.form.customerName).toBe("")
        expect(restored.form.accessories).toEqual([])
        expect(restored.form.functionalConditions).toEqual(["APAGADO"])
        expect(restored.form.advanceMethod).toBe("CASH")
        expect(restored.form.services).toHaveLength(1)
    })

    it("intakeDraftFromForm excluye credenciales del equipo y la firma", () => {
        // La forma completa de la página trae pattern/accessValue/pinConfirm/
        // signatureData — la whitelist no los copia al borrador persistido.
        const fullForm = {
            ...filledForm(),
            accessType: "PIN" as const,
            pattern: [0, 4, 8],
            accessValue: "2468",
            pinConfirm: "4567",
            signatureData: "data:image/png;base64,xxxx",
        }
        const draft = intakeDraftFromForm(fullForm)
        expect(draft.accessType).toBe("PIN") // el TIPO sí viaja: la validación re-pide el valor
        const keys = Object.keys(draft)
        expect(keys).not.toContain("pattern")
        expect(keys).not.toContain("accessValue")
        expect(keys).not.toContain("pinConfirm")
        expect(keys).not.toContain("signatureData")
        // Y el serializado tampoco los cuela aunque vengan en el objeto.
        const json = serializeIntakeDraft({ step: 2, form: draft, pickedModel: null }, NOW)
        expect(json).not.toContain("2468")
        expect(json).not.toContain("signatureData")
    })

    it("intakeFormIsEmpty: solo sucursal/fechas sin captura real cuenta como vacío", () => {
        expect(intakeFormIsEmpty(emptyIntakeFormDraft())).toBe(true)
        expect(intakeFormIsEmpty({ ...emptyIntakeFormDraft(), intakeBranchId: "b1", location: "Mesa 1" })).toBe(true)
        expect(intakeFormIsEmpty({ ...emptyIntakeFormDraft(), customerName: "Ana" })).toBe(false)
        expect(intakeFormIsEmpty({ ...emptyIntakeFormDraft(), equipmentType: "Celular" })).toBe(false)
    })
})
