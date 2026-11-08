import { describe, it, expect } from "vitest"
import {
  ACTIVE_BOARD_STAGES,
  ALL_BOARD_STAGES,
  BOARD_PHASES,
  CLOSED_BOARD_STAGES,
  phaseOfStage,
  phaseOrders,
  phaseStageCounts,
  phaseTotal,
  stageIndexInPhase,
} from "@/lib/taller-board"
import { repairLabels, type RepairStage } from "@/lib/workshop-labels"

type TestOrder = { id: string; status: RepairStage; createdAt: string }
const order = (id: string, status: RepairStage, createdAt: string): TestOrder => ({ id, status, createdAt })
const ids = (orders: TestOrder[]) => orders.map(o => o.id)

const entrada = BOARD_PHASES.find(p => p.id === "entrada")!
const cerradas = BOARD_PHASES.find(p => p.id === "cerradas")!

describe("BOARD_PHASES", () => {
  it("partitions ALL_BOARD_STAGES: every board stage is in exactly one phase", () => {
    const seen = new Map<RepairStage, number>()
    for (const phase of BOARD_PHASES) {
      for (const stage of phase.stages) {
        seen.set(stage, (seen.get(stage) ?? 0) + 1)
      }
    }
    // Sin duplicados: cada etapa aparece una sola vez.
    for (const stage of ALL_BOARD_STAGES) {
      expect(seen.get(stage)).toBe(1)
    }
    // Sin faltantes ni extras: la unión de fases = ALL_BOARD_STAGES.
    expect(seen.size).toBe(ALL_BOARD_STAGES.length)
    expect([...seen.keys()].sort()).toEqual([...ALL_BOARD_STAGES].sort())
  })

  it("keeps the active/closed split consistent with the legacy columns", () => {
    expect(ACTIVE_BOARD_STAGES).toEqual([
      "RECEIVED", "DIAGNOSIS", "WAITING_APPROVAL", "WAITING_PARTS",
      "EXTERNAL_LAB", "IN_REPAIR", "QUALITY_CHECK", "READY",
    ])
    expect(CLOSED_BOARD_STAGES).toEqual([
      "DELIVERED", "NOT_REPAIRED", "NOT_AUTHORIZED", "CANCELLED", "WARRANTY",
    ])
    expect(BOARD_PHASES.flatMap(p => p.stages)).toEqual(ALL_BOARD_STAGES)
  })

  it("maps every stage to its phase via phaseOfStage", () => {
    expect(phaseOfStage("DIAGNOSIS")?.id).toBe("entrada")
    expect(phaseOfStage("EXTERNAL_LAB")?.id).toBe("espera")
    expect(phaseOfStage("QUALITY_CHECK")?.id).toBe("reparacion")
    expect(phaseOfStage("READY")?.id).toBe("listas")
    expect(phaseOfStage("WARRANTY")?.id).toBe("cerradas")
  })
})

describe("phaseOrders", () => {
  it("sorts by pipeline stage order first, then createdAt ASC (oldest first)", () => {
    const orders = {
      RECEIVED: [
        order("r2", "RECEIVED", "2024-06-02T10:00:00Z"),
        order("r1", "RECEIVED", "2024-06-01T10:00:00Z"),
      ],
      DIAGNOSIS: [
        order("d1", "DIAGNOSIS", "2023-01-01T10:00:00Z"), // más vieja, pero la etapa va después
      ],
    } as Record<RepairStage, TestOrder[]>

    // Aunque d1 es más vieja, el orden de pipeline (RECEIVED antes que
    // DIAGNOSIS) manda; dentro de la etapa gana la más vieja.
    expect(ids(phaseOrders(entrada, orders))).toEqual(["r1", "r2", "d1"])
  })

  it("orders the closed phase by its own stage order (DELIVERED before CANCELLED)", () => {
    const orders = {
      CANCELLED: [order("c1", "CANCELLED", "2020-01-01T00:00:00Z")],
      DELIVERED: [order("x1", "DELIVERED", "2024-01-01T00:00:00Z")],
    } as Record<RepairStage, TestOrder[]>
    expect(ids(phaseOrders(cerradas, orders))).toEqual(["x1", "c1"])
  })

  it("tolerates missing stages, empty stages and null/undefined board data", () => {
    // Record parcial (sin DIAGNOSIS) y Record vacío.
    const partial = { RECEIVED: [order("r1", "RECEIVED", "2024-06-01T10:00:00Z")] } as Record<RepairStage, TestOrder[]>
    expect(ids(phaseOrders(entrada, partial))).toEqual(["r1"])
    expect(phaseOrders(entrada, {} as Record<RepairStage, TestOrder[]>)).toEqual([])
    expect(phaseOrders(entrada, null)).toEqual([])
    expect(phaseOrders(entrada, undefined)).toEqual([])
  })

  it("does not mutate the input arrays", () => {
    const received = [order("r2", "RECEIVED", "2024-06-02T10:00:00Z"), order("r1", "RECEIVED", "2024-06-01T10:00:00Z")]
    const diagnosis = [order("d1", "DIAGNOSIS", "2024-06-01T09:00:00Z")]
    const orders = { RECEIVED: received, DIAGNOSIS: diagnosis } as Record<RepairStage, TestOrder[]>

    phaseOrders(entrada, orders)

    expect(ids(received)).toEqual(["r2", "r1"]) // el arreglo original conserva su orden
    expect(ids(diagnosis)).toEqual(["d1"])
    expect(orders.RECEIVED).toBe(received)
  })
})

describe("phaseTotal", () => {
  it("sums the totals of the phase stages", () => {
    const totals = { RECEIVED: 2, DIAGNOSIS: 3, IN_REPAIR: 9 } as Record<RepairStage, number>
    expect(phaseTotal(entrada, totals)).toBe(5)
  })

  it("treats missing keys as 0 and tolerates null/undefined totals", () => {
    const totals = { RECEIVED: 4 } as Record<RepairStage, number>
    expect(phaseTotal(entrada, totals)).toBe(4)
    expect(phaseTotal(entrada, null)).toBe(0)
    expect(phaseTotal(entrada, undefined)).toBe(0)
  })
})

describe("phaseStageCounts", () => {
  it("returns only stages with count > 0, in the phase's stage order", () => {
    const totals = {
      RECEIVED: 2,
      DIAGNOSIS: 0,
      WAITING_APPROVAL: 1,
      WAITING_PARTS: 3,
      EXTERNAL_LAB: 0,
      DELIVERED: 7,
    } as Record<RepairStage, number>

    const espera = BOARD_PHASES.find(p => p.id === "espera")!
    expect(phaseStageCounts(espera, totals)).toEqual([
      { stage: "WAITING_APPROVAL", count: 1 },
      { stage: "WAITING_PARTS", count: 3 },
    ])
    // DIAGNOSIS está en 0 → se omite aunque tenga llave.
    expect(phaseStageCounts(entrada, totals)).toEqual([{ stage: "RECEIVED", count: 2 }])
  })

  it("returns empty list on null/undefined totals", () => {
    expect(phaseStageCounts(entrada, null)).toEqual([])
    expect(phaseStageCounts(entrada, undefined)).toEqual([])
  })
})

describe("stageIndexInPhase", () => {
  it("returns the pipeline index inside the phase and -1 for foreign stages", () => {
    expect(stageIndexInPhase(entrada, "RECEIVED")).toBe(0)
    expect(stageIndexInPhase(entrada, "DIAGNOSIS")).toBe(1)
    expect(stageIndexInPhase(entrada, "READY")).toBe(-1)
  })
})

describe("board stage coverage", () => {
  it("only references real RepairStage keys", () => {
    for (const stage of ALL_BOARD_STAGES) {
      expect(stage in repairLabels).toBe(true)
    }
  })
})
