import { describe, it, expect } from "vitest"
import {
  clamp,
  positionTooltip,
  TOUR_GAP,
  TOUR_MARGIN,
  TOUR_STORAGE_KEY,
} from "@/lib/guided-tour"

// El tooltip mide ~20rem (320px); el alto exacto depende del texto.
const vp = { width: 1280, height: 800 }
const tip = { width: 320, height: 140 }
// Objetivo tipo "botón del header": centrado, pegado al top.
const headerTarget = { top: 12, left: 560, width: 240, height: 36 }

describe("positionTooltip", () => {
  it("centra la tarjeta cuando el paso no tiene objetivo", () => {
    const pos = positionTooltip(null, tip, vp)
    expect(pos.placement).toBe("center")
    expect(pos.arrowLeft).toBeNull()
    expect(pos.left).toBe((vp.width - tip.width) / 2)
    expect(pos.top).toBe((vp.height - tip.height) / 2)
  })

  it("ancla el tooltip debajo del objetivo cuando hay espacio", () => {
    const pos = positionTooltip(headerTarget, tip, vp)
    expect(pos.placement).toBe("bottom")
    expect(pos.top).toBe(headerTarget.top + headerTarget.height + TOUR_GAP)
    // Centrado sobre el objetivo: centroX=680 → left=680-160=520.
    expect(pos.left).toBe(520)
    expect(pos.arrowLeft).toBe(160) // centro del tooltip
  })

  it("ancla el tooltip arriba cuando el objetivo está al fondo", () => {
    // Botón de la bottom bar móvil.
    const bottomTarget = { top: 720, left: 560, width: 240, height: 64 }
    const pos = positionTooltip(bottomTarget, tip, vp)
    expect(pos.placement).toBe("top")
    expect(pos.top).toBe(bottomTarget.top - TOUR_GAP - tip.height)
    // El tooltip queda sobre el objetivo sin tocarse.
    expect(pos.top + tip.height).toBeLessThanOrEqual(bottomTarget.top - TOUR_GAP + 1)
  })

  it("clampa a la izquierda cuando el objetivo está pegado al borde", () => {
    // Hamburguesa / primer ítem del sidebar.
    const edgeTarget = { top: 200, left: 8, width: 44, height: 40 }
    const pos = positionTooltip(edgeTarget, tip, vp)
    expect(pos.left).toBe(TOUR_MARGIN)
    // La flecha querría apuntar al centro real del objetivo (30 - 12 = 18),
    // pero el inset mínimo (20px) la mantiene fuera de la esquina redondeada.
    expect(pos.arrowLeft).toBe(20)
  })

  it("clampa a la derecha cuando el objetivo está al final del viewport", () => {
    // Menú de cuenta (avatar) en la esquina superior derecha.
    const edgeTarget = { top: 12, left: 1160, width: 96, height: 40 }
    const pos = positionTooltip(edgeTarget, tip, vp)
    expect(pos.placement).toBe("bottom")
    expect(pos.left).toBe(vp.width - tip.width - TOUR_MARGIN)
    const centroObjetivo = edgeTarget.left + edgeTarget.width / 2 // 1208
    expect(pos.arrowLeft).toBe(centroObjetivo - pos.left)
    // …y la flecha nunca cae en la esquina redondeada del tooltip.
    expect(pos.arrowLeft).toBeLessThanOrEqual(tip.width - 20)
  })

  it("mantiene el tooltip dentro del viewport en pantallas chicas", () => {
    const smallVp = { width: 360, height: 640 }
    const target = { top: 60, left: 160, width: 40, height: 40 }
    const pos = positionTooltip(target, { width: 328, height: 200 }, smallVp)
    expect(pos.left).toBeGreaterThanOrEqual(TOUR_MARGIN)
    expect(pos.left + 328).toBeLessThanOrEqual(smallVp.width - TOUR_MARGIN)
    expect(pos.top).toBeGreaterThanOrEqual(TOUR_MARGIN)
  })

  it("respeta el margen mínimo si el tooltip casi llena el viewport", () => {
    const tinyVp = { width: 300, height: 300 }
    const pos = positionTooltip(null, { width: 320, height: 280 }, tinyVp)
    expect(pos.left).toBe(TOUR_MARGIN)
    expect(pos.top).toBeGreaterThanOrEqual(TOUR_MARGIN)
  })
})

describe("clamp", () => {
  it("devuelve el valor dentro del rango y los límites fuera de él", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(42, 0, 10)).toBe(10)
  })

  it("si max < min, gana el margen mínimo", () => {
    expect(clamp(7, 12, -8)).toBe(12)
  })
})

describe("TOUR_STORAGE_KEY", () => {
  it("está versionada para poder reiniciar el tour", () => {
    expect(TOUR_STORAGE_KEY).toBe("reficio:tour:v1")
  })
})
