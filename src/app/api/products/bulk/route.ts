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
import { diffChanges, money, recordAudit, type AuditChanges } from "@/lib/audit"

/**
 * POST /api/products/bulk — ajuste masivo de precios (staff con módulo
 * "inventario"). Dos modos, exactamente uno por request:
 *
 * - `set`: pisa los campos presentes ({retailPrice, wholesalePrice,
 *   internalPrice, costPrice}; `allyPrice` es alias del precio aliado =
 *   wholesalePrice). `internalPrice` acepta además `null` explícito, que lo
 *   limpia (la pieza vuelve a cobrarse al público en órdenes propias).
 * - `percent`: mueve retailPrice y wholesalePrice un porcentaje (+10 / -15),
 *   redondeado a 2 decimales y sin nunca bajar de $0. No toca internalPrice:
 *   el taller propio suele seguir al costo, no al margen público.
 *
 * Solo toca productos activos de la empresa de la sesión; ids ajenos,
 * inexistentes, inactivos o sin cambio efectivo caen a `skipped`.
 */

const PRICE_FIELDS = ["retailPrice", "wholesalePrice", "internalPrice", "costPrice"] as const
type PriceField = (typeof PRICE_FIELDS)[number]

// En `set` el patch puede llevar null solo en internalPrice (null = limpiar,
// vuelve al precio público); los demás campos siempre llegan como números.
type PricePatch = {
  retailPrice?: number
  wholesalePrice?: number
  internalPrice?: number | null
  costPrice?: number
}

const setSchema = z.object({
  retailPrice: z.number().min(0, "Precio al público debe ser ≥ 0").optional(),
  wholesalePrice: z.number().min(0, "Precio aliado debe ser ≥ 0").optional(),
  // Alias del precio aliado aceptado por el contrato del cliente.
  allyPrice: z.number().min(0, "Precio aliado debe ser ≥ 0").optional(),
  // null = limpiar el precio de taller propio (fallback a retailPrice);
  // ausente = no tocarlo.
  internalPrice: z.number().min(0, "Precio de taller propio debe ser ≥ 0").nullable().optional(),
  costPrice: z.number().min(0, "Precio de costo debe ser ≥ 0").optional(),
})

const bulkSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1, "Indica al menos un producto")
      .max(200, "Máximo 200 productos por ajuste"),
    set: setSchema.optional(),
    percent: z.number().optional(),
    idempotencyKey: operationKeySchema.optional(),
  })
  .refine((data) => (data.set !== undefined) !== (data.percent !== undefined), {
    message: "Indica exactamente una operación: set o percent",
    path: ["set"],
  })

type ProductRow = {
  id: string
  name: string
  retailPrice: number | null
  wholesalePrice: number | null
  internalPrice: number | null
  costPrice: number | null
}

type PlanItem = {
  product: ProductRow
  data: PricePatch
  before: Record<PriceField, number | null>
  changes: AuditChanges
}

/** Pesos con máximo 2 decimales; nunca negativo. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Lectura defensiva: el schema dice Float no-nulo pero filas legacy pueden traer null. */
const finiteOrNull = (n: number | null) => (Number.isFinite(n) ? n : null)

export async function POST(req: Request) {
  try {
    const result = await requireModule("inventario")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const body = await req.json().catch(() => null)
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      const flat = parsed.error.flatten()
      const msg =
        flat.formErrors[0] ??
        flat.fieldErrors.ids?.[0] ??
        flat.fieldErrors.set?.[0] ??
        flat.fieldErrors.percent?.[0] ??
        flat.fieldErrors.idempotencyKey?.[0] ??
        "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { ids, set, percent, idempotencyKey } = parsed.data

    // El costo solo lo mueve el dueño (misma regla que PUT /api/products/[id]):
    // un empleado que mande costPrice lo ignora. internalPrice, en cambio, sí
    // lo puede mover el staff (su formulario de producto también lo edita).
    const isAdmin = session.user.role === "ADMIN"
    const patch: PricePatch = {}
    if (set) {
      if (set.retailPrice !== undefined) patch.retailPrice = set.retailPrice
      const wholesale = set.wholesalePrice ?? set.allyPrice
      if (wholesale !== undefined) patch.wholesalePrice = wholesale
      // !== undefined: el null explícito sí entra al patch (limpia el campo).
      if (set.internalPrice !== undefined) patch.internalPrice = set.internalPrice
      if (isAdmin && set.costPrice !== undefined) patch.costPrice = set.costPrice
      if (Object.keys(patch).length === 0) {
        return NextResponse.json(
          { error: "El ajuste no contiene precios para actualizar" },
          { status: 400 }
        )
      }
    }

    const uniqueIds = [...new Set(ids)]
    // Solo activos de esta empresa: ids ajenos/inactivos ni siquiera se leen.
    const products = (await prisma.product.findMany({
      where: { id: { in: uniqueIds }, businessId, isActive: true },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        wholesalePrice: true,
        internalPrice: true,
        costPrice: true,
      },
    })) as ProductRow[]

    // Plan por producto: solo campos que cambian de verdad; un producto que
    // termina sin diff (mismo valor, o percent sobre precios null) no se
    // escribe ni se audita — cae a `skipped`.
    const plan: PlanItem[] = []
    for (const product of products) {
      const data: PricePatch = {}
      if (percent !== undefined) {
        const factor = 1 + percent / 100
        for (const field of ["retailPrice", "wholesalePrice"] as const) {
          if (!Number.isFinite(product[field])) continue
          data[field] = Math.max(0, round2(product[field]! * factor))
        }
      } else {
        Object.assign(data, patch)
      }
      const before: Record<PriceField, number | null> = {
        retailPrice: finiteOrNull(product.retailPrice),
        wholesalePrice: finiteOrNull(product.wholesalePrice),
        internalPrice: finiteOrNull(product.internalPrice),
        costPrice: finiteOrNull(product.costPrice),
      }
      // Llaves del diff en español: el resumen de la bitácora se muestra tal
      // cual al dueño (misma convención que PUT /api/products/[id]).
      const auditBefore = {
        precio: before.retailPrice,
        taller: before.wholesalePrice,
        tallerPropio: before.internalPrice,
        costo: before.costPrice,
      }
      const auditAfter = {
        precio: data.retailPrice ?? before.retailPrice,
        taller: data.wholesalePrice ?? before.wholesalePrice,
        // Ojo: aquí null NO significa "ausente" sino "limpiar" — con ?? el
        // borrado de taller propio se vería como sin-cambio y no se auditaría.
        tallerPropio:
          data.internalPrice === undefined ? before.internalPrice : data.internalPrice,
        costo: data.costPrice ?? before.costPrice,
      }
      const changes = diffChanges(auditBefore, auditAfter, ["precio", "taller", "tallerPropio", "costo"])
      if (!changes) continue
      // Solo campos con diff real llegan al UPDATE. internalPrice conserva su
      // null (limpieza): `!== undefined` lo deja pasar y `?? null` jamás se
      // usaría porque el diff solo existe si data trae el campo.
      const effective: PricePatch = {}
      if (changes.precio && data.retailPrice !== undefined) effective.retailPrice = data.retailPrice
      if (changes.taller && data.wholesalePrice !== undefined) effective.wholesalePrice = data.wholesalePrice
      if (changes.tallerPropio && data.internalPrice !== undefined) effective.internalPrice = data.internalPrice
      if (changes.costo && data.costPrice !== undefined) effective.costPrice = data.costPrice
      plan.push({ product, data: effective, before, changes })
    }

    const plannedIds = new Set(plan.map((item) => item.product.id))
    const skipped = uniqueIds.filter((id) => !plannedIds.has(id))

    // Un update + un PriceHistory por campo por producto, todo en la misma
    // transacción. `appliedPlan` solo se llena si work() corrió de verdad: en
    // un replay idempotente (misma idempotencyKey) la respuesta llega del
    // recibo y NO se vuelve a auditar.
    const appliedPlan: PlanItem[] = []
    const work = async (tx: Transaction) => {
      for (const item of plan) {
        await tx.product.update({
          where: { id: item.product.id, businessId },
          data: item.data,
        })
        for (const field of PRICE_FIELDS) {
          const next = item.data[field]
          if (next === undefined) continue
          await tx.priceHistory.create({
            data: {
              businessId,
              productId: item.product.id,
              field,
              oldValue: item.before[field] ?? 0,
              // PriceHistory.newValue es Float no-nulo: limpiar internalPrice
              // queda como 0 (misma convención que PUT /api/products/[id]).
              newValue: next ?? 0,
              changedById: session.user.id,
            },
          })
        }
      }
      appliedPlan.push(...plan)
      return { updated: plan.length, skipped }
    }

    const opPayload =
      percent !== undefined ? { ids, percent } : { ids, set: patch }
    const response = idempotencyKey
      ? await operation(
          prisma,
          {
            key: idempotencyKey,
            actorId: session.user.id,
            businessId,
            kind: "PRODUCT_BULK_PRICES",
            permission: "staff",
            payload: opPayload,
          },
          work
        )
      : await transaction(prisma, work)

    // Bitácora post-commit: un evento PRODUCT_UPDATE por producto ajustado
    // (recordAudit nunca lanza; el negocio ya quedó escrito).
    if (appliedPlan.length > 0) {
      const prefix =
        percent !== undefined
          ? `Ajuste masivo ${percent > 0 ? "+" : ""}${percent}%`
          : "Ajuste masivo de precios"
      for (const item of appliedPlan) {
        const parts: string[] = []
        if (item.changes.precio)
          parts.push(`Precio ${money(item.before.retailPrice)} → ${money(item.data.retailPrice)}`)
        if (item.changes.taller)
          parts.push(`Taller ${money(item.before.wholesalePrice)} → ${money(item.data.wholesalePrice)}`)
        if (item.changes.tallerPropio)
          parts.push(`Taller propio ${money(item.before.internalPrice)} → ${money(item.data.internalPrice)}`)
        if (item.changes.costo)
          parts.push(`Costo ${money(item.before.costPrice)} → ${money(item.data.costPrice)}`)
        await recordAudit(prisma, {
          businessId,
          actorId: session.user.id,
          action: "PRODUCT_UPDATE",
          entity: "product",
          entityId: item.product.id,
          entityName: item.product.name,
          summary: `${prefix}: ${parts.join(" · ")}`,
          changes: item.changes,
        })
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof BusinessError) return businessFailure(error)
    console.error("Error en ajuste masivo de precios:", error)
    return NextResponse.json(
      { error: "Error al aplicar el ajuste de precios" },
      { status: 500 }
    )
  }
}
