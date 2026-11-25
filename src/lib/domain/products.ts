import type { PrismaClient, Product } from "@/generated/prisma/client"
import { z } from "zod"
import { BusinessError, releaseStock, transaction } from "./operations"
import { syncLowStockAlerts } from "../low-stock"

/** Tope de precio en pesos: cubre cualquier pieza real y descarta typos
 *  astronómicos (un "1999999" que pasaba directo al catálogo). */
export const PRICE_MAX = 999_999_999

/**
 * Regla ÚNICA de precio del catálogo: finito, ≥ 0, ≤ PRICE_MAX y con MÁXIMO
 * dos decimales — `cents()` (lib/domain/operations) rechaza más de dos
 * decimales en cada checkout, así que un precio capturado con 3+ deja la
 * pieza invendible; se bloquea en la entrada, no en la venta.
 *
 * La tolerancia replica la de cents(): 19.99 * 100 flota a
 * 1998.9999999999998 — comparar `Math.round(v*100) === v*100` rechazaría
 * precios correctos de dos decimales.
 */
export function isPriceValue(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= PRICE_MAX && Math.abs(v * 100 - Math.round(v * 100)) < 1e-4
}

/** priceSchema con etiqueta por campo ("Precio al público", "Precio aliado"…)
 *  para que el mensaje 400 nombre el precio rechazado. Coerce: acepta el
 *  string de los formularios y el número del JSON/excel por igual. */
export const priceSchema = (label = "El precio") =>
  z.coerce
    .number()
    .min(0, `${label} debe ser ≥ 0`)
    .max(PRICE_MAX, `${label} excede el máximo permitido`)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-4, `${label} admite máximo dos decimales`)

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(500),
  categoryId: z.string().min(1),
  retailPrice: priceSchema("Precio al público"),
  wholesalePrice: priceSchema("Precio de taller"),
  costPrice: priceSchema("Precio de costo").nullable().optional(),
  stock: z.number().int().min(0).max(100000).default(0),
  images: z.array(z.string().max(2000)).default([]),
  branchId: z.string().min(1).optional(),
})

/** Crea producto con existencia inicial en UNA sucursal (branchId o la del actor). */
export async function createProduct(db: PrismaClient, actorId: string, businessId: string, raw: unknown): Promise<Product> {
  const input = createProductSchema.parse(raw)
  const product = await transaction(db, async tx => {
    const category = await tx.category.findFirst({ where: { id: input.categoryId, businessId }, select: { id: true } })
    if (!category) throw new BusinessError("La categoría no existe.", 400)
    const product = await tx.product.create({ data: {
      businessId,
      name: input.name, categoryId: input.categoryId,
      retailPrice: input.retailPrice, wholesalePrice: input.wholesalePrice,
      costPrice: input.costPrice ?? null, stock: 0, images: input.images, isActive: true,
    } })
    if (input.stock > 0) {
      const user = await tx.user.findUnique({ where: { id: actorId, businessId }, select: { homeBranchId: true } })
      const branch = await releaseStock(tx, { productId: product.id, quantity: input.stock, branchId: input.branchId ?? user?.homeBranchId, businessId })
      await tx.inventoryMovement.create({ data: {
        businessId, productId: product.id, userId: actorId, type: "IN", quantity: input.stock,
        previousStock: 0, newStock: input.stock, reason: "Stock inicial",
        branchId: branch.id, businessVersion: 1,
      } })
      return tx.product.findUniqueOrThrow({ where: { id: product.id } })
    }
    return product
  })
  // Post-commit: un producto que nace bajo mínimo también avisa.
  await syncLowStockAlerts(db, businessId, [product.id])
  return product
}
