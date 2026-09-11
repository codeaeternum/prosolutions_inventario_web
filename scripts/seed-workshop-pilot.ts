import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { createRepair, updateRepair } from "../src/lib/domain/workshop"

// Explicit empty-database guard. Never run on the shop's current database.
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "")
  const password = process.env.PILOT_ADMIN_PASSWORD ?? ""
  if (url.pathname !== "/prosolutions_pilot" || process.env.PILOT_SEED_ACK !== "fictional-data-only" || password.length < 20) throw new Error("Dedicated pilot database, acknowledgement and a 20+ character password are required")
  const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url.toString() })) })
  try {
    if (await db.user.count() || await db.product.count() || await db.workshopBranch.count()) throw new Error("Pilot database is not empty; refusing to seed or overwrite existing data")
    const admin = await db.user.create({ data: { email: "piloto@prosolutions.local", name: "Dueño · Demo", role: "ADMIN", status: "APPROVED", password: await bcrypt.hash(password, 12) } })
    const techs = await Promise.all(["Técnico A · Demo", "Técnico B · Demo"].map(name => db.user.create({ data: { name, role: "EMPLOYEE", status: "APPROVED" } })))
    const branches = await Promise.all(["Local Centro · Demo", "Local Norte · Demo"].map(name => db.workshopBranch.create({ data: { name } })))
    const fixtures = [
      { customer: "Cliente de prueba 01", type: "Consola", brand: "Nintendo", model: "Switch", issue: "No carga; se apaga al desconectarla", stage: "DIAGNOSIS", branch: 0 },
      { customer: "Cliente de prueba 02", type: "Laptop", brand: "Lenovo", model: "IdeaPad", issue: "Ventilador ruidoso y temperatura alta", stage: "WAITING_APPROVAL", branch: 1 },
      { customer: "Cliente de prueba 03", type: "Celular", brand: "Samsung", model: "Galaxy A54", issue: "Pantalla rota; imagen visible pero sin respuesta táctil", stage: "IN_REPAIR", branch: 0 },
      { customer: "Cliente de prueba 04", type: "Audio", brand: "Sony", model: "Bocina", issue: "Sonido intermitente al mover el cable", stage: "READY", branch: 1 },
      { customer: "Cliente de prueba 05", type: "Televisión", brand: "LG", model: "43 pulgadas", issue: "Se escucha sonido pero la pantalla está oscura", stage: "RECEIVED", branch: 0 },
      { customer: "Cliente de prueba 06", type: "Tablet", brand: "Apple", model: "iPad", issue: "Batería se descarga con rapidez", stage: "WAITING_PARTS", branch: 1 },
    ]
    for (const [index, fixture] of fixtures.entries()) {
      let { order } = await createRepair(db, admin.id, { idempotencyKey: `pilot-order-${index}`, customerName: fixture.customer, customerPhone: `000000000${index}`, equipmentType: fixture.type, brand: fixture.brand, model: fixture.model, reportedIssue: fixture.issue, intakeBranchId: branches[fixture.branch].id, assignedToId: techs[fixture.branch].id, intakeCondition: "Ejemplo ficticio: rayones leves en carcasa", accessories: "Sin accesorios" })
      const step = async (action: string, detail: string, extra: Record<string, unknown> = {}) => {
        const result = await updateRepair(db, admin.id, order.id, { idempotencyKey: `pilot-${index}-${order.version}`, expectedVersion: order.version, action, detail, ...extra })
        order = result.order
      }
      if (fixture.stage === "RECEIVED") continue
      await step("STATUS", "Equipo en revisión técnica inicial", { status: "DIAGNOSIS" })
      if (fixture.stage === "DIAGNOSIS") continue
      await step("QUOTE", "Diagnóstico de demostración: sustituir componente y realizar pruebas de funcionamiento.", { quoteCents: 45000 + index * 10000 })
      if (fixture.stage === "WAITING_APPROVAL") continue
      await step("APPROVE", "Autorización ficticia en mostrador para probar el recorrido")
      if (fixture.stage === "IN_REPAIR") continue
      if (fixture.stage === "WAITING_PARTS") { await step("STATUS", "Refacción pendiente del proveedor de demostración", { status: "WAITING_PARTS" }); continue }
      await step("STATUS", "Trabajo de demostración terminado", { status: "QUALITY_CHECK" })
      await step("STATUS", "Encendido, carga y función principal verificados en el ejemplo", { status: "READY" })
    }
    console.log(JSON.stringify({ seeded: true, fictional: true, branches: branches.length, orders: fixtures.length, adminEmail: admin.email }))
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Pilot seed failed"); process.exitCode = 1 })
