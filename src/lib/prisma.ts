import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// En desarrollo local usamos localhost, en Docker/producción usa 'db'
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
  // Para desarrollo local, reemplazar 'db' por 'localhost'
  if (process.env.NODE_ENV !== "production" && envUrl.includes("@db:")) {
    return envUrl.replace("@db:", "@localhost:")
  }
  return envUrl
}

const connectionString = getConnectionString()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const pool = new Pool({ connectionString })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
