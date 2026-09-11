import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL ||
  'postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db'

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function cleanDemoProducts() {
  console.log('Iniciando limpieza de productos de demostración...')

  const sampleProductNames = [
    'Pantalla OLED iPhone 16 Pro Max',
    'Pantalla OLED iPhone 16 Pro',
    'Pantalla OLED iPhone 15 Pro Max',
    'Pantalla OLED iPhone 15 Pro',
    'Pantalla OLED iPhone 14 Pro Max',
    'Pantalla OLED iPhone 14 Pro',
    'Pantalla AMOLED Galaxy S24 Ultra',
    'Pantalla AMOLED Galaxy S24+',
    'Pantalla AMOLED Galaxy S23 Ultra',
    'Batería iPhone 16 Pro Max Original',
    'Batería iPhone 15 Pro Max Original',
    'Batería Galaxy S24 Ultra Original',
    'Flex de Carga iPhone 16 Pro Max',
    'Flex de Carga iPhone 15 Pro',
    'Cámara Trasera Galaxy S24 Ultra',
    'Cámara Trasera iPhone 15 Pro Max',
  ]

  let deletedCount = 0

  for (const name of sampleProductNames) {
    try {
      // Primero encontramos el producto
      const product = await prisma.product.findFirst({
        where: { name }
      })

      if (product) {
        // Eliminar relaciones primero
        await prisma.productModel.deleteMany({
          where: { productId: product.id }
        })
        
        await prisma.inventoryMovement.deleteMany({
          where: { productId: product.id }
        })

        await prisma.reservation.deleteMany({
          where: { productId: product.id }
        })

        // Eliminar producto
        await prisma.product.delete({
          where: { id: product.id }
        })
        
        deletedCount++
        console.log(`✓ Eliminado: ${name}`)
      }
    } catch (e) {
      console.error(`❌ Error al eliminar ${name}:`, e)
    }
  }

  console.log(`\nLimpieza completada. ${deletedCount} productos eliminados.`)
  await prisma.$disconnect()
}

cleanDemoProducts()
