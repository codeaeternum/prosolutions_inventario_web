import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema, type Transaction } from "@/lib/domain/operations"
import type { PrismaClient } from "@prisma/client"

const upsertSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(120),
  code: z.string().trim().max(60).optional(),
  type: z.string().trim().max(40).optional(),
  // Solo el superadmin puede pedir scope global; el cliente nunca elige el
  // businessId — siempre se estampa el de su sesión.
  global: z.boolean().optional(),
  idempotencyKey: operationKeySchema.optional(),
})

// Separador NUL: no puede aparecer en marca/modelo y evita colisiones al
// concatenarlos en la clave de deduplicación.
const dedupKey = (brand: string, model: string) => `${brand}\u0000${model}`.toLowerCase()

/**
 * Alta/actualización de un modelo. businessId null = catálogo global
 * (@@unique con NULL no deduplica en Postgres: hay que buscar primero);
 * con valor = privado del tenant (ahí sí sirve el upsert compuesto).
 */
async function writeModel(db: PrismaClient | Transaction, input: { businessId: string | null; brand: string; model: string; code: string | null; type: string }) {
  if (input.businessId === null) {
    const existing = await db.deviceModel.findFirst({ where: { businessId: null, brand: input.brand, model: input.model } })
    if (existing) {
      return db.deviceModel.update({ where: { id: existing.id }, data: { code: input.code, type: input.type } })
    }
    return db.deviceModel.create({ data: input })
  }
  return db.deviceModel.upsert({
    where: { businessId_brand_model: { businessId: input.businessId, brand: input.brand, model: input.model } },
    create: input,
    update: { code: input.code, type: input.type },
  })
}

// Catálogo de modelos de equipo para autocompletar la recepción del taller.
// Mezcla el catálogo global (businessId null) con los modelos privados del
// tenant; si marca+modelo existe en ambos scopes gana la fila del tenant.
// ?q= busca en marca + modelo + código (contains, insensitive); ?brand= y
// ?type= filtran la lista. Devuelve hasta 15 resultados ordenados por
// marca/modelo.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const tenantId = businessIdOf(getSession(auth)!)
    const query = new URL(req.url).searchParams
    const search = (query.get("q") ?? "").trim().slice(0, 100)
    const brand = (query.get("brand") ?? "").trim().slice(0, 60)
    const type = (query.get("type") ?? "").trim().slice(0, 40)
    // Se traen hasta 30 filas para que, tras el dedup global/tenant, sigan
    // quedando 15 aunque haya pares repetidos en ambos scopes.
    const rows = await prisma.deviceModel.findMany({
      where: {
        AND: [
          { OR: [{ businessId: null }, { businessId: tenantId }] },
          ...(search
            ? [{
                OR: [
                  { brand: { contains: search, mode: "insensitive" as const } },
                  { model: { contains: search, mode: "insensitive" as const } },
                  { code: { contains: search, mode: "insensitive" as const } },
                ],
              }]
            : []),
          ...(brand ? [{ brand: { contains: brand, mode: "insensitive" as const } }] : []),
          ...(type ? [{ type: { equals: type, mode: "insensitive" as const } }] : []),
        ],
      },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      take: 30,
    })
    const deduped = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      const key = dedupKey(row.brand, row.model)
      const previous = deduped.get(key)
      if (!previous || (previous.businessId === null && row.businessId === tenantId)) deduped.set(key, row)
    }
    const models = [...deduped.values()].slice(0, 15)
    return NextResponse.json({ models }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

// POST/upsert: el staff crea modelos PRIVADOS de su tenant — el businessId
// siempre sale de la sesión, nunca del body. Solo el superadmin de plataforma
// puede escribir en el catálogo global con `global: true`.
export async function POST(req: Request) {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const { idempotencyKey, global: wantsGlobal, ...input } = upsertSchema.parse(await req.json())
    if (wantsGlobal && session.user.isSuperAdmin !== true) {
      throw new BusinessError("Solo la plataforma puede crear modelos del catálogo global.", 403)
    }
    const data = {
      businessId: wantsGlobal ? null : businessIdOf(session),
      brand: input.brand,
      model: input.model,
      code: input.code || null,
      type: input.type || "SMARTPHONE",
    }
    if (idempotencyKey) {
      const result = await operation(prisma, { key: idempotencyKey, actorId, businessId: businessIdOf(session), kind: "DEVICE_MODEL_UPSERT", permission: "staff", payload: { ...input, global: wantsGlobal === true } }, async tx => ({
        model: await writeModel(tx, data),
      }))
      return NextResponse.json(result, { status: 201 })
    }
    const model = await writeModel(prisma, data)
    return NextResponse.json({ model }, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
