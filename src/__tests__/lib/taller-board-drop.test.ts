import { describe, it, expect } from "vitest"
import {
  BOARD_PHASES,
  PHASE_TARGET_STAGE,
  dropTargetForPhase,
  isForwardMove,
  phaseOfStage,
  type BoardPhaseId,
} from "@/lib/taller-board"
import { repairLabels, type RepairStage } from "@/lib/workshop-labels"

const ALL_STAGES = Object.keys(repairLabels) as RepairStage[]
const ACTIVE_STAGES = ALL_STAGES.filter(stage => phaseOfStage(stage)?.id !== "cerradas")
const CLOSED_STAGES = ALL_STAGES.filter(stage => phaseOfStage(stage)?.id === "cerradas")
const PHASE_IDS = BOARD_PHASES.map(phase => phase.id)

describe("PHASE_TARGET_STAGE", () => {
  it("defines the canonical drop target for every phase", () => {
    expect(PHASE_TARGET_STAGE).toEqual({
      entrada: "RECEIVED",
      espera: "WAITING_APPROVAL",
      reparacion: "IN_REPAIR",
      listas: "READY",
      cerradas: "DELIVERED",
    })
    // Cada destino canónico pertenece a su propia fase.
    for (const phase of BOARD_PHASES) {
      expect(phaseOfStage(PHASE_TARGET_STAGE[phase.id])?.id).toBe(phase.id)
    }
  })
})

describe("dropTargetForPhase", () => {
  it("returns null when the order is already inside the target phase", () => {
    // Cada etapa soltada sobre su propia fase: no hay movimiento.
    for (const phase of BOARD_PHASES) {
      for (const stage of phase.stages) {
        expect(dropTargetForPhase(stage, phase.id)).toBeNull()
      }
    }
  })

  it("returns DELIVERED only when dropping READY into cerradas", () => {
    expect(dropTargetForPhase("READY", "cerradas")).toBe("DELIVERED")
  })

  it("rejects dropping any non-READY stage into cerradas", () => {
    // Los cierres que no son entrega (cancelación, no reparado, no autorizado)
    // llevan detalle obligatorio: el drop directo no los ofrece.
    for (const stage of ACTIVE_STAGES) {
      if (stage === "READY") continue
      expect(dropTargetForPhase(stage, "cerradas")).toBeNull()
    }
  })

  it("rejects moving a closed-stage order out of cerradas to any phase", () => {
    // Salir de cerradas reabre la orden → flujo de detalle, no drag & drop.
    for (const stage of CLOSED_STAGES) {
      for (const phaseId of PHASE_IDS) {
        expect(dropTargetForPhase(stage, phaseId)).toBeNull()
      }
    }
  })

  it("returns the canonical target for forward moves between open phases", () => {
    expect(dropTargetForPhase("RECEIVED", "espera")).toBe("WAITING_APPROVAL")
    expect(dropTargetForPhase("DIAGNOSIS", "reparacion")).toBe("IN_REPAIR")
    expect(dropTargetForPhase("WAITING_PARTS", "reparacion")).toBe("IN_REPAIR")
    expect(dropTargetForPhase("EXTERNAL_LAB", "reparacion")).toBe("IN_REPAIR")
    expect(dropTargetForPhase("IN_REPAIR", "listas")).toBe("READY")
    expect(dropTargetForPhase("QUALITY_CHECK", "listas")).toBe("READY")
    expect(dropTargetForPhase("WAITING_APPROVAL", "reparacion")).toBe("IN_REPAIR")
  })

  it("returns the canonical target even for backward/sideways moves (server validates)", () => {
    expect(dropTargetForPhase("IN_REPAIR", "entrada")).toBe("RECEIVED")
    expect(dropTargetForPhase("READY", "entrada")).toBe("RECEIVED")
    expect(dropTargetForPhase("READY", "espera")).toBe("WAITING_APPROVAL")
    expect(dropTargetForPhase("QUALITY_CHECK", "espera")).toBe("WAITING_APPROVAL")
    expect(dropTargetForPhase("WAITING_APPROVAL", "entrada")).toBe("RECEIVED")
    // Sideways: espera → reparación ya contado arriba; espera ↔ espera es la
    // misma fase (cubierto en el test de same-phase).
    expect(dropTargetForPhase("IN_REPAIR", "espera")).toBe("WAITING_APPROVAL")
  })

  it("covers every active stage × open phase combination consistently", () => {
    // Propiedad general: para etapas activas, el resultado es null solo en
    // su propia fase; en cualquier otra fase abierta es el destino canónico.
    for (const stage of ACTIVE_STAGES) {
      for (const phase of BOARD_PHASES) {
        const target = dropTargetForPhase(stage, phase.id)
        if (phase.id === "cerradas") {
          expect(target).toBe(stage === "READY" ? "DELIVERED" : null)
        } else if (phaseOfStage(stage)?.id === phase.id) {
          expect(target).toBeNull()
        } else {
          expect(target).toBe(PHASE_TARGET_STAGE[phase.id])
        }
      }
    }
  })

  it("tolerates null/undefined arguments", () => {
    expect(dropTargetForPhase(null, "entrada")).toBeNull()
    expect(dropTargetForPhase(undefined, "listas")).toBeNull()
    expect(dropTargetForPhase("RECEIVED", null)).toBeNull()
    expect(dropTargetForPhase("READY", undefined)).toBeNull()
    expect(dropTargetForPhase(null, null)).toBeNull()
  })

  it("tolerates an unknown phase id at runtime", () => {
    // El tipo acota a BoardPhaseId, pero un string cualquiera no truena.
    expect(dropTargetForPhase("RECEIVED", "inexistente" as BoardPhaseId)).toBeNull()
  })
})

describe("isForwardMove", () => {
  it("detects forward moves along the pipeline order", () => {
    expect(isForwardMove("RECEIVED", "DIAGNOSIS")).toBe(true)
    expect(isForwardMove("RECEIVED", "IN_REPAIR")).toBe(true)
    expect(isForwardMove("WAITING_PARTS", "READY")).toBe(true)
    expect(isForwardMove("READY", "DELIVERED")).toBe(true)
  })

  it("detects backward and same-stage moves", () => {
    expect(isForwardMove("IN_REPAIR", "RECEIVED")).toBe(false)
    expect(isForwardMove("READY", "WAITING_APPROVAL")).toBe(false)
    expect(isForwardMove("IN_REPAIR", "IN_REPAIR")).toBe(false)
  })

  it("tolerates null/undefined arguments", () => {
    expect(isForwardMove(null, "READY")).toBe(false)
    expect(isForwardMove("RECEIVED", undefined)).toBe(false)
    expect(isForwardMove(null, null)).toBe(false)
  })
})
