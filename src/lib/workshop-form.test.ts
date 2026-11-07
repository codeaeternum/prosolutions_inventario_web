import { describe, expect, it } from "vitest"
import { evidenceUploadSummary, localDateTimeToIso, partFormIsDirty, textOrUndefined } from "./workshop-form"

describe("textOrUndefined", () => {
    it("devuelve undefined para vacío y espacios", () => {
        expect(textOrUndefined("")).toBeUndefined()
        expect(textOrUndefined("   ")).toBeUndefined()
        expect(textOrUndefined(undefined)).toBeUndefined()
        expect(textOrUndefined(null)).toBeUndefined()
    })

    it("recorta y conserva el contenido", () => {
        expect(textOrUndefined("  listo para entregar  ")).toBe("listo para entregar")
    })
})

describe("localDateTimeToIso", () => {
    it("vacío → null (limpia el campo en el servidor)", () => {
        expect(localDateTimeToIso("")).toBeNull()
        expect(localDateTimeToIso("   ")).toBeNull()
        expect(localDateTimeToIso(undefined)).toBeNull()
    })

    it("datetime-local parseable → ISO", () => {
        const iso = localDateTimeToIso("2026-06-15T14:30")
        expect(iso).toBe(new Date("2026-06-15T14:30").toISOString())
    })

    it("fecha inválida → Error legible (no RangeError)", () => {
        expect(() => localDateTimeToIso("no-es-fecha", "la fecha promesa")).toThrowError(/fecha promesa/)
        expect(() => localDateTimeToIso("2026-99-99T99:99")).toThrowError(/no es una fecha válida/)
    })
})

describe("partFormIsDirty", () => {
    const clean = { description: "", qty: "1", cost: "", price: "", productQuery: "", linkedProduct: null, rejectNote: "", sourceBranchId: "" }

    it("formulario recién abierto está limpio", () => {
        expect(partFormIsDirty(clean)).toBe(false)
    })

    it.each([
        ["description", { description: "Pantalla" }],
        ["qty", { qty: "3" }],
        ["cost", { cost: "100" }],
        ["price", { price: "250" }],
        ["productQuery", { productQuery: "pant" }],
        ["linkedProduct", { linkedProduct: { id: "p1" } }],
        ["rejectNote", { rejectNote: "muy caro" }],
        ["sourceBranchId", { sourceBranchId: "b2" }],
    ])("ensucia con %s capturado", (_field, patch) => {
        expect(partFormIsDirty({ ...clean, ...patch })).toBe(true)
    })

    it("descripción de solo espacios no ensucia", () => {
        expect(partFormIsDirty({ ...clean, description: "   " })).toBe(false)
    })
})

describe("evidenceUploadSummary", () => {
    it("todo ok → éxito", () => {
        expect(evidenceUploadSummary(1, 0)).toEqual({ type: "success", message: "Evidencia guardada" })
        expect(evidenceUploadSummary(3, 0)).toEqual({ type: "success", message: "3 evidencias guardadas" })
    })

    it("mixto → éxito con conteo de fallos", () => {
        expect(evidenceUploadSummary(2, 1)).toEqual({ type: "success", message: "2 subidas · 1 falló" })
        expect(evidenceUploadSummary(1, 2)).toEqual({ type: "success", message: "1 subida · 2 falló" })
    })

    it("todo falló → error", () => {
        expect(evidenceUploadSummary(0, 2)).toEqual({ type: "error", message: "No se pudo subir ninguna foto. Intenta de nuevo." })
    })

    it("sin intentos → sin toast", () => {
        expect(evidenceUploadSummary(0, 0)).toEqual({ type: "none", message: "" })
    })
})
