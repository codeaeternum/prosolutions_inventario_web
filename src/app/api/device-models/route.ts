import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { operation, operationKeySchema } from "@/lib/domain/operations"

const upsertSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(120),
  code: z.string().trim().max(60).optional(),
  type: z.string().trim().max(40).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

// Catálogo de modelos de equipo para autocompletar la recepción del taller.
// ?q= busca en marca + modelo + código (contains, insensitive); ?brand= y ?type=
// filtran la lista. Devuelve hasta 15 resultados ordenados por marca/modelo.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const search = (query.get("q") ?? "").trim().slice(0, 100)
    const brand = (query.get("brand") ?? "").trim().slice(0, 60)
    const type = (query.get("type") ?? "").trim().slice(0, 40)
    const models = await prisma.deviceModel.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { brand: { contains: search, mode: "insensitive" as const } },
                { model: { contains: search, mode: "insensitive" as const } },
                { code: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(brand ? { brand: { contains: brand, mode: "insensitive" as const } } : {}),
        ...(type ? { type: { equals: type, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      take: 15,
    })
    return NextResponse.json({ models }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id
    const { idempotencyKey, ...input } = upsertSchema.parse(await req.json())
    const data = {
      brand: input.brand,
      model: input.model,
      code: input.code || null,
      type: input.type || "SMARTPHONE",
    }
    if (idempotencyKey) {
      const result = await operation(prisma, { key: idempotencyKey, actorId, kind: "DEVICE_MODEL_UPSERT", permission: "staff", payload: input }, async tx => ({
        model: await tx.deviceModel.upsert({ where: { brand_model: { brand: data.brand, model: data.model } }, create: data, update: { code: data.code, type: data.type } }),
      }))
      return NextResponse.json(result, { status: 201 })
    }
    const model = await prisma.deviceModel.upsert({ where: { brand_model: { brand: data.brand, model: data.model } }, create: data, update: { code: data.code, type: data.type } })
    return NextResponse.json({ model }, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
