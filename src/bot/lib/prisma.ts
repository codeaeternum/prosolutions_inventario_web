import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

let prismaInstance: PrismaClient | null = null

/**
 * Obtiene el cliente Prisma del bot (singleton).
 * Usa adapter pg para compatibilidad con el runtime del bot.
 * Si DATABASE_URL no está o falla la inicialización, devuelve null (bot en modo OFFLINE).
 */
export function getPrisma(): PrismaClient | null {
  if (prismaInstance !== null) return prismaInstance
  const isDev = process.env.NODE_ENV !== "production"
  try {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      if (isDev) console.warn("⚠️ DATABASE_URL no definida, bot sin DB")
      return null
    }
    const pool = new Pool({ connectionString })
    const adapter = new PrismaPg(pool)
    prismaInstance = new PrismaClient({ adapter })
    if (isDev) console.log("✅ Prisma Client loaded (via Adapter)")
    return prismaInstance
  } catch (e) {
    console.error("⚠️ Failed to load/init Prisma:", e)
    if (isDev) console.log("⚠️ Bot running in OFFLINE mode (No DB)")
    return null
  }
}
