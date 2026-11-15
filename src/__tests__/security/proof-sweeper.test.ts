import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * sweepOrphanedPaymentProofs — barrido de comprobantes huérfanos que corre el
 * cron de /api/reservations/check-expiring.
 *
 * Reglas de seguridad que se congelan aquí:
 *   - solo se borra una imagen con mtime >24 h que NINGUNA reserva ni pago
 *     referencia (la gracia cubre la ventana upload→attach del flujo real);
 *   - la decisión final es el conteo en BD, nunca la edad: un archivo
 *     referenciado se conserva por viejo que sea;
 *   - el sidecar .json muere con su imagen; un .json suelto nunca se barre;
 *   - best-effort: ni un readdir/stat/unlink fallido ni una consulta caída
 *     tumban el barrido — el archivo queda para la próxima corrida;
 *   - acotado por `limit`: lo que no quepa se barre después.
 */

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: mocks.readdir,
      stat: mocks.stat,
      realpath: mocks.realpath,
      unlink: mocks.unlink,
    },
  }
})

import { sweepOrphanedPaymentProofs } from "@/lib/payment-proofs"

const DIR = "/test/proofs"
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })

/** Contador fake de referencias (Reservation.paymentProofUrl / Payment.proofUrl). */
const fakeDb = (reservations = 0, payments = 0) => ({
  reservation: { count: vi.fn(async () => reservations) },
  payment: { count: vi.fn(async () => payments) },
})

const staleMs = Date.now() - 2 * DAY
const freshMs = Date.now() - HOUR

const statOf = (mtimeMs: number) => ({ isFile: () => true, mtimeMs, size: 1024 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("PAYMENT_PROOFS_DIR", DIR)
  mocks.unlink.mockResolvedValue(undefined)
  // confinedPath resuelve dentro del dir privado; el dir legacy
  // public/uploads/payments no existe en el sandbox del test (ENOENT tolerado).
  mocks.realpath.mockImplementation(async (p: unknown) => {
    const s = String(p)
    if (s.includes("public")) throw enoent()
    return s
  })
})

describe("sweepOrphanedPaymentProofs", () => {
  it("borra imagen + sidecar de un archivo >24 h sin referencias y devuelve el conteo", async () => {
    mocks.readdir.mockResolvedValue(["a1.png", "a1.png.json", "b2.jpg", "b2.jpg.json"])
    mocks.stat.mockResolvedValue(statOf(staleMs))

    const swept = await sweepOrphanedPaymentProofs(fakeDb())
    expect(swept).toBe(2)

    const unlinked = mocks.unlink.mock.calls.map((c) => String(c[0]))
    expect(unlinked).toContain(`${DIR}/a1.png`)
    expect(unlinked).toContain(`${DIR}/a1.png.json`)
    expect(unlinked).toContain(`${DIR}/b2.jpg`)
    expect(unlinked).toContain(`${DIR}/b2.jpg.json`)
  })

  it("un archivo referenciado por una reserva o un pago NUNCA se borra, aunque sea viejo", async () => {
    mocks.readdir.mockResolvedValue(["keep.png"])
    mocks.stat.mockResolvedValue(statOf(staleMs))

    const swept = await sweepOrphanedPaymentProofs(fakeDb(1, 0))
    expect(swept).toBe(0)
    expect(mocks.unlink).not.toHaveBeenCalled()
  })

  it("un archivo reciente (<24 h) sin referencias se conserva: aún puede estar a medio flujo", async () => {
    mocks.readdir.mockResolvedValue(["nuevo.png"])
    mocks.stat.mockResolvedValue(statOf(freshMs))

    const swept = await sweepOrphanedPaymentProofs(fakeDb())
    expect(swept).toBe(0)
    expect(mocks.unlink).not.toHaveBeenCalled()
  })

  it("ignora entradas que no son imagen de comprobante (.json suelto, notas, subdirs)", async () => {
    mocks.readdir.mockResolvedValue(["huerfano.png.json", "notas.txt", ".DS_Store"])
    const swept = await sweepOrphanedPaymentProofs(fakeDb())
    expect(swept).toBe(0)
    // Ni siquiera consultó la BD: validProofFilename filtró todo antes.
    expect(mocks.stat).not.toHaveBeenCalled()
    expect(mocks.unlink).not.toHaveBeenCalled()
  })

  it("un conteo en BD que falla no aborta el barrido ni borra el archivo", async () => {
    mocks.readdir.mockResolvedValue(["a1.png", "b2.png"])
    mocks.stat.mockResolvedValue(statOf(staleMs))
    const db = {
      reservation: { count: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(0) },
      payment: { count: vi.fn(async () => 0) },
    }
    const swept = await sweepOrphanedPaymentProofs(db)
    // a1 quedó para la próxima corrida (conteo falló); b2 sí se barrió.
    expect(swept).toBe(1)
    const unlinked = mocks.unlink.mock.calls.map((c) => String(c[0]))
    expect(unlinked).not.toContain(`${DIR}/a1.png`)
    expect(unlinked).toContain(`${DIR}/b2.png`)
  })

  it("un readdir fallido (volumen ausente) devuelve 0 sin lanzar", async () => {
    mocks.readdir.mockRejectedValue(enoent())
    await expect(sweepOrphanedPaymentProofs(fakeDb())).resolves.toBe(0)
  })

  it("respeta el límite: lo que no quepa queda para la próxima corrida", async () => {
    mocks.readdir.mockResolvedValue(["f1.png", "f2.png", "f3.png"])
    mocks.stat.mockResolvedValue(statOf(staleMs))
    const swept = await sweepOrphanedPaymentProofs(fakeDb(), { limit: 1 })
    expect(swept).toBe(1)
  })
})
