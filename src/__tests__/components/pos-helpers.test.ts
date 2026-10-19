import { describe, it, expect } from "vitest"
import {
    DEPOSIT_METHODS,
    PAYMENT_METHODS,
    docItemsToCart,
    exactCodeMatches,
    paymentMethodsFor,
    type PosDocumentDetail,
    type PosProduct,
} from "@/components/pos/types"

const product = (over: Partial<PosProduct> = {}): PosProduct => ({
    id: "p1", name: "Pieza", barcode: "7501234567890", stock: 10,
    retailPrice: 100, wholesalePrice: 80, ...over,
})

// Alta por escáner (cámara o pistola HID con Enter): solo coincidencia
// exacta de barcode o id — un match parcial jamás agrega al ticket solo.
describe("exactCodeMatches", () => {
    const list = [product(), product({ id: "p2", barcode: "ABC-999", name: "Otra" })]

    it("matchea barcode exacto tolerando espacios del wedge", () => {
        expect(exactCodeMatches(list, " 7501234567890 ").map(p => p.id)).toEqual(["p1"])
    })

    it("matchea por id de producto", () => {
        expect(exactCodeMatches(list, "p2").map(p => p.id)).toEqual(["p2"])
    })

    it("no matchea subcadenas ni códigos vacíos", () => {
        expect(exactCodeMatches(list, "750")).toEqual([])
        expect(exactCodeMatches(list, "999")).toEqual([])
        expect(exactCodeMatches(list, "   ")).toEqual([])
    })
})

// Con la caja cerrada el efectivo rebota en el servidor (409
// REGISTER_REQUIRED): se muestra bloqueado, no oculto, para que el cajero
// entienda por qué. null (aún cargando) no bloquea.
describe("paymentMethodsFor", () => {
    it("caja abierta o desconocida devuelve la lista intacta", () => {
        expect(paymentMethodsFor(true)).toBe(PAYMENT_METHODS)
        expect(paymentMethodsFor(null)).toBe(PAYMENT_METHODS)
    })

    it("caja cerrada deshabilita solo el efectivo", () => {
        const methods = paymentMethodsFor(false)
        const efectivo = methods.find(m => m.value === "EFECTIVO")!
        expect(efectivo.disabled).toBe(true)
        expect(efectivo.label).toContain("caja cerrada")
        for (const m of methods.filter(m => m.value !== "EFECTIVO")) expect(m.disabled).toBeUndefined()
    })

    it("también cubre los anticipos de apartado (DEPOSIT_METHODS)", () => {
        const methods = paymentMethodsFor(false, DEPOSIT_METHODS)
        expect(methods.find(m => m.value === "EFECTIVO")!.disabled).toBe(true)
        expect(methods.some(m => m.value === "CREDITO")).toBe(false)
    })
})

// Recuperar una suspendida: el ticket muestra el PRECIO SNAPSHOT del
// documento (eso cobra el checkout), no el catálogo actual, y el tope del
// botón + usa el stock de la sucursal cuando el overlay llegó.
describe("docItemsToCart", () => {
    const doc = {
        id: "d1", number: 7, kind: "RETAIL", total: 200, createdAt: "",
        items: [
            { productId: "p1", quantity: 2, unitPrice: 90, product: product({ retailPrice: 130, wholesalePrice: 110, stock: 50 }) },
            { productId: "p2", quantity: 1, unitPrice: 55, product: { ...product({ id: "p2" }), retailPrice: undefined } as never },
            { productId: "px", quantity: 1, unitPrice: 10, product: null as never },
        ],
    } as unknown as PosDocumentDetail

    it("usa el unitPrice snapshot en ambos modos (mostrador y taller)", () => {
        const [line] = docItemsToCart(doc)
        expect(line.product.retailPrice).toBe(90)
        expect(line.product.wholesalePrice).toBe(90)
        expect(line.quantity).toBe(2)
    })

    it("guarda el precio de catálogo para restaurarlo si el ticket se desliga", () => {
        const [line] = docItemsToCart(doc)
        expect(line.product.catalogRetailPrice).toBe(130)
        expect(line.product.catalogWholesalePrice).toBe(110)
    })

    it("omite líneas sin producto y aplica el overlay de stock por sucursal", () => {
        const items = docItemsToCart(doc, new Map([["p1", 3]]))
        expect(items).toHaveLength(2)
        expect(items[0].product.stock).toBe(3)
        // Sin overlay para p2 cae al stock total que trae el documento.
        expect(items[1].product.stock).toBe(10)
    })
})
