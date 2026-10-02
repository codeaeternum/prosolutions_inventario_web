import type { PrismaClient } from "@prisma/client"

/**
 * Purga de altas de negocio abandonadas (owner ADMIN+PENDING que nunca
 * verificó correo/teléfono). Compartida entre el endpoint HTTP
 * /api/cron/purge-pending-signups y el cron diario del bot — ambos usan la
 * misma lógica con su propio cliente Prisma.
 *
 * Un owner PENDING no puede loguearse, así que un tenant así solo contiene
 * filas semilla (User, SystemSettings, WorkshopService, Branch) más las
 * cascadas (VerificationCode, DeviceModel, Notification/NotificationRead).
 * Aun así se exige el cinturón products/sales/repairOrders = 0 por fila.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_PENDING_DAYS = 7

/** Días de gracia antes de purgar un alta PENDING. Mínimo 1 aunque el env diga menos. */
export function pendingSignupDays(): number {
  const parsed = Number.parseInt(process.env.SIGNUP_PENDING_PURGE_DAYS ?? "", 10)
  return Math.max(1, Number.isFinite(parsed) ? parsed : DEFAULT_PENDING_DAYS)
}

/** P2014 (delete con relación requerida con filas) y P2003 (FK constraint). */
function isFkViolation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === "P2014" || code === "P2003"
}

export interface PendingSignupCandidate {
  id: string
  slug: string
  name: string
  createdAt: Date
  _count: { products: number; sales: number; repairOrders: number; users: number }
}

export interface PendingSignupScan {
  purgeable: PendingSignupCandidate[]
  skipped: { slug: string; reason: string }[]
}

/**
 * Candidatos: alta vieja donde TODOS los users son ADMIN+PENDING (every) y
 * existe al menos uno (some) — el tenant nunca operó. El cinturón extra
 * (products/sales/repairOrders = 0) se revisa por fila con _count para poder
 * reportar en `skipped` al PENDING que sí dejó datos.
 */
export async function findPendingSignupCandidates(
  db: PrismaClient,
  days: number = pendingSignupDays(),
): Promise<PendingSignupScan> {
  const cutoff = new Date(Date.now() - days * DAY_MS)
  const found = await db.business.findMany({
    where: {
      createdAt: { lt: cutoff },
      users: {
        some: {},
        every: { role: "ADMIN", status: "PENDING" },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      _count: { select: { products: true, sales: true, repairOrders: true, users: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const skipped: PendingSignupScan["skipped"] = []
  const purgeable: PendingSignupCandidate[] = []
  for (const business of found) {
    const c = business._count
    if (c.users === 0) {
      skipped.push({ slug: business.slug, reason: "sin usuarios" })
    } else if (c.products > 0 || c.sales > 0 || c.repairOrders > 0) {
      // Un PENDING no puede operar: datos operativos aquí huelen a alta
      // sembrada por seed/migración — mejor reportar que borrar.
      skipped.push({
        slug: business.slug,
        reason: `tiene datos operativos (products=${c.products}, sales=${c.sales}, repairOrders=${c.repairOrders})`,
      })
    } else {
      purgeable.push(business)
    }
  }
  return { purgeable, skipped }
}

export interface PurgeResult {
  purged: number
  skipped: { slug: string; reason: string }[]
  tenants: string[]
}

/** Borra cada candidato en una transacción propia con orden FK-seguro. */
export async function purgePendingSignups(
  db: PrismaClient,
  days: number = pendingSignupDays(),
): Promise<PurgeResult> {
  const { purgeable, skipped } = await findPendingSignupCandidates(db, days)
  const tenants: string[] = []

  for (const business of purgeable) {
    try {
      await db.$transaction(async (tx) => {
        // Orden FK-seguro: businessOperation/auditEvent referencian al actor
        // (User) con Restrict, así que van antes que user. VerificationCode,
        // DeviceModel, Notification y NotificationRead caen por Cascade.
        await tx.businessOperation.deleteMany({ where: { businessId: business.id } })
        await tx.auditEvent.deleteMany({ where: { businessId: business.id } })
        await tx.pushSubscription.deleteMany({ where: { businessId: business.id } })
        await tx.settings.deleteMany({ where: { businessId: business.id } })
        await tx.systemSettings.deleteMany({ where: { businessId: business.id } })
        await tx.workshopService.deleteMany({ where: { businessId: business.id } })
        await tx.user.deleteMany({ where: { businessId: business.id } })
        await tx.branch.deleteMany({ where: { businessId: business.id } })
        // Bitácora de plataforma: la purga automática también deja rastro
        // (PlatformEvent no tiene FK — sobrevive al borrado del tenant).
        await tx.platformEvent.create({
          data: {
            businessId: business.id,
            businessSlug: business.slug,
            businessName: business.name,
            kind: "TENANT_DELETED",
            actorId: "cron:purge-pending-signups",
            detail: { automatic: true, pendingDays: days },
          },
        })
        await tx.business.delete({ where: { id: business.id } })
      })
      tenants.push(business.slug)
      console.warn(`[purge-pending-signups] tenant purgado: ${business.slug} (alta PENDING de ${days}+d)`)
    } catch (error) {
      if (isFkViolation(error)) {
        // Fila Restrict residual no contemplada: se omite y se reporta.
        console.warn(`[purge-pending-signups] ${business.slug}: filas vinculadas residuales, se omite`)
        skipped.push({ slug: business.slug, reason: "filas vinculadas residuales (Restrict)" })
      } else {
        console.error(`[purge-pending-signups] error purgando ${business.slug}:`, error)
        skipped.push({ slug: business.slug, reason: "error inesperado" })
      }
    }
  }

  return { purged: tenants.length, skipped, tenants }
}
