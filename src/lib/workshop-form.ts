// Lógica pura de formularios del taller (extraída para pruebas en Node):
// normalización de strings vacíos, parseo de datetime-local, borradores
// sucios y resumen del lote de evidencias.

/** `""`/espacios → undefined (los esquemas del dominio exigen min(1)). */
export function textOrUndefined(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim() ?? ""
    return trimmed === "" ? undefined : trimmed
}

/**
 * Convierte el valor de un input datetime-local a ISO. `""` → null (limpiar
 * el campo en el servidor); fecha no parseable → Error legible en lugar del
 * RangeError críptico de Date#toISOString.
 */
export function localDateTimeToIso(value: string | null | undefined, label = "la fecha"): string | null {
    const raw = value?.trim() ?? ""
    if (raw === "") return null
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) throw new Error(`Revisa ${label}: no es una fecha válida.`)
    return parsed.toISOString()
}

/** Estado del capturador de refacciones: cualquier captura sin guardar ensucia. */
export function partFormIsDirty(form: {
    description: string
    qty: string
    cost: string
    price: string
    productQuery: string
    linkedProduct: unknown
    rejectNote: string
    sourceBranchId: string
}): boolean {
    return (
        form.description.trim() !== "" ||
        form.cost !== "" ||
        form.price !== "" ||
        form.qty !== "1" ||
        form.productQuery.trim() !== "" ||
        form.linkedProduct !== null ||
        form.rejectNote.trim() !== "" ||
        form.sourceBranchId !== ""
    )
}

/** Resumen del lote de subida de evidencias para el toast final. */
export function evidenceUploadSummary(ok: number, fail: number): { type: "success" | "error" | "none"; message: string } {
    if (ok > 0 && fail === 0) return { type: "success", message: ok === 1 ? "Evidencia guardada" : `${ok} evidencias guardadas` }
    if (ok > 0) return { type: "success", message: `${ok} subida${ok === 1 ? "" : "s"} · ${fail} falló` }
    if (fail > 0) return { type: "error", message: "No se pudo subir ninguna foto. Intenta de nuevo." }
    return { type: "none", message: "" }
}
