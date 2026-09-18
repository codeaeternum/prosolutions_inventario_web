import { describe, expect, it } from "vitest"
import {
  approvedParts,
  approvedPartsTotal,
  orderBalanceCents,
  orderHeldCents,
  orderOverpaidCents,
  orderTotalCents,
} from "@/lib/workshop-money"

// Convención de dinero del taller: quoteCents/approvedQuoteCents son SOLO
// mano de obra; las refacciones APPROVED se cobran además. En cierres sin
// reparación (NOT_AUTHORIZED/NOT_REPAIRED) solo se cobra diagnosticFeeCents.

const part = (qty: number, unitPriceCents: number, unitCostCents = 0, status = "APPROVED") => ({ qty, unitPriceCents, unitCostCents, status })

describe("approvedParts / approvedPartsTotal", () => {
  it("suma solo las autorizadas; REQUESTED y REJECTED son bitácora", () => {
    const parts = [
      part(2, 50000, 30000, "APPROVED"),
      part(1, 10000, 5000, "REQUESTED"),
      part(1, 20000, 8000, "REJECTED"),
    ]
    expect(approvedParts(parts)).toHaveLength(1)
    expect(approvedPartsTotal(parts)).toEqual({ costCents: 60000, priceCents: 100000, marginCents: 40000 })
  })

  it("status ausente/null se trata como APPROVED (registros previos al flujo)", () => {
    expect(approvedPartsTotal([{ qty: 1, unitPriceCents: 7000, unitCostCents: 0 }])).toMatchObject({ priceCents: 7000 })
    expect(approvedPartsTotal([{ qty: 1, unitPriceCents: 7000, unitCostCents: 0, status: null }])).toMatchObject({ priceCents: 7000 })
  })
})

describe("orderTotalCents", () => {
  it("mano de obra cotizada + refacciones autorizadas", () => {
    const order = { status: "IN_REPAIR", quoteCents: 45000, approvedQuoteCents: null }
    expect(orderTotalCents(order, [part(2, 10000), part(1, 5000, 0, "REQUESTED")])).toBe(45000 + 20000)
  })

  it("prefiere approvedQuoteCents sobre quoteCents", () => {
    const order = { status: "READY", quoteCents: 45000, approvedQuoteCents: 40000 }
    expect(orderTotalCents(order, [])).toBe(40000)
  })

  it("sin cotización cobra solo las refacciones autorizadas", () => {
    const order = { status: "IN_REPAIR", quoteCents: null, approvedQuoteCents: null }
    expect(orderTotalCents(order, [part(1, 15000)])).toBe(15000)
  })

  it("NOT_AUTHORIZED cobra solo el cargo de diagnóstico — ni cotización ni refacciones", () => {
    const order = { status: "NOT_AUTHORIZED", quoteCents: 90000, approvedQuoteCents: null, diagnosticFeeCents: 20000 }
    expect(orderTotalCents(order, [part(3, 10000)])).toBe(20000)
  })

  it("NOT_REPAIRED igual: solo el cargo de diagnóstico", () => {
    const order = { status: "NOT_REPAIRED", quoteCents: 90000, approvedQuoteCents: 90000, diagnosticFeeCents: 15000 }
    expect(orderTotalCents(order, [part(2, 30000)])).toBe(15000)
  })

  it("cierre sin reparación sin cargo definido → 0", () => {
    const order = { status: "NOT_AUTHORIZED", quoteCents: 90000, approvedQuoteCents: null, diagnosticFeeCents: null }
    expect(orderTotalCents(order, [part(1, 10000)])).toBe(0)
  })

  it("CANCELLED no genera cargo", () => {
    const order = { status: "CANCELLED", quoteCents: 50000, approvedQuoteCents: 50000, diagnosticFeeCents: 5000 }
    expect(orderTotalCents(order, [part(1, 10000)])).toBe(0)
  })

  it("closedWithoutRepair cobra solo el diagnóstico aunque el status ya sea DELIVERED", () => {
    const order = { status: "DELIVERED", quoteCents: 90000, approvedQuoteCents: 90000, diagnosticFeeCents: 20000, closedWithoutRepair: true }
    expect(orderTotalCents(order, [part(2, 30000)])).toBe(20000)
  })

  it("closedWithoutRepair sin cargo definido → 0", () => {
    const order = { status: "DELIVERED", quoteCents: 90000, approvedQuoteCents: 90000, diagnosticFeeCents: null, closedWithoutRepair: true }
    expect(orderTotalCents(order, [part(1, 10000)])).toBe(0)
  })
})

describe("orderHeldCents", () => {
  it("suma cobros CONFIRMED y resta reembolsos REFUNDED (amount negativo)", () => {
    const payments = [
      { amount: 500, status: "CONFIRMED" },   // anticipo $500
      { amount: 200, status: "CONFIRMED" },   // abono $200
      { amount: -300, status: "REFUNDED" },   // devolución $300
    ]
    expect(orderHeldCents(payments)).toBe(40000)
  })

  it("ignora VOIDED y PENDING_REVIEW", () => {
    const payments = [
      { amount: 500, status: "CONFIRMED" },
      { amount: 500, status: "VOIDED" },
      { amount: 100, status: "PENDING_REVIEW" },
    ]
    expect(orderHeldCents(payments)).toBe(50000)
  })

  it("pagos sin status (selects que ya filtraron) cuentan todos", () => {
    expect(orderHeldCents([{ amount: 100 }, { amount: -40 }])).toBe(6000)
  })
})

describe("orderBalanceCents / orderOverpaidCents", () => {
  const order = { status: "READY", quoteCents: null, approvedQuoteCents: 50000 }

  it("saldo = total (con refacciones) − lo retenido", () => {
    const parts = [part(1, 20000)]
    const payments = [{ amount: 300, status: "CONFIRMED" }]
    expect(orderBalanceCents(order, parts, payments)).toBe(40000)
    expect(orderOverpaidCents(order, parts, payments)).toBe(0)
  })

  it("pagos completos → saldo 0; sobrepago → excedente a favor", () => {
    const payments = [{ amount: 800, status: "CONFIRMED" }]
    expect(orderBalanceCents(order, [], payments)).toBe(0)
    expect(orderOverpaidCents(order, [], payments)).toBe(30000)
  })

  it("la validación de sobrepago usa el mismo saldo (abono > saldo → rechazado)", () => {
    // En PAYMENT el dominio rechaza paymentCents > total − retenido.
    const payments = [{ amount: 100, status: "CONFIRMED" }]
    const pending = orderTotalCents(order, []) - orderHeldCents(payments)
    expect(pending).toBe(40000)
    expect(50000 > pending).toBe(true) // un abono de $500 se rechaza
    expect(40000 > pending).toBe(false) // un abono de $400 exacto pasa
  })

  it("en cierre sin reparación el saldo usa el cargo de diagnóstico", () => {
    const rejected = { status: "NOT_AUTHORIZED", quoteCents: 90000, approvedQuoteCents: null, diagnosticFeeCents: 20000 }
    const payments = [{ amount: 500, status: "CONFIRMED" }] // anticipo mayor al cargo
    expect(orderBalanceCents(rejected, [part(1, 30000)], payments)).toBe(0)
    expect(orderOverpaidCents(rejected, [part(1, 30000)], payments)).toBe(30000)
  })

  it("tras entregar sin reparación el excedente sigue devolvible (status DELIVERED + marca)", () => {
    // La cotización de $900 no "resucita" como saldo fantasma: el total sigue
    // siendo el diagnóstico de $200 y el anticipo de $500 deja $300 a favor.
    const delivered = { status: "DELIVERED", quoteCents: 90000, approvedQuoteCents: 90000, diagnosticFeeCents: 20000, closedWithoutRepair: true }
    const payments = [{ amount: 500, status: "CONFIRMED" }]
    expect(orderBalanceCents(delivered, [part(2, 30000)], payments)).toBe(0)
    expect(orderOverpaidCents(delivered, [part(2, 30000)], payments)).toBe(30000)
  })
})
