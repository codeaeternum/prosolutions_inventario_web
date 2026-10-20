import { describe, it, expect } from "vitest"
import {
    DEPOSIT_METHODS,
    PAYMENT_METHODS,
    amountToCents,
    docAgeLabel,
    docItemsToCart,
    exactCodeMatches,
    paymentDraftsCents,
    paymentMethodsFor,
    toPaymentsPayload,
    type PaymentDraft,
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

// Pago dividido: el servidor cuadra los pagos contra el total en centavos
// EXACTOS (settleSalePayments) y rechaza montos con más de dos decimales
// (cents()). El cliente valida en la misma unidad — sin tolerancia flotante.
describe("amountToCents", () => {
    it("convierte montos capturados a centavos enteros", () => {
        expect(amountToCents("10.55")).toBe(1055)
        expect(amountToCents("100")).toBe(10000)
        expect(amountToCents("0.01")).toBe(1)
    })

    it("redondea a dos decimales al parsear: un tercer decimal no rebota en el servidor", () => {
        // Mismo Math.round(x*100) que cents() del dominio: half-up sobre el
        // float — "10.005" vale 1001 centavos en ambos lados, nunca diverge.
        expect(amountToCents("10.005")).toBe(1001)
        expect(amountToCents("10.004")).toBe(1000)
        expect(amountToCents("19.999")).toBe(2000)
    })

    it("texto no numérico, vacío o no positivo vale cero", () => {
        expect(amountToCents("")).toBe(0)
        expect(amountToCents("abc")).toBe(0)
        expect(amountToCents("0")).toBe(0)
        expect(amountToCents("-5")).toBe(0)
    })
})

describe("paymentDraftsCents", () => {
    const draft = (amount: string, method: PaymentDraft["method"] = "EFECTIVO"): PaymentDraft => ({ method, amount })

    it("suma exacta en centavos: 33.33+33.33+33.34 cuadra 100.00 sin residuo", () => {
        expect(paymentDraftsCents([draft("33.33"), draft("33.33"), draft("33.34")])).toBe(10000)
    })

    it("un centavo de sobra o de falta ya no cuadra (== lo que exige el servidor)", () => {
        expect(paymentDraftsCents([draft("50"), draft("50.01")])).not.toBe(10000)
        expect(paymentDraftsCents([draft("50"), draft("49.99")])).not.toBe(10000)
        // "10.005" ya no se cuela con tolerancia: redondea a 1001 y sobra 1¢.
        expect(paymentDraftsCents([draft("90"), draft("10.005")])).toBe(10001)
    })
})

describe("toPaymentsPayload", () => {
    it("envía cada monto con máximo dos decimales (el redondeo del parseo)", () => {
        // "10.005" viaja como 10.01: cents() del servidor lo valúa en los
        // mismos 1001 centavos que el cliente ya validó — nunca diverge.
        const payload = toPaymentsPayload([{ method: "EFECTIVO", amount: "10.005" }])
        expect(payload[0].amount).toBe(10.01)
    })

    it("conserva el método y solo adjunta referencia en transferencias capturadas", () => {
        const payload = toPaymentsPayload([
            { method: "TRANSFERENCIA", amount: "60", reference: "  SPEI-123  " },
            { method: "TARJETA", amount: "40.50", reference: "ignorada" },
        ])
        expect(payload).toEqual([
            { method: "TRANSFERENCIA", amount: 60, reference: "SPEI-123" },
            { method: "TARJETA", amount: 40.5 },
        ])
    })
})

// Lista «Recuperar»: el DRAFT no retiene stock ni dinero, pero una suspendida
// vieja es candidata a descartarse — la antigüedad se muestra al staff.
describe("docAgeLabel", () => {
    const now = new Date("2026-03-10T12:00:00Z").getTime()
    const ago = (ms: number) => new Date(now - ms).toISOString()

    it("minutos y horas para lo reciente", () => {
        expect(docAgeLabel(ago(30_000), now)).toBe("hace <1 min")
        expect(docAgeLabel(ago(5 * 60_000), now)).toBe("hace 5 min")
        expect(docAgeLabel(ago(59 * 60_000), now)).toBe("hace 59 min")
        expect(docAgeLabel(ago(3 * 3_600_000), now)).toBe("hace 3 h")
    })

    it("días para lo viejo, con singular correcto", () => {
        expect(docAgeLabel(ago(26 * 3_600_000), now)).toBe("hace 1 día")
        expect(docAgeLabel(ago(3 * 86_400_000), now)).toBe("hace 3 días")
        expect(docAgeLabel(ago(40 * 86_400_000), now)).toBe("hace 40 días")
    })

    it("fecha futura o inválida no produce antigüedad negativa", () => {
        expect(docAgeLabel(ago(-60_000), now)).toBe("hace <1 min")
        expect(docAgeLabel("no-es-fecha", now)).toBe("hace <1 min")
    })
})
