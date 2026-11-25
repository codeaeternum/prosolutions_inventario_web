import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { changeCredit } from "@/lib/domain/credit"

/**
 * Límite de crédito bajo concurrencia (addDebt en src/lib/domain/operations.ts):
 * dos cargos simultáneos que JUNTOS exceden el límite no pueden pasar ambos —
 * el check `balance + total > limit` se valida contra el saldo leído y el
 * updateMany optimista (where creditBalance/creditLimit sin cambiar) más la
 * transacción serializable garantizan que exactamente uno asienta. El saldo
 * final jamás excede el límite, ni por un centavo.
 */
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url }).on("error", (err) => console.error("[pg-pool] idle client error:", err))) })
const prefix = `credit-test-${randomUUID()}`
let admin: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

async function customerWithLimit(creditLimit: number) {
  const user = await db.user.create({ data: {
    businessId: biz, name: `${prefix}-${randomUUID().slice(0, 8)}`, role: "CUSTOMER", status: "APPROVED",
    creditLimit, creditBalance: 0,
  } })
  return user.id
}
const balanceOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId } })).creditBalance
const debt = (userId: string, amount: number) =>
  changeCredit(db, admin, biz, "DEBT", { userId, amount, notes: "Cargo de prueba", idempotencyKey: key() })

describe.skipIf(!enabled)("PostgreSQL concurrent credit limit enforcement", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("dos deudas concurrentes que juntas exceden el límite: exactamente una falla y el saldo nunca excede", async () => {
    // Límite $100; dos cargos simultáneos de $60 — juntos serían $120.
    const customer = await customerWithLimit(100)
    const results = await Promise.allSettled([debt(customer, 60), debt(customer, 60)])

    const fulfilled = results.filter(r => r.status === "fulfilled")
    const rejected = results.filter(r => r.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    // El que pierde lo hace cerrado (409): ya sea porque el saldo cambió bajo
    // sus pies o porque al reintentar el límite ya no alcanzaba.
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 })

    // El saldo final es el de UN solo cargo: jamás la suma ni un exceso del límite.
    expect(await balanceOf(customer)).toBe(60)
    expect(await balanceOf(customer)).toBeLessThanOrEqual(100)
    expect(await db.creditMovement.count({ where: { userId: customer, type: "DEBT" } })).toBe(1)
    const movement = await db.creditMovement.findFirstOrThrow({ where: { userId: customer, type: "DEBT" } })
    expect(movement.amount).toBe(60)
  })

  it("el límite se respeta al centavo en secuencial: cargar hasta exactamente el límite pasa, un peso más falla", async () => {
    const customer = await customerWithLimit(100)
    await debt(customer, 60)
    // 60 + 40 = exactamente el límite: la regla es `>`, no `>=`.
    await debt(customer, 40)
    expect(await balanceOf(customer)).toBe(100)
    await expect(debt(customer, 0.01)).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CREDIT" })
    expect(await balanceOf(customer)).toBe(100)
    expect(await db.creditMovement.count({ where: { userId: customer, type: "DEBT" } })).toBe(2)
  })

  it("tres deudas concurrentes dentro del límite asientan todas — el freno no inventa falsos positivos", async () => {
    // Control: límite $100, tres cargos de $20 ($60 total) — todos caben.
    const customer = await customerWithLimit(100)
    const results = await Promise.allSettled([debt(customer, 20), debt(customer, 20), debt(customer, 20)])
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3)
    expect(await balanceOf(customer)).toBe(60)
    expect(await db.creditMovement.count({ where: { userId: customer, type: "DEBT" } })).toBe(3)
  })
})
