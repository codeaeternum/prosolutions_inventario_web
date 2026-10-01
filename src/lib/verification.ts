import { createHash, randomInt } from "node:crypto"
import type { PrismaClient, VerificationChannel, VerificationCode } from "@prisma/client"

/**
 * Verificación de contacto post-registro (correo/teléfono/Telegram).
 *
 * El código de 6 dígitos SOLO existe en claro dentro de issueVerificationCode:
 * sale por el canal de entrega (correo Resend o deep-link de Telegram) y aquí
 * únicamente persiste su hash SHA-256. No bloquea el acceso — la aprobación
 * del admin ya existe; es una señal de confianza y habilita notificaciones.
 */

export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000
export const VERIFICATION_MAX_ATTEMPTS = 5
export const VERIFICATION_DEFAULT_PURPOSE = "SIGNUP"

/** Subconjunto de PrismaClient que necesita este módulo (sirve para tx y fakes). */
export type VerificationDb = Pick<PrismaClient, "verificationCode" | "user">

export type VerificationFailure = "NOT_FOUND" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "MISMATCH"

export class VerificationError extends Error {
  constructor(
    public readonly reason: VerificationFailure,
    message: string,
  ) {
    super(message)
    this.name = "VerificationError"
  }
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex")
}

/**
 * Emite un código de 6 dígitos para `identifier` (correo o teléfono).
 * Invalida (marca consumedAt) cualquier código vigente previo del mismo
 * identifier+purpose, sin importar el canal: solo un código activo a la vez.
 * Devuelve { code, expiresAt }; `code` nunca se guarda en claro.
 */
export async function issueVerificationCode(
  db: VerificationDb,
  input: {
    userId?: string | null
    businessId?: string | null
    identifier: string
    channel: VerificationChannel
    purpose?: string
  },
): Promise<{ code: string; expiresAt: Date }> {
  const purpose = input.purpose ?? VERIFICATION_DEFAULT_PURPOSE
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0")
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MS)

  await db.verificationCode.updateMany({
    where: { identifier: input.identifier, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  await db.verificationCode.create({
    data: {
      userId: input.userId ?? null,
      businessId: input.businessId ?? null,
      identifier: input.identifier,
      channel: input.channel,
      codeHash: hashCode(code),
      purpose,
      expiresAt,
    },
  })
  return { code, expiresAt }
}

/**
 * Consume un código vigente.
 * - Con `identifier` (formulario web): toma el código vigente del
 *   identifier+purpose y compara hashes; en fallo incrementa `attempts`.
 * - Sin `identifier` (deep-link del bot, canal TELEGRAM): localiza el vigente
 *   por codeHash — el link ya porta el código, no hay nada que teclear.
 * Devuelve el row (con userId) ya marcado como consumido.
 */
export async function consumeVerificationCode(
  db: VerificationDb,
  input: {
    identifier?: string
    code: string
    channel?: VerificationChannel
    purpose?: string
  },
): Promise<VerificationCode> {
  const purpose = input.purpose ?? VERIFICATION_DEFAULT_PURPOSE
  const code = input.code.trim()
  const digest = hashCode(code)

  const row = input.identifier
    ? await db.verificationCode.findFirst({
        where: { identifier: input.identifier, purpose, consumedAt: null },
        orderBy: { createdAt: "desc" },
      })
    : await db.verificationCode.findFirst({
        where: {
          codeHash: digest,
          purpose,
          consumedAt: null,
          ...(input.channel ? { channel: input.channel } : {}),
        },
        orderBy: { createdAt: "desc" },
      })

  if (!row) {
    throw new VerificationError("MISMATCH", "Código incorrecto o ya utilizado")
  }
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    throw new VerificationError("TOO_MANY_ATTEMPTS", "Demasiados intentos con este código")
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new VerificationError("EXPIRED", "El código expiró")
  }
  // En la ruta sin identifier el codeHash ya empataba en el where.
  if (input.identifier && row.codeHash !== digest) {
    await db.verificationCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    })
    throw new VerificationError("MISMATCH", "Código incorrecto")
  }

  const consumedAt = new Date()
  const consumed = await db.verificationCode.update({
    where: { id: row.id },
    data: { consumedAt },
  })
  return consumed ?? { ...row, consumedAt }
}

/** Resultado de markVerified: indica si la verificación promovió a un dueño. */
export type MarkVerifiedResult = {
  /** true solo cuando un PENDING+ADMIN pasó a APPROVED en esta llamada. */
  promotedOwner: boolean
  /** Datos para el correo de bienvenida; solo vienen si promotedOwner. */
  email?: string | null
  businessName?: string | null
  businessSlug?: string | null
}

/**
 * Marca el contacto verificado en el usuario. EMAIL → emailVerifiedAt;
 * PHONE y TELEGRAM → phoneVerifiedAt (el deep-link de Telegram verifica el
 * teléfono registrado y de paso liga el telegramId desde el bot).
 * Devuelve { promotedOwner, ... } para que el caller dispare el correo de
 * bienvenida solo cuando esta verificación activó la cuenta de un dueño.
 */
export async function markVerified(
  db: VerificationDb,
  userId: string,
  channel: VerificationChannel,
): Promise<MarkVerifiedResult> {
  const field = channel === "EMAIL" ? "emailVerifiedAt" : "phoneVerifiedAt"
  const updated = await db.user.update({
    where: { id: userId },
    data: { [field]: new Date() },
    select: { email: true, business: { select: { name: true, slug: true } } },
  })
  // Dueño auto-registrado (/api/signup): demostrar un canal de contacto real
  // activa su negocio. PENDING+ADMIN solo existe por ese alta; los clientes
  // PENDING siguen esperando aprobación del admin de su negocio.
  const promoted = await db.user.updateMany({
    where: { id: userId, status: "PENDING", role: "ADMIN" },
    data: { status: "APPROVED" },
  })
  if (promoted.count === 0) return { promotedOwner: false }
  return {
    promotedOwner: true,
    email: updated.email,
    businessName: updated.business?.name ?? null,
    businessSlug: updated.business?.slug ?? null,
  }
}
