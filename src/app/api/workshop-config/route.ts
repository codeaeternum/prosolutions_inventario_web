import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema } from "@/lib/domain/operations"
import type { Transaction } from "@/lib/domain/operations"

const DEFAULT_EQUIPMENT_TYPES = ["Celular", "Tablet", "Laptop", "Computadora", "Consola", "Smartwatch", "Pantalla", "Impresora", "Otro"]
const DEFAULT_LOCATIONS = ["Recepción", "Mesa 1", "Mesa 2", "Anaquel A", "Anaquel B"]

const EQUIPMENT_TYPES_KEY = "workshop_equipment_types"
const LOCATIONS_KEY = "workshop_locations"

const updateSchema = z.object({
  equipmentTypes: z.array(z.string().trim().min(1).max(40)).min(1).max(60).optional(),
  locations: z.array(z.string().trim().min(1).max(60)).min(1).max(30).optional(),
  idempotencyKey: operationKeySchema,
})

function parseList(raw: string | undefined, fallback: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "")
    if (!Array.isArray(parsed)) return fallback
    const list = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    return list.length ? list : fallback
  } catch {
    return fallback
  }
}

const dedupe = (list: string[]) => [...new Set(list)]

async function readConfig(tx: Pick<Transaction, "systemSettings">) {
  const rows = await tx.systemSettings.findMany({ where: { key: { in: [EQUIPMENT_TYPES_KEY, LOCATIONS_KEY] } } })
  const map = new Map(rows.map(row => [row.key, row.value]))
  return {
    equipmentTypes: parseList(map.get(EQUIPMENT_TYPES_KEY), DEFAULT_EQUIPMENT_TYPES),
    locations: parseList(map.get(LOCATIONS_KEY), DEFAULT_LOCATIONS),
  }
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    return NextResponse.json(await readConfig(prisma), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id
    const { idempotencyKey, ...input } = updateSchema.parse(await req.json())
    if (input.equipmentTypes === undefined && input.locations === undefined) throw new BusinessError("No hay cambios por guardar.")
    const result = await operation(prisma, { key: idempotencyKey, actorId, kind: "WORKSHOP_CONFIG_UPDATE", permission: "admin", payload: input }, async tx => {
      if (input.equipmentTypes !== undefined) {
        const value = JSON.stringify(dedupe(input.equipmentTypes))
        await tx.systemSettings.upsert({
          where: { key: EQUIPMENT_TYPES_KEY },
          create: { key: EQUIPMENT_TYPES_KEY, value, type: "JSON" },
          update: { value, type: "JSON" },
        })
      }
      if (input.locations !== undefined) {
        const value = JSON.stringify(dedupe(input.locations))
        await tx.systemSettings.upsert({
          where: { key: LOCATIONS_KEY },
          create: { key: LOCATIONS_KEY, value, type: "JSON" },
          update: { value, type: "JSON" },
        })
      }
      return readConfig(tx)
    })
    return NextResponse.json(result)
  } catch (error) { return businessFailure(error) }
}
