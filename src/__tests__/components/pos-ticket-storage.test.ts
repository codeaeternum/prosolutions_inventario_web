import { describe, expect, it } from "vitest"
import type { PosCustomer, PosProduct } from "@/components/pos/types"
import {
    POS_TICKET_TTL_MS,
    parsePosTicket,
    serializePosTicket,
} from "@/components/pos/ticket-storage"

const NOW = new Date("2026-03-10T12:00:00Z").getTime()

const product = (over: Partial<PosProduct> = {}): PosProduct => ({
    id: "p1", name: "Filtro de aceite", barcode: "7501234567890", stock: 8,
    retailPrice: 350, wholesalePrice: 280, ...over,
})

const customer: PosCustomer = {
    id: "c1", name: "Taller Hermanos", customerType: "STORE",
    phone: "555-0101", creditLimit: 5000, creditBalance: 1200,
}

const state = {
    cart: [{ product: product(), quantity: 2 }],
    customer,
    workshopSale: false,
}

// El borrador local salva el ticket ante reload/corte a medio cobro — pero
// es solo eso, un borrador: el servidor revalida precio y stock al cobrar.
describe("pos ticket storage", () => {
    it("round-trip: serializa y restaura ticket, cliente y modo taller", () => {
        const json = serializePosTicket({ ...state, workshopSale: true }, "b1", NOW)
        const restored = parsePosTicket(json, NOW + 60_000)
        expect(restored).not.toBeNull()
        expect(restored!.cart).toHaveLength(1)
        expect(restored!.cart[0].product.id).toBe("p1")
        expect(restored!.cart[0].quantity).toBe(2)
        expect(restored!.customer?.id).toBe("c1")
        expect(restored!.workshopSale).toBe(true)
    })

    it("vencido, futuro o vacío devuelve null", () => {
        const json = serializePosTicket(state, "b1", NOW)
        expect(parsePosTicket(json, NOW + POS_TICKET_TTL_MS + 1)).toBeNull()
        expect(parsePosTicket(serializePosTicket(state, "b1", NOW + 60_000), NOW)).toBeNull()
        expect(parsePosTicket(serializePosTicket({ ...state, cart: [] }, "b1", NOW), NOW)).toBeNull()
        expect(parsePosTicket(null, NOW)).toBeNull()
    })

    it("json corrupto o con otra forma devuelve null, no truena", () => {
        expect(parsePosTicket("{no-json", NOW)).toBeNull()
        expect(parsePosTicket('"texto"', NOW)).toBeNull()
        expect(parsePosTicket('{"cart": "no-array"}', NOW)).toBeNull()
    })

    it("descarta líneas sin forma cobrable y topa la cantidad al stock guardado", () => {
        const json = JSON.stringify({
            savedAt: NOW,
            cart: [
                { product: product({ id: "ok", stock: 2 }), quantity: 9 },      // topa a 2
                { product: product({ id: "frac" }), quantity: 1.9 },            // floor a 1
                { product: { id: "sin-precio", name: "X" }, quantity: 1 },      // falta precios → fuera
                { product: null, quantity: 1 },                                  // sin producto → fuera
                { product: product({ id: "cero" }), quantity: 0 },              // qty 0 → fuera
            ],
        })
        const restored = parsePosTicket(json, NOW + 1000)
        expect(restored!.cart.map(l => l.product.id)).toEqual(["ok", "frac"])
        expect(restored!.cart[0].quantity).toBe(2)
        expect(restored!.cart[1].quantity).toBe(1)
    })

    it("un cliente corrupto se descarta sin tirar el ticket entero", () => {
        const json = serializePosTicket({ ...state, customer: { id: "", name: "" } as never }, "b1", NOW)
        const restored = parsePosTicket(json, NOW)
        expect(restored!.cart).toHaveLength(1)
        expect(restored!.customer).toBeNull()
    })

    // La llave viaja en el borrador: un crash a medio POST la restaura y el
    // reintento del mismo ticket la reusa — el servidor deduplica el cobro.
    it("round-trip: la llave de idempotencia del cobro sobrevive al reload", () => {
        const checkoutKey = { fingerprint: '{"cart":[…]}', key: "op_abc123" }
        const json = serializePosTicket({ ...state, checkoutKey }, "b1", NOW)
        const restored = parsePosTicket(json, NOW + 60_000)
        expect(restored!.checkoutKey).toEqual(checkoutKey)
    })

    it("sin llave guardada restaura null (borrador anterior a la función)", () => {
        const json = serializePosTicket(state, "b1", NOW)
        expect(parsePosTicket(json, NOW + 60_000)!.checkoutKey).toBeNull()
    })

    it("una llave corrupta se descarta sin tirar el ticket", () => {
        for (const bad of ['"texto"', '{"key":""}', '{"key":"x"}', 'null']) {
            const json = JSON.stringify({
                savedAt: NOW,
                cart: [{ product: product(), quantity: 1 }],
                checkoutKey: JSON.parse(bad),
            })
            const restored = parsePosTicket(json, NOW + 1000)
            expect(restored).not.toBeNull()
            expect(restored!.checkoutKey).toBeNull()
        }
    })
})
