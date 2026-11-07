import { describe, expect, it } from "vitest"
import { EVIDENCE_COMPRESS_OVER_BYTES, EVIDENCE_MAX_EDGE_PX, scaledDimensions, shouldCompressImage } from "./image-compress"

describe("shouldCompressImage", () => {
    it("comprime solo imágenes raster que exceden el umbral", () => {
        expect(shouldCompressImage({ type: "image/jpeg", size: EVIDENCE_COMPRESS_OVER_BYTES + 1 })).toBe(true)
        expect(shouldCompressImage({ type: "image/png", size: EVIDENCE_COMPRESS_OVER_BYTES + 1 })).toBe(true)
        expect(shouldCompressImage({ type: "image/webp", size: EVIDENCE_COMPRESS_OVER_BYTES + 1 })).toBe(true)
    })

    it("no degrada archivos chicos", () => {
        expect(shouldCompressImage({ type: "image/jpeg", size: EVIDENCE_COMPRESS_OVER_BYTES })).toBe(false)
        expect(shouldCompressImage({ type: "image/jpeg", size: 100_000 })).toBe(false)
    })

    it("ignora tipos no soportados aunque sean grandes", () => {
        expect(shouldCompressImage({ type: "image/heic", size: EVIDENCE_COMPRESS_OVER_BYTES + 1 })).toBe(false)
        expect(shouldCompressImage({ type: "application/pdf", size: EVIDENCE_COMPRESS_OVER_BYTES + 1 })).toBe(false)
    })
})

describe("scaledDimensions", () => {
    it("conserva las dimensiones cuando ya caben en el máximo", () => {
        expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
        expect(scaledDimensions(EVIDENCE_MAX_EDGE_PX, EVIDENCE_MAX_EDGE_PX)).toEqual({ width: EVIDENCE_MAX_EDGE_PX, height: EVIDENCE_MAX_EDGE_PX })
    })

    it("acota el lado mayor conservando la proporción", () => {
        // 4000×2000 → 1600×800
        expect(scaledDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 })
        // vertical: 2000×4000 → 800×1600
        expect(scaledDimensions(2000, 4000)).toEqual({ width: 800, height: 1600 })
    })

    it("nunca devuelve 0 px en imágenes muy alargadas", () => {
        const result = scaledDimensions(10000, 10)
        expect(result.width).toBe(EVIDENCE_MAX_EDGE_PX)
        expect(result.height).toBeGreaterThanOrEqual(1)
    })

    it("acepta un maxEdge distinto", () => {
        expect(scaledDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 })
    })
})
