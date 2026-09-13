import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"

export class BusinessError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_OPERATION") {
    super(message)
    this.name = "BusinessError"
  }
}

export type Transaction = Prisma.TransactionClient
export const operationKeySchema = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9:._-]+$/)
export const itemSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(100000) })
export const itemsSchema = z.array(itemSchema).min(1).max(100)
export type Item = z.infer<typeof itemSchema>

/** Money crosses the domain boundary as whole cents; legacy Float storage stays unchanged. */
export function cents(value: number, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > 100000000) {
    throw new BusinessError("Importe inválido: debe ser positivo y finito.")
  }
  const result = Math.round((value + Number.EPSILON) * 100)
  if (Math.abs(value * 100 - result) > 0.000001) throw new BusinessError("El importe admite como máximo dos decimales.")
  return result
}

export function amount(value: number): number { return value / 100 }

export function mergeItems(input: Item[]): Item[] {
  const rows = itemsSchema.parse(input)
  const merged = new Map<string, number>()
  for (const row of rows) merged.set(row.productId, (merged.get(row.productId) ?? 0) + row.quantity)
  return [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => itemSchema.parse({ productId, quantity }))
}

export async function actor(tx: Transaction, id: string, permission: "customer" | "staff" | "admin" = "customer") {
  const user = await tx.user.findUnique({ where: { id } })
  if (!user || user.status !== "APPROVED") throw new BusinessError("La cuenta no está autorizada para operar.", 403, "ACCOUNT_NOT_APPROVED")
  if (permission === "admin" && user.role !== "ADMIN") throw new BusinessError("Se requiere administrador.", 403)
  if (permission === "staff" && !["ADMIN", "EMPLOYEE"].includes(user.role)) throw new BusinessError("Acceso denegado.", 403)
  return user
}

export async function transaction<T>(db: PrismaClient, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
      if (!["P2034", "P2002", "40001", "40P01"].includes(code)) throw error
      if (attempt === 3) throw new BusinessError("Otra operación cambió estos datos. Reintenta conservando el mismo folio.", 409, "CONCURRENT_OPERATION")
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
  throw new BusinessError("No se pudo confirmar la operación.", 409)
}

/** Receipt and every business write commit together. Reuse with a changed actor/payload fails closed. */
export async function operation<T extends object>(
  db: PrismaClient,
  input: { key: string; actorId: string; kind: string; businessId: string; payload: unknown; permission?: "customer" | "staff" | "admin" },
  work: (tx: Transaction, operationId: string) => Promise<T>,
): Promise<T & { operationId: string }> {
  const key = operationKeySchema.parse(input.key)
  const requestHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex")
  return transaction(db, async tx => {
    await actor(tx, input.actorId, input.permission)
    const existing = await tx.businessOperation.findUnique({ where: { key } })
    if (existing) {
      if (existing.actorId !== input.actorId || existing.kind !== input.kind || existing.requestHash !== requestHash || existing.businessId !== input.businessId) {
        throw new BusinessError("El identificador ya se usó para otra operación.", 409, "IDEMPOTENCY_CONFLICT")
      }
      return existing.response as unknown as T & { operationId: string }
    }
    const receipt = await tx.businessOperation.create({ data: { key, actorId: input.actorId, kind: input.kind, businessId: input.businessId, requestHash, response: {} } })
    const response = { ...await work(tx, receipt.id), operationId: receipt.id }
    const json = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue
    await tx.businessOperation.update({ where: { id: receipt.id }, data: { response: json } })
    return json as unknown as T & { operationId: string }
  })
}

export const PRINCIPAL_BRANCH_ID = "branch-principal"

/** Sucursal por defecto cuando el flujo no especifica una (catálogo público, historiales). */
export async function resolveBranch(tx: Transaction, branchId?: string | null) {
  if (branchId) {
    const branch = await tx.branch.findUnique({ where: { id: branchId } })
    if (!branch || !branch.isActive) throw new BusinessError("La sucursal seleccionada no está activa.", 409)
    return branch
  }
  const branch = await tx.branch.findUnique({ where: { id: PRINCIPAL_BRANCH_ID } })
  if (branch) return branch
  const first = await tx.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  if (!first) throw new BusinessError("No hay sucursales activas.", 409)
  return first
}

/** Descuenta existencias de UNA sucursal y del total cacheado, en la misma transacción. */
export async function takeStock(tx: Transaction, input: { productId: string; quantity: number; branchId?: string | null }) {
  const product = await tx.product.findUnique({ where: { id: input.productId } })
  if (!product || !product.isActive) throw new BusinessError("El producto ya no está disponible.", 409)
  const branch = await resolveBranch(tx, input.branchId)
  const taken = await tx.branchStock.updateMany({
    where: { productId: product.id, branchId: branch.id, quantity: { gte: input.quantity } },
    data: { quantity: { decrement: input.quantity } },
  })
  if (taken.count !== 1) throw new BusinessError(`Stock insuficiente de ${product.name} en ${branch.name}.`, 409, "INSUFFICIENT_STOCK")
  const total = await tx.product.updateMany({ where: { id: product.id, stock: { gte: input.quantity } }, data: { stock: { decrement: input.quantity } } })
  if (total.count !== 1) throw new BusinessError(`El total de existencias de ${product.name} no coincide con las sucursales; requiere conciliación.`, 409, "STOCK_DRIFT")
  return { product, branch }
}

/** Devuelve existencias a UNA sucursal y al total cacheado. Crea la fila si no existía. */
export async function releaseStock(tx: Transaction, input: { productId: string; quantity: number; branchId?: string | null; businessId: string }) {
  const branch = await resolveBranch(tx, input.branchId)
  await tx.branchStock.upsert({
    where: { productId_branchId: { productId: input.productId, branchId: branch.id } },
    create: { businessId: input.businessId, productId: input.productId, branchId: branch.id, quantity: input.quantity },
    update: { quantity: { increment: input.quantity } },
  })
  await tx.product.update({ where: { id: input.productId }, data: { stock: { increment: input.quantity } } })
  return branch
}

/** Caja abierta de UNA sucursal (una por local; restricción única parcial en BD). */
export async function openRegister(tx: Transaction, branchId?: string | null) {
  const branch = await resolveBranch(tx, branchId)
  const registers = await tx.cashRegister.findMany({ where: { status: "OPEN", branchId: branch.id }, take: 2 })
  if (registers.length !== 1) throw new BusinessError(registers.length ? `Hay más de una caja abierta en ${branch.name}; requiere revisión.` : `Abre la caja de ${branch.name} antes de registrar efectivo.`, 409, "REGISTER_REQUIRED")
  const locked = await tx.cashRegister.updateMany({ where: { id: registers[0].id, status: "OPEN" }, data: { status: "OPEN" } })
  if (locked.count !== 1) throw new BusinessError("La caja acaba de cerrarse.", 409)
  return registers[0]
}

export async function addDebt(tx: Transaction, userId: string, totalCents: number, reference: { type: "SALE" | "RESERVATION" | "MANUAL"; id?: string; notes: string }) {
  if (totalCents === 0) return
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user || user.status !== "APPROVED") throw new BusinessError("El cliente no está habilitado para crédito.", 409)
  const balance = cents(user.creditBalance, true)
  const limit = user.creditLimit == null ? 0 : cents(user.creditLimit, true)
  if (limit <= 0 || balance + totalCents > limit) throw new BusinessError("Crédito disponible insuficiente.", 409, "INSUFFICIENT_CREDIT")
  const updated = await tx.user.updateMany({ where: { id: userId, creditBalance: user.creditBalance, creditLimit: user.creditLimit }, data: { creditBalance: amount(balance + totalCents) } })
  if (updated.count !== 1) throw new BusinessError("El saldo cambió; reintenta.", 409)
  return tx.creditMovement.create({ data: { businessId: user.businessId, userId, type: "DEBT", amount: amount(totalCents), referenceType: reference.type, referenceId: reference.id, notes: reference.notes } })
}
