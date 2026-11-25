/**
 * reset-tenant.mjs — Borrón total de UN negocio (tenant) en la base.
 *
 * Elimina TODA la data del negocio: productos, stock, ventas, compras,
 * taller, clientes/fiado, caja, encargos, actividad, usuarios, sucursales,
 * categorías y configuración. Sobrevive únicamente:
 *   - el registro Business (necesario para que el dominio/login exista)
 *   - UN usuario admin (el que se indique con --keep-user)
 *   - cualquier usuario con isSuperAdmin (operador de plataforma)
 * Otros negocios (talleres aliados, pilotos) NO se tocan.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/reset-tenant.mjs \
 *     --business <slug-o-id> --keep-user <email> --confirm "BORRAR TODO"
 *
 * Siempre hacer respaldo ANTES (pg_dump). Este script no lo hace por ti.
 *
 * ─── Por qué un grafo explícito (y no borrado dinámico ni FKs apagadas) ───
 *
 * La versión anterior borraba toda tabla con columna businessId encontrada en
 * information_schema dentro de una transacción con session_replication_role =
 * 'replica' (FKs apagadas). Tres problemas concretos:
 *
 *   1. Borraba PlatformEvent. Esa tabla tiene businessId como ESCALAR SIN FK a
 *      propósito (ver schema.prisma): es la bitácora de la consola de
 *      plataforma y está diseñada para sobrevivir al borrado del tenant — sin
 *      ella no hay rastro de quién suspendió/eliminó qué negocio. Aquí se
 *      EXCLUYE explícitamente y el chequeo de cobertura la exige en la lista
 *      de excluidas para que nadie la re-agregue por accidente.
 *   2. Dejaba huérfanos en tablas sin businessId: NotificationRead (hija de
 *      Notification), WorkshopServicePrice (hija de WorkshopService) y los
 *      VerificationCode ligados al USUARIO cuando businessId es NULL. Con las
 *      FKs apagadas esos huérfanos no tronaban: quedaban apuntando a filas
 *      inexistentes. Aquí se borran por JOIN explícito a su padre.
 *   3. Apagar FKs (session_replication_role) es un martillo de superusuario
 *      que esconde errores de orden y deja la base inconsistente en silencio.
 *      Como aquí se borra TODO lo del tenant, basta ordenar el grafo hijos →
 *      padres y las FKs quedan satisfechas en todo momento —último recurso
 *      sería desactivarlas y este script demuestra que no hace falta.
 *
 * Decisiones conscientes:
 *   - DeviceModel con businessId NULL es catálogo GLOBAL de plataforma: no se
 *     toca (solo filas del tenant). Igual DirectoryEvent: se borran solo las
 *     filas del tenant (las de otros tenants y las anónimas sobreviven).
 *   - PartRequest es dato de plataforma compartido entre tenants (no tiene
 *     businessId): nunca se toca.
 *   - Cobertura verificada contra information_schema ANTES de borrar: si el
 *     schema agrega una tabla nueva con businessId y nadie actualiza este
 *     script, ABORTA sin tocar una fila — un borrón a medias es peor que
 *     ninguno. Tras el borrado se re-verifica que no quede nada.
 */
import { PrismaClient } from "../src/generated/prisma/client.ts"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const businessRef = arg("--business")
const keepEmail = arg("--keep-user")
const confirm = arg("--confirm")

if (!businessRef || !keepEmail || confirm !== "BORRAR TODO") {
  console.error("Faltan argumentos o confirmación. Ejemplo:")
  console.error('  node scripts/reset-tenant.mjs --business prosolutions --keep-user dueno@correo.com --confirm "BORRAR TODO"')
  process.exit(1)
}

// Prisma 7 usa driver adapters: PrismaClient necesita PrismaPg + pg.Pool.
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const business = await prisma.business.findFirst({
  where: { OR: [{ id: businessRef }, { slug: businessRef }] },
  select: { id: true, name: true, slug: true },
})
if (!business) {
  console.error(`Negocio "${businessRef}" no encontrado.`)
  process.exit(1)
}
const keeper = await prisma.user.findFirst({
  where: { businessId: business.id, email: keepEmail, role: "ADMIN" },
  select: { id: true, email: true },
})
if (!keeper) {
  console.error(`No hay usuario ADMIN con email "${keepEmail}" en ${business.name}. Sin él te quedarías fuera del sistema.`)
  process.exit(1)
}

// Tablas con businessId que NO se borran aunque el chequeo las encuentre.
// PlatformEvent: bitácora de plataforma diseñada para sobrevivir al tenant
// (schema.prisma: "Sin FK a Business/User a propósito: el evento debe
// sobrevivir al borrado del tenant y del operador").
const SURVIVING_TABLES = new Set(["PlatformEvent"])

// Grafo de borrado explícito, ordenado hijos → padres para que las FKs
// (Restrict/NoAction) queden satisfechas en cada paso. Cada entrada explica
// a quién referencia. Las tablas sin businessId llevan SQL de JOIN al padre.
const BID = `"businessId" = $1`
const TENANT_USERS = `(SELECT id FROM "User" WHERE "businessId" = $1)`
const graph = [
  // Hijas sin businessId propio — primero, vía join al padre.
  { table: "NotificationRead", sql: `DELETE FROM "NotificationRead" nr USING "Notification" n WHERE nr."notificationId" = n.id AND n.${BID}`, refs: "hija de Notification (cascade, pero explícito)" },
  { table: "VerificationCode", sql: `DELETE FROM "VerificationCode" WHERE ${BID} OR "userId" IN ${TENANT_USERS}`, refs: "businessId nullable + OTPs ligados a usuarios del tenant" },
  // Dinero documentado: Payment referencia Sale/RepairOrder/Encargo/User con Restrict.
  { table: "Payment", sql: `DELETE FROM "Payment" WHERE ${BID}`, refs: "→ Sale, RepairOrder, Encargo, User (Restrict)" },
  { table: "SupplierPayment", sql: `DELETE FROM "SupplierPayment" WHERE ${BID}`, refs: "→ Supplier, User (Restrict)" },
  // Caja: CashMovement → CashRegister/User; CashRequest → Branch/User.
  { table: "CashRequest", sql: `DELETE FROM "CashRequest" WHERE ${BID}`, refs: "→ Branch, User (Restrict)" },
  { table: "CashMovement", sql: `DELETE FROM "CashMovement" WHERE ${BID}`, refs: "→ CashRegister (cascade), User (NoAction)" },
  { table: "CashRegister", sql: `DELETE FROM "CashRegister" WHERE ${BID}`, refs: "→ User openedBy/closedBy (NoAction)" },
  // Ventas: SaleItem → Sale/Product (Restrict); Sale → Branch/User (Restrict).
  { table: "MarketplaceRequest", sql: `DELETE FROM "MarketplaceRequest" WHERE ${BID}`, refs: "→ Product, User (NoAction)" },
  { table: "SaleItem", sql: `DELETE FROM "SaleItem" WHERE ${BID}`, refs: "→ Sale, Product (Restrict)" },
  { table: "Sale", sql: `DELETE FROM "Sale" WHERE ${BID}`, refs: "→ Branch, User seller (Restrict)" },
  { table: "Encargo", sql: `DELETE FROM "Encargo" WHERE ${BID}`, refs: "referenciada por Payment (Restrict): va después" },
  // Taller: eventos/partes/fotos → RepairOrder/User (Restrict), antes que la orden.
  { table: "RepairEvent", sql: `DELETE FROM "RepairEvent" WHERE ${BID}`, refs: "→ RepairOrder, User (Restrict)" },
  { table: "RepairPart", sql: `DELETE FROM "RepairPart" WHERE ${BID}`, refs: "→ RepairOrder, User createdBy (Restrict)" },
  { table: "RepairPhoto", sql: `DELETE FROM "RepairPhoto" WHERE ${BID}`, refs: "→ RepairOrder (cascade)" },
  { table: "RepairOrder", sql: `DELETE FROM "RepairOrder" WHERE ${BID}`, refs: "→ Branch intake/current, User (Restrict)" },
  // Inventario y catálogo.
  { table: "Reservation", sql: `DELETE FROM "Reservation" WHERE ${BID}`, refs: "→ User, Product (cascade)" },
  { table: "CreditMovement", sql: `DELETE FROM "CreditMovement" WHERE ${BID}`, refs: "→ User (cascade)" },
  { table: "InventoryMovement", sql: `DELETE FROM "InventoryMovement" WHERE ${BID}`, refs: "→ Product (cascade); self-ref relatedId se resuelve en un solo DELETE" },
  { table: "BranchStock", sql: `DELETE FROM "BranchStock" WHERE ${BID}`, refs: "→ Branch (Restrict), Product (cascade)" },
  { table: "ShoppingItem", sql: `DELETE FROM "ShoppingItem" WHERE ${BID}`, refs: "→ User createdBy (Restrict)" },
  { table: "InventoryCountItem", sql: `DELETE FROM "InventoryCountItem" WHERE ${BID}`, refs: "→ InventoryCount (cascade), Product (Restrict)" },
  { table: "InventoryCount", sql: `DELETE FROM "InventoryCount" WHERE ${BID}`, refs: "→ Branch, User (Restrict)" },
  { table: "PurchaseItem", sql: `DELETE FROM "PurchaseItem" WHERE ${BID}`, refs: "→ Purchase (cascade), Product (Restrict)" },
  { table: "Purchase", sql: `DELETE FROM "Purchase" WHERE ${BID}`, refs: "→ Branch, User (Restrict)" },
  { table: "Supplier", sql: `DELETE FROM "Supplier" WHERE ${BID}`, refs: "referenciado por SupplierPayment (Restrict): va después" },
  { table: "PriceHistory", sql: `DELETE FROM "PriceHistory" WHERE ${BID}`, refs: "→ Product (cascade), User changedBy (NoAction)" },
  { table: "ProductModel", sql: `DELETE FROM "ProductModel" WHERE ${BID}`, refs: "→ Product, Model (cascade)" },
  { table: "Product", sql: `DELETE FROM "Product" WHERE ${BID}`, refs: "→ Category (cascade)" },
  { table: "Model", sql: `DELETE FROM "Model" WHERE ${BID}`, refs: "→ Brand (cascade)" },
  { table: "Brand", sql: `DELETE FROM "Brand" WHERE ${BID}`, refs: "catálogo" },
  { table: "Category", sql: `DELETE FROM "Category" WHERE ${BID}`, refs: "catálogo" },
  // Servicios de taller: precios sin businessId vía join al servicio.
  { table: "WorkshopServicePrice", sql: `DELETE FROM "WorkshopServicePrice" wsp USING "WorkshopService" ws WHERE wsp."serviceId" = ws.id AND ws.${BID}`, refs: "hija de WorkshopService (cascade, pero explícito)" },
  { table: "WorkshopService", sql: `DELETE FROM "WorkshopService" WHERE ${BID}`, refs: "catálogo de servicios" },
  // DeviceModel: SOLO filas del tenant — businessId NULL es catálogo global de plataforma.
  { table: "DeviceModel", sql: `DELETE FROM "DeviceModel" WHERE ${BID}`, refs: "filas privadas del tenant; las globales (NULL) sobreviven" },
  // Bitácoras tenant-scoped y actividad.
  { table: "BusinessOperation", sql: `DELETE FROM "BusinessOperation" WHERE ${BID}`, refs: "→ User actor (Restrict)" },
  { table: "AuditEvent", sql: `DELETE FROM "AuditEvent" WHERE ${BID}`, refs: "→ User actor (Restrict)" },
  { table: "ClockEvent", sql: `DELETE FROM "ClockEvent" WHERE ${BID}`, refs: "→ User (cascade)" },
  { table: "DirectoryEvent", sql: `DELETE FROM "DirectoryEvent" WHERE ${BID}`, refs: "telemetría del tenant; anónimas/otros tenants sobreviven" },
  // Config y restos sin dependencias tenant internas.
  { table: "PushSubscription", sql: `DELETE FROM "PushSubscription" WHERE ${BID}`, refs: "independiente" },
  { table: "Settings", sql: `DELETE FROM "Settings" WHERE ${BID}`, refs: "independiente" },
  { table: "SystemSettings", sql: `DELETE FROM "SystemSettings" WHERE ${BID}`, refs: "independiente" },
  { table: "BusinessCounter", sql: `DELETE FROM "BusinessCounter" WHERE ${BID}`, refs: "folios vuelven a 1 tras el borrón" },
  { table: "Notification", sql: `DELETE FROM "Notification" WHERE ${BID}`, refs: "padre de NotificationRead: va después" },
  // Sucursales al final: las referencian ventas/órdenes/caja/compras/conteos.
  { table: "WorkshopBranch", sql: `DELETE FROM "WorkshopBranch" WHERE ${BID}`, refs: "modelo Branch (@@map); SetNull en users restantes es correcto" },
]

// ── Chequeo de cobertura contra el schema real ANTES de tocar una fila ──
const scopedRows = await prisma.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.columns
   WHERE table_schema='public' AND column_name='businessId'
   ORDER BY table_name`
)
const scopedTables = scopedRows.map((r) => r.table_name)
const covered = new Set([...graph.map((g) => g.table), "User"])
const missing = scopedTables.filter((t) => !covered.has(t) && !SURVIVING_TABLES.has(t))
if (missing.length > 0) {
  console.error(`ABORTANDO sin tocar una fila: el schema tiene tablas con businessId que este script no cubre:`)
  for (const t of missing) console.error(`  - ${t}`)
  console.error(`Añade la tabla al grafo de reset-tenant.mjs (posición correcta hijos→padres) y vuelve a correr.`)
  process.exit(1)
}

// Tablas del grafo que ya no existen en la base (schema viejo): se saltan con aviso.
const existingRows = await prisma.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
)
const existing = new Set(existingRows.map((r) => r.table_name))
const plan = graph.filter((g) => {
  if (!existing.has(g.table)) {
    console.log(`  (aviso: la tabla ${g.table} no existe en esta base; se omite)`)
    return false
  }
  return true
})

console.log(`\n⚠️  BORRÓN TOTAL de "${business.name}" (${business.slug ?? business.id})`)
console.log(`    Sobrevive: la cuenta ${keeper.email} (admin), superadmins y el Business vacío.`)
console.log(`    PlatformEvent se conserva a propósito (bitácora de plataforma).`)
console.log(`    Pasos de borrado: ${plan.length} tablas + User\n`)

await prisma.$transaction(async (tx) => {
  let total = 0
  for (const step of plan) {
    const deleted = await tx.$executeRawUnsafe(step.sql, business.id)
    if (deleted > 0) console.log(`  ${step.table}: ${deleted} filas`)
    total += deleted
  }
  // Usuarios al final: casi todo lo demás los referencia con Restrict/NoAction.
  // Se conservan el keeper y cualquier superadmin del tenant.
  const users = await tx.$executeRawUnsafe(
    `DELETE FROM "User" WHERE "businessId" = $1 AND "id" <> $2 AND "isSuperAdmin" = false`,
    business.id, keeper.id
  )
  console.log(`  User: ${users} filas`)
  total += users

  // Verificación posterior: no debe quedar NADA del tenant en tablas cubiertas.
  const leftovers = []
  for (const t of scopedTables) {
    if (SURVIVING_TABLES.has(t) || t === "User") continue
    const rows = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "${t}" WHERE "businessId" = $1`, business.id
    )
    if (rows[0]?.n > 0) leftovers.push(`${t} (${rows[0].n})`)
  }
  // User conserva al keeper y a superadmins a propósito: lo que no debe
  // quedar es ningún usuario más del tenant.
  const strayUsers = await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "User" WHERE "businessId" = $1 AND "id" <> $2 AND "isSuperAdmin" = false`,
    business.id, keeper.id
  )
  if (strayUsers[0]?.n > 0) leftovers.push(`User (${strayUsers[0].n} no conservados)`)
  if (leftovers.length > 0) {
    throw new Error(`Borrón incompleto, se revierte la transacción. Quedan filas en: ${leftovers.join(", ")}`)
  }
  console.log(`\nTotal eliminado: ${total} filas. Verificación posterior limpia.`)
}, { timeout: 120000 })

await prisma.$disconnect()
console.log("Listo. El negocio quedó en blanco: entra con tu admin y reconfigura sucursales, usuarios y productos.")
