import { describe, expect, it } from "vitest"
import { creditAging, creditAgingByUser, type CreditAgingMovement } from "@/lib/credit-aging"

const NOW = new Date("2025-06-15T12:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

const debt = (amount: number, at: Date): CreditAgingMovement => ({ type: "DEBT", amount, createdAt: at })
const pay = (amount: number, at: Date): CreditAgingMovement => ({ type: "PAYMENT", amount, createdAt: at })
const rev = (amount: number, at: Date): CreditAgingMovement => ({ type: "REVERSAL", amount, createdAt: at })

describe("creditAging", () => {
  it("sin movimientos o sin deuda descubierta no tiene bucket", () => {
    expect(creditAging([], NOW)).toEqual({ oldestDebtAt: null, daysOverdue: 0, bucket: null })
    expect(creditAging([pay(500, daysAgo(3))], NOW).bucket).toBeNull()
    expect(creditAging([debt(100, daysAgo(9)), pay(100, daysAgo(2))], NOW).bucket).toBeNull()
  })

  it("un cargo sin abonar marca la antigüedad y su bucket", () => {
    expect(creditAging([debt(100, daysAgo(0))], NOW)).toMatchObject({ daysOverdue: 0, bucket: "0-7" })
    expect(creditAging([debt(100, daysAgo(7))], NOW)).toMatchObject({ daysOverdue: 7, bucket: "0-7" })
    expect(creditAging([debt(100, daysAgo(8))], NOW)).toMatchObject({ daysOverdue: 8, bucket: "8-15" })
    expect(creditAging([debt(100, daysAgo(15))], NOW)).toMatchObject({ bucket: "8-15" })
    expect(creditAging([debt(100, daysAgo(16))], NOW)).toMatchObject({ bucket: "16-30" })
    expect(creditAging([debt(100, daysAgo(30))], NOW)).toMatchObject({ bucket: "16-30" })
    expect(creditAging([debt(100, daysAgo(31))], NOW)).toMatchObject({ bucket: "30+" })
  })

  it("FIFO: abono parcial cubre primero el cargo más viejo", () => {
    const aging = creditAging([
      debt(100, daysAgo(40)),
      debt(50, daysAgo(10)),
      pay(120, daysAgo(1)),
    ], NOW)
    // 120 cubren los 100 del cargo viejo y 20 del reciente: quedan 30 del de hace 10 días
    expect(aging).toMatchObject({ oldestDebtAt: daysAgo(10).toISOString(), daysOverdue: 10, bucket: "8-15" })
  })

  it("FIFO: abono que no alcanza al cargo más viejo lo deja como antigüedad", () => {
    const aging = creditAging([
      debt(100, daysAgo(40)),
      debt(50, daysAgo(10)),
      pay(80, daysAgo(1)),
    ], NOW)
    expect(aging).toMatchObject({ oldestDebtAt: daysAgo(40).toISOString(), daysOverdue: 40, bucket: "30+" })
  })

  it("deuda vieja ya cubierta → la antigüedad la marca la siguiente", () => {
    const aging = creditAging([
      debt(100, daysAgo(40)),
      pay(100, daysAgo(35)),
      debt(60, daysAgo(12)),
    ], NOW)
    expect(aging).toMatchObject({ oldestDebtAt: daysAgo(12).toISOString(), daysOverdue: 12, bucket: "8-15" })
  })

  it("REVERSAL también cubre deuda y el excedente aplica a cargos futuros", () => {
    const aging = creditAging([
      rev(50, daysAgo(30)),
      pay(100, daysAgo(30)),
      debt(100, daysAgo(20)),
      debt(80, daysAgo(5)),
    ], NOW)
    // 150 de crédito cubren el primer cargo y 50 del segundo → antigüedad = hace 5 días
    expect(aging).toMatchObject({ oldestDebtAt: daysAgo(5).toISOString(), daysOverdue: 5, bucket: "0-7" })
  })

  it("ignora cargos de monto cero", () => {
    const aging = creditAging([debt(0, daysAgo(60)), debt(30, daysAgo(2))], NOW)
    expect(aging).toMatchObject({ oldestDebtAt: daysAgo(2).toISOString(), bucket: "0-7" })
  })
})

describe("creditAgingByUser", () => {
  it("calcula el aging por usuario", () => {
    const map = creditAgingByUser([
      { userId: "a", ...debt(100, daysAgo(20)) },
      { userId: "b", ...debt(50, daysAgo(3)) },
      { userId: "b", ...pay(50, daysAgo(1)) },
    ], NOW)
    expect(map.get("a")).toMatchObject({ bucket: "16-30" })
    expect(map.get("b")?.bucket).toBeNull()
    expect(map.has("c")).toBe(false)
  })
})
