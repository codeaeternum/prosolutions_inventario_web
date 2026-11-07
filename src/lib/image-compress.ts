// Compresión de evidencias en cliente antes de subirlas: fotos de celular
// pesan 3–8 MB y el servidor rechaza >5 MB; reencodar a JPEG ~1600 px las
// deja cómodamente por debajo sin degradar la legibilidad del detalle.

export const EVIDENCE_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const EVIDENCE_MAX_EDGE_PX = 1600
export const EVIDENCE_JPEG_QUALITY = 0.82
// Solo se reencodan archivos grandes: una evidencia chica ya nítida no gana
// nada con otro paso de JPEG (y perdería el PNG si tenía transparencia).
export const EVIDENCE_COMPRESS_OVER_BYTES = 2 * 1024 * 1024

/** Decide si conviene reencodar antes de subir (solo rasters grandes). */
export function shouldCompressImage(file: { type: string; size: number }): boolean {
    return file.size > EVIDENCE_COMPRESS_OVER_BYTES && (EVIDENCE_ACCEPTED_TYPES as readonly string[]).includes(file.type)
}

/** Dimensiones destino conservando proporción, con el lado mayor acotado a maxEdge. */
export function scaledDimensions(width: number, height: number, maxEdge = EVIDENCE_MAX_EDGE_PX): { width: number; height: number } {
    const longest = Math.max(width, height)
    if (longest <= 0) return { width: maxEdge, height: maxEdge }
    if (longest <= maxEdge) return { width, height }
    const scale = maxEdge / longest
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const jpegName = (name: string) => `${(name || "evidencia").replace(/\.[^.]+$/, "") || "evidencia"}.jpg`

/**
 * Devuelve el archivo listo para subir: el original cuando no hace falta
 * comprimir, cuando el canvas no está disponible (navegador viejo, imagen
 * corrupta) o cuando el JPEG saldría más pesado — el servidor valida igual.
 */
export async function compressImageFile(file: File): Promise<File> {
    if (!shouldCompressImage(file)) return file
    try {
        const bitmap = await createImageBitmap(file)
        try {
            const { width, height } = scaledDimensions(bitmap.width, bitmap.height)
            const canvas = document.createElement("canvas")
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext("2d")
            if (!context) return file
            // Fondo blanco: un PNG con alfa pasaría a JPEG con negro de fondo.
            context.fillStyle = "#ffffff"
            context.fillRect(0, 0, width, height)
            context.drawImage(bitmap, 0, 0, width, height)
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", EVIDENCE_JPEG_QUALITY))
            if (!blob || blob.size >= file.size) return file
            return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified })
        } finally {
            bitmap.close()
        }
    } catch {
        return file
    }
}
