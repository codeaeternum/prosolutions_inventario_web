import { describe, expect, it } from "vitest"
import { SCAN_DEDUP_WINDOW_MS, shouldAcceptScan } from "@/lib/scan-dedup"

// El modo continuo del escáner depende de esta ventana: la misma pieza frente
// a la cámara decodifica en cada frame y sin dedup entraría N veces al ticket.
describe("scan dedup", () => {
    it("sin lectura previa, cualquier código pasa", () => {
        expect(shouldAcceptScan(null, "7501234", 1000)).toBe(true)
    })

    it("el mismo código dentro de la ventana se ignora (re-lectura del frame)", () => {
        const last = { code: "7501234", at: 1000 }
        expect(shouldAcceptScan(last, "7501234", 1000)).toBe(false)
        expect(shouldAcceptScan(last, "7501234", 1000 + SCAN_DEDUP_WINDOW_MS - 1)).toBe(false)
    })

    it("un código distinto pasa al instante (el cajero cambia de pieza)", () => {
        const last = { code: "7501234", at: 1000 }
        expect(shouldAcceptScan(last, "9998888", 1001)).toBe(true)
    })

    it("el mismo código pasa de nuevo vencida la ventana (segunda unidad a propósito)", () => {
        const last = { code: "7501234", at: 1000 }
        expect(shouldAcceptScan(last, "7501234", 1000 + SCAN_DEDUP_WINDOW_MS)).toBe(true)
        expect(shouldAcceptScan(last, "7501234", 1000 + SCAN_DEDUP_WINDOW_MS + 500)).toBe(true)
    })

    it("alternar A-B-A no extiende la ventana de A (solo compara el último)", () => {
        const a = { code: "A", at: 1000 }
        expect(shouldAcceptScan(a, "B", 1100)).toBe(true)
        // B quedó aceptado en 1100; A en 1101 ya es "distinto" → pasa
        const b = { code: "B", at: 1100 }
        expect(shouldAcceptScan(b, "A", 1101)).toBe(true)
    })

    it("respeta una ventana personalizada", () => {
        const last = { code: "A", at: 0 }
        expect(shouldAcceptScan(last, "A", 4_999, 5_000)).toBe(false)
        expect(shouldAcceptScan(last, "A", 5_000, 5_000)).toBe(true)
    })
})
