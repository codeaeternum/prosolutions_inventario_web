import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema } from "@/lib/domain/operations"
import type { Transaction } from "@/lib/domain/operations"
import { DEFAULT_WARRANTY_DAYS, MAX_WARRANTY_DAYS, WARRANTY_DAYS_KEY } from "@/lib/workshop-labels"

const DEFAULT_EQUIPMENT_TYPES = ["Celular", "Tablet", "Laptop", "Computadora", "Consola", "Smartwatch", "Pantalla", "Impresora", "Otro"]
const DEFAULT_LOCATIONS = ["Recepción", "Mesa 1", "Mesa 2", "Anaquel A", "Anaquel B"]

const EQUIPMENT_TYPES_KEY = "workshop_equipment_types"
const LOCATIONS_KEY = "workshop_locations"

const updateSchema = z.object({
  equipmentTypes: z.array(z.string().trim().min(1).max(40)).min(1).max(60).optional(),
  locations: z.array(z.string().trim().min(1).max(60)).min(1).max(30).optional(),
  // Vigencia de la garantía en días al reingresar un equipo entregado.
  warrantyDays: z.number().int().min(1).max(MAX_WARRANTY_DAYS).optional(),
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

async function readConfig(tx: Pick<Transaction, "systemSettings">, businessId: string) {
  const rows = await tx.systemSettings.findMany({ where: { businessId, key: { in: [EQUIPMENT_TYPES_KEY, LOCATIONS_KEY, WARRANTY_DAYS_KEY] } } })
  const map = new Map(rows.map(row => [row.key, row.value]))
  // warranty_days se guarda como entero en texto ("30"); inválido → default.
  const days = Number.parseInt(map.get(WARRANTY_DAYS_KEY) ?? "", 10)
  return {
    equipmentTypes: parseList(map.get(EQUIPMENT_TYPES_KEY), DEFAULT_EQUIPMENT_TYPES),
    locations: parseList(map.get(LOCATIONS_KEY), DEFAULT_LOCATIONS),
    warrantyDays: days >= 1 && days <= MAX_WARRANTY_DAYS ? days : DEFAULT_WARRANTY_DAYS,
  }
}

// Lectura abierta a staff (la recepción de equipos necesita tipos y locaciones);
// la edición sigue siendo solo admin.
export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    return NextResponse.json(await readConfig(prisma, businessIdOf(getSession(auth)!)), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { idempotencyKey, ...input } = updateSchema.parse(await req.json())
    if (input.equipmentTypes === undefined && input.locations === undefined && input.warrantyDays === undefined) throw new BusinessError("No hay cambios por guardar.")
    const result = await operation(prisma, { key: idempotencyKey, actorId, businessId, kind: "WORKSHOP_CONFIG_UPDATE", permission: "admin", payload: input }, async tx => {
      if (input.equipmentTypes !== undefined) {
        const value = JSON.stringify(dedupe(input.equipmentTypes))
        await tx.systemSettings.upsert({
          where: { businessId_key: { businessId, key: EQUIPMENT_TYPES_KEY } },
          create: { businessId, key: EQUIPMENT_TYPES_KEY, value, type: "JSON" },
          update: { value, type: "JSON" },
        })
      }
      if (input.locations !== undefined) {
        const value = JSON.stringify(dedupe(input.locations))
        await tx.systemSettings.upsert({
          where: { businessId_key: { businessId, key: LOCATIONS_KEY } },
          create: { businessId, key: LOCATIONS_KEY, value, type: "JSON" },
          update: { value, type: "JSON" },
        })
      }
      if (input.warrantyDays !== undefined) {
        // Entero en texto plano (no JSON): el dominio lo lee con parseInt.
        await tx.systemSettings.upsert({
          where: { businessId_key: { businessId, key: WARRANTY_DAYS_KEY } },
          create: { businessId, key: WARRANTY_DAYS_KEY, value: String(input.warrantyDays), type: "NUMBER" },
          update: { value: String(input.warrantyDays), type: "NUMBER" },
        })
      }
      return readConfig(tx, businessId)
    })
    return NextResponse.json(result)
  } catch (error) { return businessFailure(error) }
}
