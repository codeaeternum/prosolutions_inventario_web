import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import {
  BusinessError,
  operation,
  operationKeySchema,
  transaction,
  type Transaction,
} from "@/lib/domain/operations"
import { businessFailure } from "@/lib/domain/http"
import { diffChanges, recordAudit } from "@/lib/audit"

/**
 * POST /api/products/photos — anexa fotos ya subidas a /uploads a varios
 * productos en una sola llamada (staff con módulo "inventario"); pensado
 * para la importación masiva por nombre de archivo del panel de inventario.
 *
 * Body: { assignments: [{ productId, images[] }], idempotencyKey? }
 *   - 1–100 asignaciones, cada una con 1–8 imágenes nuevas.
 *   - Solo rutas locales "/uploads/…": nada de URLs absolutas http(s) ni de
 *     traversal ("..", "\"). Cualquier entrada inválida rechaza TODO el
 *     body con 400, igual que /api/products/bulk.
 *
 * Respuesta: { updated, skipped: [{ id, reason }], operationId? }
 * Solo se tocan productos ACTIVOS de la empresa; ids ajenos, inexistentes o
 * inactivos caen a `skipped` con reason "no_encontrado" (mismo destino para
 * no revelar que el id existe en otro negocio). Otras razones: "duplicado"
 * (el mismo productId llegó 2+ veces en el lote), "sin_cambios" (todas las
 * fotos ya estaban ligadas) y "limite" (el resultado pasaría el tope de
 * MAX_PRODUCT_IMAGES — la asignación se omite entera: nunca se guarda una
 * lista recortada a medias).
 */

const UPLOADS_PREFIX = "/uploads/"
// Mismo tope que el form de producto (MAX_PRODUCT_IMAGES en producto-form).
const MAX_PRODUCT_IMAGES = 12

/** La imagen debe ser una ruta local servida por /api/upload/*: /uploads/<dir>/<archivo>. */
function isLocalUpload(value: string): boolean {
  if (!value.startsWith(UPLOADS_PREFIX)) return false
  if (value.length <= UPLOADS_PREFIX.length) return false
  // Anti-traversal: ni ".." ni separador Windows ni NUL. Una URL absoluta
  // http(s) ya quedó fuera por el prefijo.
  if (value.includes("..") || value.includes("\\") || value.includes("\0")) return false
  return true
}

const imageUrlSchema = z
  .string()
  .min(1, "La imagen no puede estar vacía")
  .max(2000, "La ruta de la imagen es demasiado larga")
  .refine(isLocalUpload, "Cada imagen debe ser una ruta local /uploads/…")

// Ids tipo cuid: token opaco alfanumérico; se aceptan "-" / "_" que traen
// ids legados o de prueba, pero nada de espacios, "/" ni puntos.
const productIdSchema = z
  .string()
  .min(1, "productId requerido")
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Identificador de producto inválido")

const assignmentSchema = z.object({
  productId: productIdSchema,
  images: z
    .array(imageUrlSchema)
    .min(1, "Indica al menos una imagen por producto")
    .max(8, "Máximo 8 imágenes nuevas por producto"),
})

const photosSchema = z.object({
  assignments: z
    .array(assignmentSchema)
    .min(1, "Indica al menos una asignación")
    .max(100, "Máximo 100 productos por carga"),
  idempotencyKey: operationKeySchema.optional(),
})

type ProductRow = { id: string; name: string; images: string[] }

type SkippedItem = { id: string; reason: string }

type PlanItem = {
  product: ProductRow
  before: string[]
  images: string[] // before + nuevas, deduplicadas en orden y ≤ MAX_PRODUCT_IMAGES
}

export async function POST(req: Request) {
  try {
    const result = await requireModule("inventario")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const body = await req.json().catch(() => null)
    const parsed = photosSchema.safeParse(body)
    if (!parsed.success) {
      const flat = parsed.error.flatten()
      const msg =
        flat.formErrors[0] ??
        flat.fieldErrors.assignments?.[0] ??
        flat.fieldErrors.idempotencyKey?.[0] ??
        "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { assignments, idempotencyKey } = parsed.data

    // Solo activos de esta empresa: ajenos/inactivos ni siquiera se leen.
    const wantedIds = [...new Set(assignments.map((a) => a.productId))]
    const products = (await prisma.product.findMany({
      where: { id: { in: wantedIds }, businessId, isActive: true },
      select: { id: true, name: true, images: true },
    })) as ProductRow[]
    const byId = new Map(products.map((p) => [p.id, p]))

    // Plan por producto, en el orden del request. Un productId repetido en
    // el lote solo corre la primera vez (Prisma no soporta push en scalar
    // list: hay que leer, fusionar y reescribir); las repeticiones se
    // reportan como "duplicado" para que toda entrada tenga un destino
    // visible en la respuesta. Las fotos nuevas se anexan al final
    // deduplicadas conservando orden; si todas ya estaban o el resultado
    // pasaría el tope, el producto no se escribe ni se audita — cae a
    // `skipped` (misma convención de "sin cambio efectivo" del bulk).
    const plan: PlanItem[] = []
    const skipped: SkippedItem[] = []
    const seen = new Set<string>()
    for (const item of assignments) {
      if (seen.has(item.productId)) {
        skipped.push({ id: item.productId, reason: "duplicado" })
        continue
      }
      seen.add(item.productId)
      const product = byId.get(item.productId)
      if (!product) {
        skipped.push({ id: item.productId, reason: "no_encontrado" })
        continue
      }
      const before = Array.isArray(product.images) ? product.images : []
      const merged = [...new Set([...before, ...item.images])]
      if (merged.length === before.length) {
        skipped.push({ id: item.productId, reason: "sin_cambios" })
        continue
      }
      if (merged.length > MAX_PRODUCT_IMAGES) {
        skipped.push({ id: item.productId, reason: "limite" })
        continue
      }
      plan.push({ product, before, images: merged })
    }

    // Un update por producto, todo en la misma transacción. `appliedPlan`
    // solo se llena si work() corrió de verdad: en un replay idempotente
    // (misma idempotencyKey) la respuesta llega del recibo y NO se vuelve
    // a auditar.
    const appliedPlan: PlanItem[] = []
    const work = async (tx: Transaction) => {
      for (const item of plan) {
        await tx.product.update({
          where: { id: item.product.id, businessId },
          data: { images: item.images },
        })
      }
      appliedPlan.push(...plan)
      return { updated: plan.length, skipped }
    }

    const response = idempotencyKey
      ? await operation(
          prisma,
          {
            key: idempotencyKey,
            actorId: session.user.id,
            businessId,
            kind: "PRODUCT_BULK_PHOTOS",
            permission: "staff",
            payload: { assignments },
          },
          work
        )
      : await transaction(prisma, work)

    // Bitácora post-commit: un PRODUCT_UPDATE por producto que sí cambió,
    // con el arreglo de fotos antes→después (recordAudit nunca lanza; el
    // negocio ya quedó escrito).
    for (const item of appliedPlan) {
      const added = item.images.length - item.before.length
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "PRODUCT_UPDATE",
        entity: "product",
        entityId: item.product.id,
        entityName: item.product.name,
        summary: `Agregó ${added} foto${added === 1 ? "" : "s"} (${item.before.length} → ${item.images.length})`,
        changes: diffChanges({ fotos: item.before }, { fotos: item.images }, ["fotos"]),
      })
    }

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BusinessError) return businessFailure(error)
    console.error("[products/photos]", error)
    return NextResponse.json(
      { error: "Error al agregar las fotos" },
      { status: 500 }
    )
  }
}
