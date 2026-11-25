import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { decideCashRequest } from "@/lib/domain/cash-requests"
import { changeCash } from "@/lib/domain/cash"

/**
 * Doble aprobación concurrente de una solicitud de gasto
 * (src/lib/domain/cash-requests.ts): dos APPROVE simultáneos sobre la misma
 * solicitud PENDING no pueden asentar dos salidas de efectivo — el updateMany
 * condicionado a status PENDING más la transacción serializable garantizan
 * que exactamente un CashMovement OUT queda asentado y la caja se descuenta
 * una sola vez.
 */
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url }).on("error", (err) => console.error("[pg-pool] idle client error:", err))) })
const prefix = `cashreq-test-${randomUUID()}`
let admin: string, employee: string, branchA: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

/** Solicitud PENDING directa en BD: la creación vive en la ruta HTTP, no en el dominio. */
async function pendingRequest(amountCents: number) {
  const request = await db.cashRequest.create({ data: {
    businessId: biz, branchId: branchA, amountCents,
    concept: `Gasto de prueba ${randomUUID().slice(0, 8)}`, requestedById: employee,
  } })
  return request.id
}

describe.skipIf(!enabled)("PostgreSQL concurrent cash request approval", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    employee = (await db.user.create({ data: { businessId: biz, name: `${prefix}-emp`, role: "EMPLOYEE", status: "APPROVED" } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    // La base de fixture persiste entre corridas: solo se cierran cajas
    // huérfanas de corridas muertas (>5 min), como en los otros archivos.
    await db.cashRegister.updateMany({
      where: { status: "OPEN", openedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
      data: { status: "CLOSED", closedAt: new Date() },
    })
    // Caja con $500 de fondo: alcanza para cada gasto de prueba por separado.
    await changeCash(db, admin, biz, { action: "OPEN", amount: 500, branchId: branchA, idempotencyKey: key() })
  })
  afterAll(async () => { await db.$disconnect() })

  it("dos APPROVE concurrentes asientan exactamente un CashMovement y descuentan la caja una sola vez", async () => {
    const requestId = await pendingRequest(10000) // $100
    // Llaves distintas a propósito: no es replay idempotente, son dos decisiones
    // independientes compitiendo por la misma solicitud.
    const results = await Promise.allSettled([
      decideCashRequest(db, admin, biz, requestId, { decision: "APPROVE", idempotencyKey: key() }),
      decideCashRequest(db, admin, biz, requestId, { decision: "APPROVE", idempotencyKey: key() }),
    ])

    const fulfilled = results.filter(r => r.status === "fulfilled")
    const rejected = results.filter(r => r.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 })

    // Exactamente un movimiento de salida ligado a la solicitud.
    const movements = await db.cashMovement.findMany({ where: { referenceType: "EXPENSE", referenceId: requestId } })
    expect(movements).toHaveLength(1)
    expect(movements[0].type).toBe("OUT")
    expect(movements[0].amount).toBe(100)

    const stored = await db.cashRequest.findUniqueOrThrow({ where: { id: requestId } })
    expect(stored.status).toBe("APPROVED")
    expect(stored.decidedById).toBe(admin)
    expect(stored.cashMovementId).toBe(movements[0].id)

    // La caja bajó exactamente una vez: fondo $500 − un gasto de $100 = $400.
    const register = await db.cashRegister.findFirstOrThrow({ where: { id: movements[0].registerId } })
    const all = await db.cashMovement.findMany({ where: { registerId: register.id } })
    const cash = all.reduce((sum, m) => sum + (m.type === "IN" ? 1 : -1) * m.amount, register.initialAmount)
    expect(cash).toBe(400)
  })

  it("el replay idempotente de la decisión ganadora no duplica el gasto", async () => {
    const requestId = await pendingRequest(5000) // $50
    const input = { decision: "APPROVE" as const, idempotencyKey: key() }
    const [first, second] = await Promise.all([
      decideCashRequest(db, admin, biz, requestId, input),
      decideCashRequest(db, admin, biz, requestId, input),
    ])
    // El tipo de decideCashRequest es la unión con/sin llave; con llave el
    // recibo siempre trae operationId en runtime.
    const receipts = [first, second] as unknown as { operationId: string }[]
    expect(receipts[1].operationId).toBe(receipts[0].operationId)
    expect(await db.cashMovement.count({ where: { referenceType: "EXPENSE", referenceId: requestId } })).toBe(1)
    expect((await db.cashRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("APPROVED")
  })

  it("aprobar de más que el efectivo en caja se rechaza sin asentar nada", async () => {
    // La caja tiene ~$400−$450 a estas alturas de la suite; un gasto de $99999 jamás cabe.
    const requestId = await pendingRequest(9999900)
    await expect(decideCashRequest(db, admin, biz, requestId, { decision: "APPROVE", idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CASH" })
    expect((await db.cashRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("PENDING")
    expect(await db.cashMovement.count({ where: { referenceType: "EXPENSE", referenceId: requestId } })).toBe(0)
  })
})
