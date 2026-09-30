import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { findAllyOffers, normalizeProductName } from "@/lib/domain/ally-catalog"

/**
 * Ofertas aliadas por pieza: la cadena de match (liga encargo → barcode →
 * nombre normalizado) corre por lotes y se corta por producto al primer
 * nivel que encuentra algo. La frontera de visibilidad (ALLIES|PUBLIC,
 * negocio activo distinto, stock > 0) va SIEMPRE en el where.
 */
const BIZ = "biz-mine"

const db = {
    product: { findMany: vi.fn() },
} as unknown as PrismaClient
const findMany = db.product.findMany as unknown as ReturnType<typeof vi.fn>

const allyRow = (over: Record<string, unknown> = {}) => ({
    id: "ap-1",
    name: "Pantalla A55",
    barcode: "7500001",
    stock: 3,
    retailPrice: 500,
    wholesalePrice: 350,
    business: { id: "biz-ally", name: "TallerX" },
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    findMany.mockResolvedValue([])
})

describe("frontera de visibilidad", () => {
    it("toda consulta excluye el propio negocio, HIDDEN y sin stock", async () => {
        await findAllyOffers(db, BIZ, [{ productId: "p1", name: "Pantalla A55" }])
        expect(findMany).toHaveBeenCalledTimes(1)
        const where = findMany.mock.calls[0][0].where
        expect(where).toMatchObject({
            isActive: true,
            marketVisibility: { in: ["ALLIES", "PUBLIC"] },
            stock: { gt: 0 },
            business: { isActive: true, id: { not: BIZ } },
        })
    })
})

describe("cadena de match", () => {
    it("liga directa (encargo → producto del aliado) gana y no consulta más", async () => {
        findMany.mockResolvedValueOnce([allyRow()])
        const offers = await findAllyOffers(db, BIZ, [{
            productId: "p1",
            name: "Otro nombre",
            barcode: "999",
            linkedAllyProductIds: ["ap-1"],
        }])
        expect(findMany).toHaveBeenCalledTimes(1)
        expect(findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["ap-1"] } })
        expect(offers.get("p1")).toEqual([
            { businessId: "biz-ally", businessName: "TallerX", productId: "ap-1", stock: 3, price: 350 },
        ])
    })

    it("sin liga, el barcode exacto empareja al aliado", async () => {
        findMany.mockResolvedValueOnce([allyRow()])
        const offers = await findAllyOffers(db, BIZ, [{
            productId: "p1",
            name: "Nombre distinto",
            barcode: " 7500001 ",
        }])
        expect(findMany).toHaveBeenCalledTimes(1)
        expect(findMany.mock.calls[0][0].where).toMatchObject({ barcode: { in: ["7500001"] } })
        expect(offers.get("p1")).toHaveLength(1)
    })

    it("sin liga ni barcode, el nombre normalizado es el último recurso", async () => {
        findMany.mockResolvedValueOnce([
            allyRow({ id: "ap-9", name: "PANTALLA   Á55" }),
            allyRow({ id: "ap-10", name: "Otra cosa", business: { id: "b2", name: "Otro" } }),
        ])
        const offers = await findAllyOffers(db, BIZ, [{ productId: "p1", name: "pantalla a55" }])
        expect(findMany).toHaveBeenCalledTimes(1)
        expect(findMany.mock.calls[0][0].where).toMatchObject({
            OR: [{ name: { equals: "pantalla a55", mode: "insensitive" } }],
        })
        expect(offers.get("p1")).toEqual([
            { businessId: "biz-ally", businessName: "TallerX", productId: "ap-9", stock: 3, price: 350 },
        ])
    })

    it("una liga que ya no existe en el catálogo aliado cae al barcode", async () => {
        findMany
            .mockResolvedValueOnce([]) // liga apagada (producto HIDDEN o sin stock)
            .mockResolvedValueOnce([allyRow()])
        const offers = await findAllyOffers(db, BIZ, [{
            productId: "p1",
            name: "X",
            barcode: "7500001",
            linkedAllyProductIds: ["ap-gone"],
        }])
        expect(findMany).toHaveBeenCalledTimes(2)
        expect(offers.get("p1")).toHaveLength(1)
    })
})

describe("oferta por negocio", () => {
    it("precio = wholesalePrice y retailPrice solo cuando no hay mayoreo", async () => {
        findMany.mockResolvedValueOnce([
            allyRow({ id: "a1", wholesalePrice: 350 }),
            allyRow({ id: "a2", wholesalePrice: 0, business: { id: "b2", name: "Otro" } }),
        ])
        const offers = await findAllyOffers(db, BIZ, [{ productId: "p1", name: "Pantalla A55" }])
        expect(offers.get("p1")).toEqual([
            { businessId: "biz-ally", businessName: "TallerX", productId: "a1", stock: 3, price: 350 },
            { businessId: "b2", businessName: "Otro", productId: "a2", stock: 3, price: 500 },
        ])
    })

    it("un negocio = una oferta: menor precio y mayor stock de sus filas", async () => {
        findMany.mockResolvedValueOnce([
            allyRow({ id: "a1", stock: 2, wholesalePrice: 400 }),
            allyRow({ id: "a2", stock: 8, wholesalePrice: 300 }),
        ])
        const offers = await findAllyOffers(db, BIZ, [{ productId: "p1", name: "Pantalla A55" }])
        // productId = la fila que fija el precio (la más barata): es la que
        // se pediría al aliado por /api/marketplace/requests.
        expect(offers.get("p1")).toEqual([
            { businessId: "biz-ally", businessName: "TallerX", productId: "a2", stock: 8, price: 300 },
        ])
    })

    it("sin match no aparece la llave en el mapa", async () => {
        const offers = await findAllyOffers(db, BIZ, [{ productId: "p1", name: "Nadie la tiene" }])
        expect(offers.has("p1")).toBe(false)
    })
})

describe("normalizeProductName", () => {
    it("ignora mayúsculas, acentos y espacios repetidos", () => {
        expect(normalizeProductName("  PANTALLA   Á55 ")).toBe("pantalla a55")
    })
})
