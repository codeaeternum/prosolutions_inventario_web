import { PrismaClient, UserRole, UserStatus, CustomerType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const DEFAULT_BUSINESS_ID = 'biz-default'

const connectionString = process.env.DATABASE_URL ||
  'postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db'

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// Base de datos de modelos populares con sus variantes/SKUs
const deviceData: Record<string, { name: string; variants: string[] }[]> = {
  Apple: [
    { name: "iPhone 16 Pro Max", variants: ["A3295", "A3094", "A3096", "A3293"] },
    { name: "iPhone 16 Pro", variants: ["A3294", "A3093", "A3095", "A3292"] },
    { name: "iPhone 16 Plus", variants: ["A3291", "A3092", "A3287", "A3289"] },
    { name: "iPhone 16", variants: ["A3290", "A3091", "A3286", "A3288"] },
    { name: "iPhone 15 Pro Max", variants: ["A2849", "A3105", "A3106", "A3108"] },
    { name: "iPhone 15 Pro", variants: ["A2848", "A3101", "A3102", "A3104"] },
    { name: "iPhone 15 Plus", variants: ["A2847", "A3093", "A3094", "A3096"] },
    { name: "iPhone 15", variants: ["A2846", "A3089", "A3090", "A3092"] },
    { name: "iPhone 14 Pro Max", variants: ["A2651", "A2893", "A2894", "A2896"] },
    { name: "iPhone 14 Pro", variants: ["A2650", "A2889", "A2890", "A2892"] },
    { name: "iPhone 14 Plus", variants: ["A2632", "A2885", "A2886", "A2888"] },
    { name: "iPhone 14", variants: ["A2649", "A2881", "A2882", "A2884"] },
    { name: "iPhone 13 Pro Max", variants: ["A2484", "A2641", "A2643", "A2645"] },
    { name: "iPhone 13 Pro", variants: ["A2483", "A2636", "A2638", "A2640"] },
    { name: "iPhone 13", variants: ["A2482", "A2631", "A2633", "A2635"] },
    { name: "iPhone 13 mini", variants: ["A2481", "A2626", "A2628", "A2630"] },
    { name: "iPhone 12 Pro Max", variants: ["A2342", "A2410", "A2411", "A2412"] },
    { name: "iPhone 12 Pro", variants: ["A2341", "A2406", "A2407", "A2408"] },
    { name: "iPhone 12", variants: ["A2172", "A2402", "A2403", "A2404"] },
    { name: "iPhone 12 mini", variants: ["A2176", "A2398", "A2399", "A2400"] },
    { name: "iPhone 11 Pro Max", variants: ["A2161", "A2220", "A2218"] },
    { name: "iPhone 11 Pro", variants: ["A2160", "A2217", "A2215"] },
    { name: "iPhone 11", variants: ["A2111", "A2223", "A2221"] },
    { name: "iPhone SE 3ra Gen", variants: ["A2595", "A2782", "A2783", "A2784"] },
    { name: "iPhone SE 2da Gen", variants: ["A2275", "A2296", "A2298"] },
    { name: "iPhone SE 1ra Gen", variants: ["A1662", "A1723", "A1724"] },
    { name: "iPhone XS Max", variants: ["A1921", "A2101", "A2102", "A2104"] },
    { name: "iPhone XS", variants: ["A1920", "A2097", "A2098", "A2100"] },
    { name: "iPhone XR", variants: ["A1984", "A2105", "A2106", "A2108"] },
    { name: "iPhone X", variants: ["A1865", "A1901", "A1902"] },
    { name: "iPhone 8 Plus", variants: ["A1864", "A1897", "A1898"] },
    { name: "iPhone 8", variants: ["A1863", "A1905", "A1906"] },
    { name: "iPad Pro 12.9 (M2)", variants: ["A2436", "A2764"] },
    { name: "iPad Pro 11 (M2)", variants: ["A2759", "A2435"] },
    { name: "iPad Air (5ta Gen)", variants: ["A2588", "A2589"] },
    { name: "iPad mini (6ta Gen)", variants: ["A2567", "A2568"] },
  ],
  Samsung: [
    { name: "Galaxy S25 Ultra", variants: ["SM-S938B", "SM-S938B/DS", "SM-S938U", "SM-S938U1", "SM-S938W", "SM-S938N", "SM-S9380"] },
    { name: "Galaxy S25+", variants: ["SM-S936B", "SM-S936B/DS", "SM-S936U", "SM-S936U1", "SM-S936W", "SM-S936N"] },
    { name: "Galaxy S25", variants: ["SM-S931B", "SM-S931B/DS", "SM-S931U", "SM-S931U1", "SM-S931W", "SM-S931N"] },
    { name: "Galaxy S24 Ultra", variants: ["SM-S928B", "SM-S928B/DS", "SM-S928U", "SM-S928U1", "SM-S928W", "SM-S928N"] },
    { name: "Galaxy S24+", variants: ["SM-S926B", "SM-S926B/DS", "SM-S926U", "SM-S926U1", "SM-S926W"] },
    { name: "Galaxy S24", variants: ["SM-S921B", "SM-S921B/DS", "SM-S921U", "SM-S921U1", "SM-S921W"] },
    { name: "Galaxy S23 Ultra", variants: ["SM-S918B", "SM-S918B/DS", "SM-S918U", "SM-S918U1", "SM-S918W"] },
    { name: "Galaxy S23+", variants: ["SM-S916B", "SM-S916B/DS", "SM-S916U", "SM-S916U1", "SM-S916W"] },
    { name: "Galaxy S23", variants: ["SM-S911B", "SM-S911B/DS", "SM-S911U", "SM-S911U1", "SM-S911W"] },
    { name: "Galaxy S22 Ultra", variants: ["SM-S908B", "SM-S908B/DS", "SM-S908U", "SM-S908U1", "SM-S908W"] },
    { name: "Galaxy S22+", variants: ["SM-S906B", "SM-S906B/DS", "SM-S906U", "SM-S906U1", "SM-S906W"] },
    { name: "Galaxy S22", variants: ["SM-S901B", "SM-S901B/DS", "SM-S901U", "SM-S901U1", "SM-S901W"] },
    { name: "Galaxy S21 Ultra 5G", variants: ["SM-G998B", "SM-G998B/DS", "SM-G998U", "SM-G998U1"] },
    { name: "Galaxy S21+ 5G", variants: ["SM-G996B", "SM-G996B/DS", "SM-G996U", "SM-G996U1"] },
    { name: "Galaxy S21 5G", variants: ["SM-G991B", "SM-G991B/DS", "SM-G991U", "SM-G991U1"] },
    { name: "Galaxy Z Fold 6", variants: ["SM-F956B", "SM-F956B/DS", "SM-F956U", "SM-F956U1", "SM-F956W"] },
    { name: "Galaxy Z Fold 5", variants: ["SM-F946B", "SM-F946B/DS", "SM-F946U", "SM-F946U1", "SM-F946W"] },
    { name: "Galaxy Z Flip 6", variants: ["SM-F741B", "SM-F741B/DS", "SM-F741U", "SM-F741U1", "SM-F741W"] },
    { name: "Galaxy Z Flip 5", variants: ["SM-F731B", "SM-F731B/DS", "SM-F731U", "SM-F731U1", "SM-F731W"] },
    { name: "Galaxy A55 5G", variants: ["SM-A556B", "SM-A556B/DS", "SM-A556E", "SM-A556E/DS"] },
    { name: "Galaxy A54 5G", variants: ["SM-A546B", "SM-A546B/DS", "SM-A546E", "SM-A546U"] },
    { name: "Galaxy A35 5G", variants: ["SM-A356B", "SM-A356B/DS", "SM-A356E", "SM-A356E/DS"] },
    { name: "Galaxy A34 5G", variants: ["SM-A346B", "SM-A346B/DS", "SM-A346E", "SM-A346E/DS"] },
    { name: "Galaxy A25 5G", variants: ["SM-A256B", "SM-A256B/DS", "SM-A256E"] },
    { name: "Galaxy A15 5G", variants: ["SM-A156B", "SM-A156B/DS", "SM-A156E"] },
    { name: "Galaxy A15", variants: ["SM-A155F", "SM-A155F/DS", "SM-A155M"] },
    { name: "Galaxy A14", variants: ["SM-A145F", "SM-A145M"] },
    { name: "Galaxy A05", variants: ["SM-A055F", "SM-A055M"] },
    { name: "Galaxy M54", variants: ["SM-M546B"] },
    { name: "Galaxy M34", variants: ["SM-M346B"] },
    { name: "Galaxy Tab S9", variants: ["SM-X710", "SM-X716B"] },
    { name: "Galaxy Tab S8", variants: ["SM-X700", "SM-X706B"] },
  ],
  Xiaomi: [
    { name: "Xiaomi 14 Ultra", variants: ["24030PN60G", "2403DPN60G"] },
    { name: "Xiaomi 14 Pro", variants: ["23116PN5BC", "23116PN5BG"] },
    { name: "Xiaomi 14", variants: ["23127PN0CC", "23127PN0CG"] },
    { name: "Xiaomi 13 Ultra", variants: ["2304FPN6DC", "2210132C"] },
    { name: "Xiaomi 13 Pro", variants: ["2210132G", "2210132C"] },
    { name: "Xiaomi 13", variants: ["2211133G", "2211133C"] },
    { name: "Redmi Note 13 Pro+ 5G", variants: ["23090RA98G", "23090RA98C"] },
    { name: "Redmi Note 13 Pro 5G", variants: ["23090RA99G", "23090RA99C"] },
    { name: "Redmi Note 13 5G", variants: ["23105RN4CG", "23105RN4CC"] },
    { name: "Redmi Note 13 Pro", variants: ["2312DRA50G", "2312DRA50I"] },
    { name: "Redmi Note 13", variants: ["23106RN0DA", "23106RN0DG"] },
    { name: "Redmi Note 12 Pro+ 5G", variants: ["22101316UG", "22101316UC"] },
    { name: "Redmi Note 12 Pro 5G", variants: ["22101316G", "22101316C"] },
    { name: "POCO X6 Pro 5G", variants: ["23122PCD1G", "23122PCD1I"] },
    { name: "POCO X6 5G", variants: ["23122PCD1G", "23122PCD1I"] },
    { name: "POCO F5 Pro", variants: ["23013PC75G", "23013PC75C"] },
    { name: "POCO F5", variants: ["23049PCD8G", "23049PCD8I"] },
    { name: "POCO M6 Pro", variants: ["23053RN02A", "23053RN02G"] },
    { name: "Xiaomi 14T Pro", variants: ["2407FPN8EG", "2407FPN8EC"] },
    { name: "Xiaomi 14T", variants: ["2406APNFAG", "2406APNFAC"] },
    { name: "Redmi 14C", variants: ["2409BRN2CG"] },
    { name: "Redmi 13C", variants: ["23100RN82L", "23106RN0DA"] },
    { name: "Xiaomi Pad 6", variants: ["23043RP34G", "23043RP34C"] },
  ],
  Motorola: [
    { name: "Motorola Edge 50 Ultra", variants: ["XT2401-1", "XT2401-2", "XT2401-3"] },
    { name: "Motorola Edge 50 Pro", variants: ["XT2403-1", "XT2403-2", "XT2403-3"] },
    { name: "Motorola Edge 40 Pro", variants: ["XT2301-1", "XT2301-2", "XT2301-3", "XT2301-4"] },
    { name: "Motorola Edge 40", variants: ["XT2303-1", "XT2303-2", "XT2303-3"] },
    { name: "Moto G84 5G", variants: ["XT2347-1", "XT2347-2", "XT2347-3"] },
    { name: "Moto G73 5G", variants: ["XT2237-1", "XT2237-2", "XT2237-3"] },
    { name: "Moto G54 5G", variants: ["XT2343-1", "XT2343-2", "XT2343-3"] },
    { name: "Moto G34 5G", variants: ["XT2363-1", "XT2363-2", "XT2363-3"] },
    { name: "Moto G24", variants: ["XT2423-1", "XT2423-2", "XT2423-3"] },
    { name: "Moto G14", variants: ["XT2341-1", "XT2341-2", "XT2341-3"] },
    { name: "Moto Razr 40 Ultra", variants: ["XT2321-1", "XT2321-2", "XT2321-3"] },
    { name: "Moto Razr 40", variants: ["XT2323-1", "XT2323-2", "XT2323-3"] },
    { name: "ThinkPhone", variants: ["XT2309-1", "XT2309-2", "XT2309-3"] },
    { name: "Moto G Play", variants: ["XT2413-1", "XT2413-2"] },
    { name: "Moto G Power", variants: ["XT2415-1", "XT2415-2"] },
  ],
  Huawei: [
    { name: "Huawei Pura 70 Ultra", variants: ["LNA-AL00", "LNA-LX9"] },
    { name: "Huawei Pura 70 Pro", variants: ["HBN-AL00", "HBN-LX9"] },
    { name: "Huawei Mate 60 Pro", variants: ["ALN-AL00", "ALN-LX9"] },
    { name: "Huawei Mate 60", variants: ["BRA-AL00", "BRA-LX9"] },
    { name: "Huawei P60 Pro", variants: ["MNA-AL00", "MNA-LX9"] },
    { name: "Huawei P60", variants: ["LNA-AL00", "LNA-LX9"] },
    { name: "Huawei Nova 12 Pro", variants: ["FOA-AL00", "FOA-LX9"] },
    { name: "Huawei Nova 12", variants: ["BKL-AL00", "BKL-LX9"] },
    { name: "Huawei Nova 11 Pro", variants: ["GOA-AL00", "GOA-LX9"] },
    { name: "Huawei Nova 11", variants: ["FOA-AL00", "FOA-LX9"] },
    { name: "Huawei MatePad 11", variants: ["DBY-W09"] },
    { name: "Huawei nova Y91", variants: ["STG-LX1"] },
    { name: "Huawei nova Y72", variants: ["MGA-LX9"] },
  ],
  OPPO: [
    { name: "OPPO Find X7 Ultra", variants: ["PHZ110", "PHZ120"] },
    { name: "OPPO Find X7", variants: ["PHU110", "PHU120"] },
    { name: "OPPO Reno 11 Pro 5G", variants: ["CPH2603", "CPH2609"] },
    { name: "OPPO Reno 11 5G", variants: ["CPH2601", "CPH2607"] },
    { name: "OPPO A79 5G", variants: ["CPH2557", "CPH2559"] },
    { name: "OPPO A58 5G", variants: ["CPH2507", "CPH2509"] },
    { name: "OPPO A38", variants: ["CPH2579", "CPH2581"] },
    { name: "OPPO A18", variants: ["CPH2595", "CPH2597"] },
  ],
  OnePlus: [
    { name: "OnePlus 12", variants: ["CPH2573", "PJD110"] },
    { name: "OnePlus 12R", variants: ["CPH2585", "CPH2609"] },
    { name: "OnePlus 11", variants: ["CPH2447", "CPH2449", "PHB110"] },
    { name: "OnePlus Nord 4", variants: ["CPH2653", "CPH2655"] },
    { name: "OnePlus Nord CE 4", variants: ["CPH2625", "CPH2627"] },
    { name: "OnePlus Nord CE 3 Lite", variants: ["CPH2467", "CPH2469"] },
  ],
  Google: [
    { name: "Pixel 9 Pro XL", variants: ["GQE4S", "GP4YB"] },
    { name: "Pixel 9 Pro", variants: ["GQE4P", "GP4YA"] },
    { name: "Pixel 9", variants: ["GC9VY", "GWPK6"] },
    { name: "Pixel 8 Pro", variants: ["GC3VE", "G9FPL"] },
    { name: "Pixel 8", variants: ["GKWS6", "G9BQD"] },
    { name: "Pixel 8a", variants: ["G6GPR", "GQVYX"] },
    { name: "Pixel 7 Pro", variants: ["GP4BC", "GE2AE"] },
    { name: "Pixel 7", variants: ["GVU6C", "GQML3"] },
    { name: "Pixel 7a", variants: ["GHL1X", "GWKK3"] },
    { name: "Pixel 6 Pro", variants: ["G8VOU", "GLU0G"] },
    { name: "Pixel 6", variants: ["GB7N6", "G9S9B"] },
    { name: "Pixel Fold", variants: ["G9FPL", "G0B96"] },
    { name: "Pixel Tablet", variants: ["GTU8P"] },
  ],
  Realme: [
    { name: "Realme GT 5 Pro", variants: ["RMX3888", "RMX3886"] },
    { name: "Realme GT 5", variants: ["RMX3708", "RMX3706"] },
    { name: "Realme 12 Pro+ 5G", variants: ["RMX3840", "RMX3842"] },
    { name: "Realme 12 Pro 5G", variants: ["RMX3830", "RMX3832"] },
    { name: "Realme 12+ 5G", variants: ["RMX3998", "RMX3996"] },
    { name: "Realme 12 5G", variants: ["RMX3994", "RMX3992"] },
    { name: "Realme C67", variants: ["RMX3890", "RMX3892"] },
    { name: "Realme C55", variants: ["RMX3710", "RMX3712"] },
  ],
  Honor: [
    { name: "Honor Magic6 Pro", variants: ["BVL-N49"] },
    { name: "Honor Magic5 Pro", variants: ["PGT-N19"] },
    { name: "Honor 90", variants: ["REA-NX9"] },
    { name: "Honor X9b", variants: ["ALI-NX1"] },
    { name: "Honor X8b", variants: ["LLY-LX1", "LLY-LX2"] },
    { name: "Honor 200 Smart", variants: ["CLL-NX1"] },
    { name: "Honor 200 Lite", variants: ["CLY-LX1"] },
  ],
  Nothing: [
    { name: "Nothing Phone (2a)", variants: ["A142"] },
    { name: "Nothing Phone (2)", variants: ["A065"] },
    { name: "Nothing Phone (1)", variants: ["A063"] },
  ],
  Sony: [
    { name: "Xperia 1 VI", variants: ["XQ-EC54", "XQ-EC72"] },
    { name: "Xperia 1 V", variants: ["XQ-DQ54", "XQ-DQ72"] },
    { name: "Xperia 5 V", variants: ["XQ-DE54", "XQ-DE72"] },
    { name: "Xperia 10 VI", variants: ["XQ-ES54", "XQ-ES72"] },
    { name: "Xperia 10 V", variants: ["XQ-DC54", "XQ-DC72"] },
  ],
  Tecno: [
    { name: "Camon 30 Premier", variants: ["CL9"] },
    { name: "Camon 30 Pro", variants: ["CL8"] },
    { name: "Spark 20 Pro+", variants: ["KJ7"] },
    { name: "Spark 20 Pro", variants: ["KJ6"] },
    { name: "Spark 20", variants: ["KJ5"] },
    { name: "Pova 6 Pro", variants: ["LI9"] },
    { name: "Pova 5 Pro", variants: ["LH8n"] },
  ],
  Nokia: [
    { name: "Nokia G42", variants: ["TA-1581"] },
    { name: "Nokia G22", variants: ["TA-1528"] },
    { name: "Nokia G310", variants: ["TA-1573"] },
    { name: "Nokia C32", variants: ["TA-1534"] },
    { name: "Nokia C22", variants: ["TA-1533"] },
    { name: "Nokia XR21", variants: ["TA-1486"] },
  ],
  ZTE: [
    { name: "Nubia Z60 Ultra", variants: ["NX721J"] },
    { name: "Blade V50", variants: ["ZTE 8050"] },
    { name: "Blade V40", variants: ["ZTE 8045"] },
  ],
  Alcatel: [
    { name: "Alcatel 3X", variants: ["5061K"] },
    { name: "Alcatel 1SE", variants: ["5030F"] },
    { name: "Alcatel 1V", variants: ["5001A"] },
  ],
  TCL: [
    { name: "TCL 50 XL", variants: ["T611A"] },
    { name: "TCL 40 SE", variants: ["T610K"] },
    { name: "TCL 30 SE", variants: ["6165H"] },
  ],
}

async function main() {
  console.log('========================================')
  console.log('  PRO-SOLUTIONS - Database Seed')
  console.log('========================================')
  console.log('')

  // Create admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@prosolutions.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  const hashedPassword = await bcrypt.hash(adminPassword, 12)

  // Negocio por defecto: todos los registros del seed cuelgan de este tenant.
  const business = await prisma.business.upsert({
    where: { id: DEFAULT_BUSINESS_ID },
    update: {},
    create: {
      id: DEFAULT_BUSINESS_ID,
      name: 'ProSolutions',
      slug: 'prosolutions',
    },
  })

  console.log(`Business: ${business.id}`)

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      businessId: business.id,
      email: adminEmail,
      password: hashedPassword,
      name: 'Administrador',
      role: UserRole.ADMIN,
      customerType: CustomerType.NORMAL,
      status: UserStatus.APPROVED,
    },
  })

  console.log(`Admin: ${admin.email}`)

  // Create default settings
  await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      businessId: business.id,
      tempReservationMinutes: 30,
      depositPercentage: 50,
      depositReservationHours: 48,
      pendingVerificationHours: 24,
    },
  })

  console.log('Settings: OK')

  // Create categories
  const categories = [
    { name: 'Pantalla OLED', slug: 'pantallas-oled', icon: 'monitor' },
    { name: 'Pantalla LCD', slug: 'pantallas-lcd', icon: 'tv' },
    { name: 'Batería', slug: 'baterias', icon: 'battery-full' },
    { name: 'Flex de carga', slug: 'flex-carga', icon: 'cable' },
    { name: 'Flex de volumen', slug: 'flex-volumen', icon: 'sliders' },
    { name: 'Flex de encendido', slug: 'flex-encendido', icon: 'power' },
    { name: 'Cámara trasera', slug: 'camaras-traseras', icon: 'camera' },
    { name: 'Cámara frontal', slug: 'camaras-frontales', icon: 'user' },
    { name: 'Bocina', slug: 'bocinas', icon: 'speaker' },
    { name: 'Auricular', slug: 'auricular', icon: 'phone' },
    { name: 'Botón', slug: 'botones', icon: 'circle-dot' },
    { name: 'Marco / Housing', slug: 'marcos', icon: 'square' },
    { name: 'Tapa trasera', slug: 'tapas', icon: 'smartphone' },
    { name: 'Conector', slug: 'conectores', icon: 'plug' },
    { name: 'Antena', slug: 'antenas', icon: 'wifi' },
    { name: 'Sensor', slug: 'sensores', icon: 'scan' },
    { name: 'Herramienta', slug: 'herramientas', icon: 'wrench' },
    { name: 'Accesorio', slug: 'accesorios', icon: 'package' },
    { name: 'Mica de cristal', slug: 'micas', icon: 'shield' },
    { name: 'Funda / Case', slug: 'fundas', icon: 'smartphone' },
    { name: 'Cable / Adaptador', slug: 'cables', icon: 'cable' },
    { name: 'Altavoz externo', slug: 'altavoces-externos', icon: 'speaker' },
  ]

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { ...category, businessId: business.id },
    })
  }

  console.log(`Categorias: ${categories.length}`)

  // Create brands and models with variants
  let totalModels = 0

  for (const [brandName, models] of Object.entries(deviceData)) {
    const brand = await prisma.brand.upsert({
      where: { slug: brandName.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: {
        businessId: business.id,
        name: brandName,
        slug: brandName.toLowerCase().replace(/\s+/g, '-'),
      },
    })

    for (const modelData of models) {
      const modelSlug = modelData.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')

      await prisma.model.upsert({
        where: { brandId_slug: { brandId: brand.id, slug: modelSlug } },
        update: {},
        create: {
          businessId: business.id,
          name: modelData.name,
          slug: modelSlug,
          brandId: brand.id,
        },
      })

      totalModels++
    }

    console.log(`${brandName}: ${models.length} modelos`)
  }

  // Create sample products - ELIMINADO para producción
  /*
  console.log('')
  console.log('>>> Creando productos de demostración...')

  const sampleProducts = [
    { model: 'iPhone 16 Pro Max', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 16 Pro Max', retail: 4500, wholesale: 3800, stock: 15 },
    { model: 'iPhone 16 Pro', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 16 Pro', retail: 4200, wholesale: 3500, stock: 12 },
    { model: 'iPhone 15 Pro Max', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 15 Pro Max', retail: 3800, wholesale: 3200, stock: 20 },
    { model: 'iPhone 15 Pro', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 15 Pro', retail: 3500, wholesale: 2900, stock: 18 },
    { model: 'iPhone 14 Pro Max', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 14 Pro Max', retail: 3200, wholesale: 2700, stock: 25 },
    { model: 'iPhone 14 Pro', brand: 'Apple', category: 'Pantallas OLED', name: 'Pantalla OLED iPhone 14 Pro', retail: 2900, wholesale: 2400, stock: 22 },
    { model: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'Pantallas OLED', name: 'Pantalla AMOLED Galaxy S24 Ultra', retail: 5200, wholesale: 4500, stock: 10 },
    { model: 'Galaxy S24+', brand: 'Samsung', category: 'Pantallas OLED', name: 'Pantalla AMOLED Galaxy S24+', retail: 4800, wholesale: 4100, stock: 8 },
    { model: 'Galaxy S23 Ultra', brand: 'Samsung', category: 'Pantallas OLED', name: 'Pantalla AMOLED Galaxy S23 Ultra', retail: 4500, wholesale: 3800, stock: 14 },
    { model: 'iPhone 16 Pro Max', brand: 'Apple', category: 'Baterias', name: 'Batería iPhone 16 Pro Max Original', retail: 850, wholesale: 650, stock: 30 },
    { model: 'iPhone 15 Pro Max', brand: 'Apple', category: 'Baterias', name: 'Batería iPhone 15 Pro Max Original', retail: 750, wholesale: 580, stock: 35 },
    { model: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'Baterias', name: 'Batería Galaxy S24 Ultra Original', retail: 680, wholesale: 520, stock: 28 },
    { model: 'iPhone 16 Pro Max', brand: 'Apple', category: 'Flex de carga', name: 'Flex de Carga iPhone 16 Pro Max', retail: 450, wholesale: 350, stock: 40 },
    { model: 'iPhone 15 Pro', brand: 'Apple', category: 'Flex de carga', name: 'Flex de Carga iPhone 15 Pro', retail: 380, wholesale: 290, stock: 45 },
    { model: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'Camaras traseras', name: 'Cámara Trasera Galaxy S24 Ultra', retail: 1800, wholesale: 1500, stock: 12 },
    { model: 'iPhone 15 Pro Max', brand: 'Apple', category: 'Camaras traseras', name: 'Cámara Trasera iPhone 15 Pro Max', retail: 2200, wholesale: 1800, stock: 10 },
  ]

  for (const product of sampleProducts) {
    try {
      const brand = await prisma.brand.findFirst({ where: { name: product.brand } })
      const model = await prisma.model.findFirst({
        where: { name: product.model, brandId: brand?.id }
      })
      const category = await prisma.category.findFirst({ where: { name: product.category } })

      if (brand && model && category) {
        const existingProduct = await prisma.product.findFirst({
          where: { name: product.name }
        })

        if (!existingProduct) {
          await prisma.product.create({
            data: {
              name: product.name,
              retailPrice: product.retail,
              wholesalePrice: product.wholesale,
              stock: product.stock,
              minStock: 5,
              isPublic: true,
              isActive: true,
              hidePrice: false,
              categoryId: category.id,
              models: {
                create: { modelId: model.id }
              }
            }
          })
        }
      }
    } catch (e) {
      // Ignore errors for duplicate products
    }
  }

  console.log(`Productos de demostración omitidos.`)
  */

  console.log('')
  console.log('========================================')
  console.log('  SEED COMPLETADO')
  console.log('========================================')
  console.log(`Modelos: ${totalModels}`)
  console.log('')
  console.log('Credenciales Admin:')
  console.log(`  Email: ${adminEmail}`)
  console.log(`  Password: ${adminPassword}`)
  console.log('========================================')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
