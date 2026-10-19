import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// La conexión es explícita: nunca redirigir una base de datos de forma implícita.
function getConnectionString(): string {
  const envUrl = process.env.DATABASE_URL
  if (!envUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL es requerida en producción. Configure la variable de entorno.")
    }
    throw new Error(
      "DATABASE_URL no está definida. Cree un archivo .env con DATABASE_URL."
    )
  }
  return envUrl
}

const connectionString = getConnectionString()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
