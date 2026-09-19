import type { PrismaClient, Product } from "@prisma/client"
import { z } from "zod"
import { BusinessError, releaseStock, transaction } from "./operations"
import { syncLowStockAlerts } from "../low-stock"

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(500),
  categoryId: z.string().min(1),
  retailPrice: z.number().min(0),
  wholesalePrice: z.number().min(0),
  costPrice: z.number().min(0).nullable().optional(),
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
