import { describe, expect, it, vi } from "vitest"
import type { Transaction } from "@/lib/domain/operations"
import { nextCountNumber, nextOrderNumber, nextPurchaseNumber, nextSaleNumber } from "@/lib/domain/tenant-sequence"

/**
 * nextOrderNumber: folio por tenant via BusinessCounter. El statement debe
 * ser UNO solo y atómico (INSERT … ON CONFLICT … DO UPDATE … RETURNING),
 * sembrar la fila faltante desde el histórico del tenant y devolver el
 * valor previo al incremento.
 */

const queryRaw = vi.fn()
const tx = { $queryRaw: queryRaw } as unknown as Transaction

/** El tagged template llega como (strings, ...params): junta la SQL. */
const sqlOf = (call: unknown[]) =>
  (call[0] as readonly string[]).reduce<string>((acc, s, i) => `${acc}${s}${i < call.length - 1 ? `?${i + 1}` : ""}`, "")

describe("nextOrderNumber", () => {
  it("devuelve el folio reservado por el RETURNING", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 7 }])
    await expect(nextOrderNumber(tx, "biz-1")).resolves.toBe(7)
  })

  it("emite UN statement atómico de upsert + RETURNING", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 1 }])
    await nextOrderNumber(tx, "biz-1")
    expect(queryRaw).toHaveBeenCalledTimes(1)
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain('INSERT INTO "BusinessCounter" ("businessId", "nextOrderNumber")')
    expect(sql).toContain('ON CONFLICT ("businessId")')
    expect(sql).toContain('DO UPDATE SET "nextOrderNumber"')
    expect(sql).toContain('RETURNING "nextOrderNumber" - 1 AS "n"')
  })

  it("siembra la fila faltante desde MAX(number) del tenant (auto-curación)", async () => {
    // Un negocio sin fila en BusinessCounter (alta sin contador, fila
    // borrada a mano) debe continuar el histórico, no reiniciar en 1 —
    // si no, el primer folio chocaría con @@unique([businessId, number]).
    queryRaw.mockResolvedValueOnce([{ n: 42 }])
    await nextOrderNumber(tx, "biz-1")
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain('SELECT COALESCE(MAX("number"), 0) + 2 FROM "RepairOrder"')
  })

  it("pasa businessId como parámetro ligado, nunca interpolado en la SQL", async () => {
    const hostile = 'biz"; DROP TABLE "BusinessCounter' // inyección como dato
    queryRaw.mockResolvedValueOnce([{ n: 3 }])
    await nextOrderNumber(tx, hostile)
    const call = queryRaw.mock.calls[0]
    expect(sqlOf(call)).not.toContain("DROP TABLE")
    // Dos interpolaciones: VALUES($1) y el WHERE del seed.
    expect(call.slice(1)).toEqual([hostile, hostile])
  })

  it.each([
    ["sin filas", []],
    ["folio < 1", [{ n: 0 }]],
    ["folio no entero", [{ n: 1.5 }]],
    ["folio no numérico", [{ n: "7" }]],
  ])("rechaza resultado inválido (%s)", async (_label, rows) => {
    queryRaw.mockResolvedValueOnce(rows)
    await expect(nextOrderNumber(tx, "biz-1")).rejects.toMatchObject({ status: 500, code: "FOLIO_UNAVAILABLE" })
  })
})

describe("nextSaleNumber", () => {
  it("devuelve folios consecutivos reservados por el RETURNING", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ n: 2 }])
    await expect(nextSaleNumber(tx, "biz-1")).resolves.toBe(1)
    await expect(nextSaleNumber(tx, "biz-1")).resolves.toBe(2)
  })

  it("emite UN statement atómico de upsert + RETURNING sobre nextSaleNumber", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 1 }])
    await nextSaleNumber(tx, "biz-1")
    expect(queryRaw).toHaveBeenCalledTimes(1)
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain('INSERT INTO "BusinessCounter" ("businessId", "nextSaleNumber")')
    expect(sql).toContain('ON CONFLICT ("businessId")')
    expect(sql).toContain('DO UPDATE SET "nextSaleNumber"')
    expect(sql).toContain('RETURNING "nextSaleNumber" - 1 AS "n"')
  })

  it("siembra la fila faltante desde MAX(number) de Sale del tenant (auto-curación)", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 42 }])
    await nextSaleNumber(tx, "biz-1")
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain('SELECT COALESCE(MAX("number"), 0) + 2 FROM "Sale"')
  })

  it("pasa businessId como parámetro ligado, nunca interpolado en la SQL", async () => {
    const hostile = 'biz"; DROP TABLE "BusinessCounter'
    queryRaw.mockResolvedValueOnce([{ n: 3 }])
    await nextSaleNumber(tx, hostile)
    const call = queryRaw.mock.calls[0]
    expect(sqlOf(call)).not.toContain("DROP TABLE")
    expect(call.slice(1)).toEqual([hostile, hostile])
  })

  it.each([
    ["sin filas", []],
    ["folio < 1", [{ n: 0 }]],
    ["folio no entero", [{ n: 1.5 }]],
    ["folio no numérico", [{ n: "7" }]],
  ])("rechaza resultado inválido (%s)", async (_label, rows) => {
    queryRaw.mockResolvedValueOnce(rows)
    await expect(nextSaleNumber(tx, "biz-1")).rejects.toMatchObject({ status: 500, code: "FOLIO_UNAVAILABLE" })
  })

  it("tx sin $queryRaw devuelve 1 solo en test; fuera de test lanza", async () => {
    const txSinRaw = {} as unknown as Transaction
    // NODE_ENV=test (vitest): el doble del test no tiene raw y el folio no se
    // persiste — el 1 fijo es inofensivo ahí.
    await expect(nextSaleNumber(txSinRaw, "biz-1")).resolves.toBe(1)

    // Fuera de test un tx sin $queryRaw es un cliente incompleto: devolver 1
    // asignaría el mismo folio a todas las ventas. Mejor un 500 explícito.
    vi.stubEnv("NODE_ENV", "production")
    try {
      await expect(nextSaleNumber(txSinRaw, "biz-1")).rejects.toMatchObject({ status: 500, code: "FOLIO_UNAVAILABLE" })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

/**
 * nextPurchaseNumber/nextCountNumber: mismo contrato que nextSaleNumber —
 * folio por tenant vía BusinessCounter con UN statement atómico
 * (INSERT … ON CONFLICT … DO UPDATE … RETURNING), siembra auto-curativa
 * desde el histórico del tenant y rechazo de resultados inválidos.
 */
describe.each([
  ["nextPurchaseNumber", nextPurchaseNumber, "nextPurchaseNumber", "Purchase", "compra"],
  ["nextCountNumber", nextCountNumber, "nextCountNumber", "InventoryCount", "conteo"],
] as const)("%s", (_name, fn, column, table, label) => {
  it("devuelve el folio reservado por el RETURNING", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 9 }])
    await expect(fn(tx, "biz-1")).resolves.toBe(9)
  })

  it("emite UN statement atómico de upsert + RETURNING sobre su columna", async () => {
    queryRaw.mockResolvedValueOnce([{ n: 1 }])
    await fn(tx, "biz-1")
    expect(queryRaw).toHaveBeenCalledTimes(1)
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain(`INSERT INTO "BusinessCounter" ("businessId", "${column}")`)
    expect(sql).toContain('ON CONFLICT ("businessId")')
    expect(sql).toContain(`DO UPDATE SET "${column}"`)
    expect(sql).toContain(`RETURNING "${column}" - 1 AS "n"`)
  })

  it(`siembra la fila faltante desde MAX(number) de ${table} del tenant (auto-curación)`, async () => {
    queryRaw.mockResolvedValueOnce([{ n: 4 }])
    await fn(tx, "biz-1")
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain(`SELECT COALESCE(MAX("number"), 0) + 2 FROM "${table}"`)
  })

  it("pasa businessId como parámetro ligado, nunca interpolado en la SQL", async () => {
    const hostile = 'biz"; DROP TABLE "BusinessCounter'
    queryRaw.mockResolvedValueOnce([{ n: 3 }])
    await fn(tx, hostile)
    const call = queryRaw.mock.calls[0]
    expect(sqlOf(call)).not.toContain("DROP TABLE")
    expect(call.slice(1)).toEqual([hostile, hostile])
  })

  it.each([
    ["sin filas", []],
    ["folio < 1", [{ n: 0 }]],
    ["folio no entero", [{ n: 1.5 }]],
    ["folio no numérico", [{ n: "7" }]],
  ])("rechaza resultado inválido (%s)", async (_label, rows) => {
    queryRaw.mockResolvedValueOnce(rows)
    await expect(fn(tx, "biz-1")).rejects.toMatchObject({ status: 500, code: "FOLIO_UNAVAILABLE" })
  })

  it(`tx sin $queryRaw devuelve 1 solo en test; fuera de test lanza (${label})`, async () => {
    const txSinRaw = {} as unknown as Transaction
    await expect(fn(txSinRaw, "biz-1")).resolves.toBe(1)
    vi.stubEnv("NODE_ENV", "production")
    try {
      await expect(fn(txSinRaw, "biz-1")).rejects.toMatchObject({ status: 500, code: "FOLIO_UNAVAILABLE" })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
