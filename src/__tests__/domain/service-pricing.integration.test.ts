import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { missingPriceScopeModels, resolveServicePrice, servicePriceSelect } from "@/lib/service-pricing"

// Integración contra la base de fixture dedicada: valida los índices
// únicos parciales, el CHECK de un solo alcance y el flujo de reemplazo
// que ejecuta PATCH /api/workshop-services/[id]. Solo corre con
// RUN_DATABASE_TESTS=1 (misma puerta que transactions.integration.test.ts).
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `test-${randomUUID()}`

describe.skipIf(!enabled)("WorkshopServicePrice — PostgreSQL real", () => {
  let biz: string, serviceId: string, globalModel: string, tenantModel: string

  const withPrices = (id: string) =>
    db.workshopService.findUniqueOrThrow({ where: { id }, include: { prices: { select: servicePriceSelect } } })

  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    serviceId = (await db.workshopService.create({ data: { businessId: biz, name: `${prefix}-svc`, priceCents: 50000 } })).id
    // Un modelo global (catálogo de plataforma) y uno privado del tenant.
    globalModel = (await db.deviceModel.create({ data: { businessId: null, brand: prefix, model: "Global" } })).id
    tenantModel = (await db.deviceModel.create({ data: { businessId: biz, brand: prefix, model: "Tenant" } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("reemplazo de set (deleteMany + createMany) deja solo los precios nuevos", async () => {
    await db.workshopServicePrice.createMany({
      data: [
        { serviceId, deviceModelId: globalModel, priceCents: 90000 },
        { serviceId, equipmentType: "Celular", priceCents: 70000 },
      ],
    })
    // El PATCH hace esto dentro de una tx serializable; aquí basta la secuencia.
    await db.workshopServicePrice.deleteMany({ where: { serviceId } })
    await db.workshopServicePrice.createMany({
      data: [
        { serviceId, deviceModelId: tenantModel, priceCents: 80000 },
        { serviceId, equipmentType: "Laptop", priceCents: 60000 },
      ],
    })
    const service = await withPrices(serviceId)
    expect(service.prices).toHaveLength(2)
    expect(resolveServicePrice(service, { deviceModelId: tenantModel, equipmentType: "Celular" })).toBe(80000)
    expect(resolveServicePrice(service, { deviceModelId: globalModel, equipmentType: "Laptop" })).toBe(60000)
    expect(resolveServicePrice(service, { deviceModelId: globalModel, equipmentType: "Otro" })).toBe(50000)
    expect(service.prices.find(p => p.deviceModelId === tenantModel)?.deviceModel).toMatchObject({ brand: prefix, model: "Tenant" })
  })

  it("el índice único parcial rechaza un segundo precio para el mismo modelo", async () => {
    await expect(
      db.workshopServicePrice.createMany({ data: [{ serviceId, deviceModelId: tenantModel, priceCents: 1 }] }),
    ).rejects.toMatchObject({ code: "P2002" })
    await expect(
      db.workshopServicePrice.create({ data: { serviceId, equipmentType: "Laptop", priceCents: 1 } }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("el CHECK exige exactamente un alcance por fila", async () => {
    await expect(
      db.workshopServicePrice.create({ data: { serviceId, deviceModelId: tenantModel, equipmentType: "Laptop", priceCents: 1 } }),
    ).rejects.toThrow()
    await expect(
      db.workshopServicePrice.create({ data: { serviceId, priceCents: 1 } }),
    ).rejects.toThrow()
  })

  it("missingPriceScopeModels acepta modelos globales y del tenant; reporta los demás", async () => {
    const prices = [
      { deviceModelId: globalModel, equipmentType: null, priceCents: 1 },
      { deviceModelId: tenantModel, equipmentType: null, priceCents: 1 },
      { deviceModelId: "modelo-que-no-existe", equipmentType: null, priceCents: 1 },
      { deviceModelId: null, equipmentType: "Celular", priceCents: 1 },
    ]
    expect(await missingPriceScopeModels(db, biz, prices)).toEqual(["modelo-que-no-existe"])
    // Un modelo privado de OTRO tenant no es visible para este negocio.
    const foreign = await db.deviceModel.create({ data: { businessId: (await db.business.create({ data: { name: `${prefix}-o`, slug: `${prefix}-o` } })).id, brand: prefix, model: "Ajeno" } })
    expect(await missingPriceScopeModels(db, biz, [{ deviceModelId: foreign.id, equipmentType: null, priceCents: 1 }])).toEqual([foreign.id])
  })
})
