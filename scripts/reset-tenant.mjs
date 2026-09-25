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
 */
import { PrismaClient } from "@prisma/client"

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

const prisma = new PrismaClient()

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

// Todas las tablas tenant-scoped: las que tienen columna businessId.
// User/Business se manejan aparte (hay que conservar al admin).
const scopedTables = await prisma.$queryRawUnsafe(
  `SELECT table_name FROM information_schema.columns
   WHERE table_schema='public' AND column_name='businessId' AND table_name <> 'User'
   ORDER BY table_name`
)

console.log(`\n⚠️  BORRÓN TOTAL de "${business.name}" (${business.slug ?? business.id})`)
console.log(`    Sobrevive: la cuenta ${keeper.email} (admin) y el Business vacío.`)
console.log(`    Tablas afectadas: ${scopedTables.length}\n`)

await prisma.$transaction(async (tx) => {
  // Desactiva FKs solo en esta transacción — el orden de borrado deja de
  // importar y no hace falta enumerar el grafo de dependencias a mano.
  await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`)

  let total = 0
  for (const { table_name } of scopedTables) {
    const deleted = await tx.$executeRawUnsafe(
      `DELETE FROM "${table_name}" WHERE "businessId" = $1`, business.id
    )
    if (deleted > 0) console.log(`  ${table_name}: ${deleted} filas`)
    total += deleted
  }
  const users = await tx.$executeRawUnsafe(
    `DELETE FROM "User" WHERE "businessId" = $1 AND "id" <> $2 AND "isSuperAdmin" = false`,
    business.id, keeper.id
  )
  console.log(`  User: ${users} filas`)
  total += users
  console.log(`\nTotal eliminado: ${total} filas.`)
}, { timeout: 120000 })

await prisma.$disconnect()
console.log("Listo. El negocio quedó en blanco: entra con tu admin y reconfigura sucursales, usuarios y productos.")
