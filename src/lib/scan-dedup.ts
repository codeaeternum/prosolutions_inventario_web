// Dedup del escáner continuo: html5-qrcode decodifica el MISMO código en
// frames consecutivos mientras la pieza sigue frente a la cámara — sin una
// ventana de enfriamiento, una sola pasada agregaría el producto varias
// veces. Códigos DISTINTOS pasan al instante (el cajero cambia de pieza);
// el mismo código solo se re-acepta tras la ventana (lo retiró y lo volvió
// a presentar a propósito).

export interface ScanDedupState {
    code: string
    /** Timestamp (ms) de la última aceptación de `code`. */
    at: number
}

export const SCAN_DEDUP_WINDOW_MS = 1800

/**
 * ¿Se acepta `code` en `now`? El mismo código dentro de la ventana → ignorado
 * (re-lectura del frame); un código distinto, o el mismo ya vencida la
 * ventana → aceptado. Solo compara contra el ÚLTIMO código aceptado:
 * alternar A-B-A no extiende la ventana de A.
 */
export function shouldAcceptScan(
    last: ScanDedupState | null,
    code: string,
    now: number,
    windowMs: number = SCAN_DEDUP_WINDOW_MS,
): boolean {
    if (!last || last.code !== code) return true
    return now - last.at >= windowMs
}
