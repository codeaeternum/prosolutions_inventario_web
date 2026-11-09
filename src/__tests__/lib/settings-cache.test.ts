import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"

/**
 * Caché de lecturas de ajustes (src/lib/settings.ts): TTL 30 s SOLO fuera de
 * transacción; un lector `tx` siempre consulta fresco y no escribe al caché.
 */

const mocks = vi.hoisted(() => ({
  sysFindUnique: vi.fn(),
  sysFindMany: vi.fn(),
  sysUpsert: vi.fn(),
  settingsFindFirst: vi.fn(),
  businessFindFirst: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSettings: {
      findUnique: mocks.sysFindUnique,
      findMany: mocks.sysFindMany,
      upsert: mocks.sysUpsert,
    },
    settings: { findFirst: mocks.settingsFindFirst },
    business: { findFirst: mocks.businessFindFirst },
  },
}))

import {
  getBusinessSetting,
  getBusinessSettingsMap,
  getOrderFolioDigits,
  getSettings,
  setBusinessSetting,
  resetSettingsCacheForTests,
} from "@/lib/settings"

type SysTx = Pick<Prisma.TransactionClient, "systemSettings">
type SettingsTx = Pick<Prisma.TransactionClient, "settings" | "systemSettings">

/** Lector-tx de mentira: mismos delegates, contadores propios. */
const makeTx = () => ({
  systemSettings: { findUnique: vi.fn(), findMany: vi.fn() },
  settings: { findFirst: vi.fn() },
})

const settingsRow = (over: Record<string, unknown> = {}) => ({
  tempReservationMinutes: 15,
  depositPercentage: 40,
  depositReservationHours: 24,
  pendingVerificationHours: 12,
  exchangeRate: 18.1,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  resetSettingsCacheForTests()
  mocks.sysFindUnique.mockResolvedValue(null)
  mocks.sysFindMany.mockResolvedValue([])
  mocks.sysUpsert.mockResolvedValue({})
  mocks.settingsFindFirst.mockResolvedValue(null)
  mocks.businessFindFirst.mockResolvedValue({ id: "biz-default" })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("getBusinessSetting", () => {
  it("segundo read dentro del TTL no re-consulta (cache hit)", async () => {
    mocks.sysFindUnique.mockResolvedValue({ value: "PS" })
    const a = await getBusinessSetting("biz-1", "order_prefix")
    const b = await getBusinessSetting("biz-1", "order_prefix")
    expect(a).toBe("PS")
    expect(b).toBe("PS")
    expect(mocks.sysFindUnique).toHaveBeenCalledTimes(1)
  })

  it("la ausencia de la llave también se cachea", async () => {
    await getBusinessSetting("biz-1", "nunca_escrita")
    await getBusinessSetting("biz-1", "nunca_escrita")
    expect(mocks.sysFindUnique).toHaveBeenCalledTimes(1)
  })

  it("pasado el TTL re-consulta", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") })
    mocks.sysFindUnique.mockResolvedValue({ value: "v1" })
    await getBusinessSetting("biz-1", "k")
    vi.setSystemTime(new Date("2026-01-01T00:00:31Z"))
    mocks.sysFindUnique.mockResolvedValue({ value: "v2" })
    const v = await getBusinessSetting("biz-1", "k")
    expect(v).toBe("v2")
    expect(mocks.sysFindUnique).toHaveBeenCalledTimes(2)
  })

  it("con tx lee siempre fresco y no contamina la caché", async () => {
    const tx = makeTx()
    tx.systemSettings.findUnique.mockResolvedValue({ value: "TX" })
    const a = await getBusinessSetting("biz-1", "k", tx as unknown as SysTx)
    const b = await getBusinessSetting("biz-1", "k", tx as unknown as SysTx)
    expect(a).toBe("TX")
    expect(b).toBe("TX")
    // Dos lecturas de tx = dos queries; el cliente global no se tocó.
    expect(tx.systemSettings.findUnique).toHaveBeenCalledTimes(2)
    expect(mocks.sysFindUnique).not.toHaveBeenCalled()
  })
})

describe("getBusinessSettingsMap", () => {
  it("un segundo mapa con llaves ya cacheadas no re-consulta esas llaves", async () => {
    mocks.sysFindMany.mockResolvedValue([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ])
    const first = await getBusinessSettingsMap("biz-1", ["a", "b", "c"])
    expect(first.get("a")).toBe("1")
    expect(first.has("c")).toBe(false) // ausente: no entra al mapa
    expect(mocks.sysFindMany).toHaveBeenCalledTimes(1)
    const second = await getBusinessSettingsMap("biz-1", ["a", "c"])
    expect(second.get("a")).toBe("1")
    expect(second.has("c")).toBe(false)
    // Todo ya estaba cacheado (presente o ausente): ninguna query extra.
    expect(mocks.sysFindMany).toHaveBeenCalledTimes(1)
  })

  it("solo consulta las llaves pendientes", async () => {
    mocks.sysFindMany.mockResolvedValue([{ key: "a", value: "1" }])
    await getBusinessSettingsMap("biz-1", ["a"])
    mocks.sysFindMany.mockResolvedValue([{ key: "d", value: "4" }])
    const map = await getBusinessSettingsMap("biz-1", ["a", "d"])
    expect(map.get("a")).toBe("1")
    expect(map.get("d")).toBe("4")
    const query = mocks.sysFindMany.mock.calls[1][0] as { where: { key: { in: string[] } } }
    expect(query.where.key.in).toEqual(["d"])
  })
})

describe("getOrderFolioDigits", () => {
  it("usa la lectura cacheada de la llave (1 query en dos llamadas)", async () => {
    mocks.sysFindUnique.mockResolvedValue({ value: "8" })
    expect(await getOrderFolioDigits("biz-1")).toBe(8)
    expect(await getOrderFolioDigits("biz-1")).toBe(8)
    expect(mocks.sysFindUnique).toHaveBeenCalledTimes(1)
  })
})

describe("setBusinessSetting", () => {
  it("invalida la llave escrita: el siguiente read vuelve a la BD", async () => {
    mocks.sysFindUnique.mockResolvedValue({ value: "viejo" })
    await getBusinessSetting("biz-1", "order_prefix")
    await setBusinessSetting("biz-1", "order_prefix", "nuevo")
    mocks.sysFindUnique.mockResolvedValue({ value: "nuevo" })
    const v = await getBusinessSetting("biz-1", "order_prefix")
    expect(v).toBe("nuevo")
    expect(mocks.sysFindUnique).toHaveBeenCalledTimes(2)
  })
})

describe("getSettings", () => {
  it("con businessId hace 1+1 queries y no llama getDefaultBusinessId", async () => {
    mocks.settingsFindFirst.mockResolvedValue(settingsRow())
    mocks.sysFindMany.mockResolvedValue([{ key: "bank_transfer_info", value: "CLABE 123" }])
    const s = await getSettings("biz-1")
    expect(s.bankTransferInfo).toBe("CLABE 123")
    expect(s.exchangeRate).toBe(18.1)
    expect(mocks.settingsFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.sysFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.businessFindFirst).not.toHaveBeenCalled()
  })

  it("cachea el resultado por negocio (segundo read sin queries)", async () => {
    mocks.settingsFindFirst.mockResolvedValue(settingsRow())
    const a = await getSettings("biz-1")
    const b = await getSettings("biz-1")
    expect(b).toEqual(a)
    expect(mocks.settingsFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.sysFindMany).toHaveBeenCalledTimes(1)
  })

  it("la copia cacheada es segura: mutarla no envenena el caché", async () => {
    mocks.settingsFindFirst.mockResolvedValue(settingsRow())
    const a = await getSettings("biz-1")
    a.exchangeRate = -999
    const b = await getSettings("biz-1")
    expect(b.exchangeRate).toBe(18.1)
  })

  it("sin businessId resuelve el tenant pero cachea las 2 queries internas", async () => {
    mocks.settingsFindFirst.mockResolvedValue(settingsRow())
    await getSettings()
    await getSettings()
    // getDefaultBusinessId queda sin caché a propósito (alta/baja inmediata)…
    expect(mocks.businessFindFirst).toHaveBeenCalledTimes(2)
    // …pero las lecturas de ajustes sí se amortizan.
    expect(mocks.settingsFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.sysFindMany).toHaveBeenCalledTimes(1)
  })

  it("con tx lee siempre fresco y no escribe al caché", async () => {
    const tx = makeTx()
    tx.settings.findFirst.mockResolvedValue(settingsRow())
    tx.systemSettings.findMany.mockResolvedValue([])
    const a = await getSettings("biz-1", tx as unknown as SettingsTx)
    const b = await getSettings("biz-1", tx as unknown as SettingsTx)
    expect(a.exchangeRate).toBe(18.1)
    expect(b.exchangeRate).toBe(18.1)
    expect(tx.settings.findFirst).toHaveBeenCalledTimes(2)
    expect(mocks.settingsFindFirst).not.toHaveBeenCalled()
    // Lo leído dentro de la tx tampoco quedó cacheado: la siguiente lectura
    // global consulta la BD igual que siempre.
    await getSettings("biz-1")
    expect(mocks.settingsFindFirst).toHaveBeenCalledTimes(1)
  })

  it("setBusinessSetting sobre llaves bancarias invalida el resultado cacheado", async () => {
    mocks.settingsFindFirst.mockResolvedValue(settingsRow())
    await getSettings("biz-1")
    await setBusinessSetting("biz-1", "bank_transfer_info", "CLABE 999")
    await getSettings("biz-1")
    expect(mocks.settingsFindFirst).toHaveBeenCalledTimes(2)
  })
})
