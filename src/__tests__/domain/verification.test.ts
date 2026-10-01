import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  consumeVerificationCode,
  issueVerificationCode,
  markVerified,
  VerificationError,
  VERIFICATION_MAX_ATTEMPTS,
  type VerificationDb,
} from "@/lib/verification"

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

type Row = {
  id: string
  userId: string | null
  businessId: string | null
  identifier: string
  channel: string
  codeHash: string
  purpose: string
  expiresAt: Date
  consumedAt: Date | null
  attempts: number
  createdAt: Date
}

/**
 * Tx falso en memoria: replica updateMany/create/findFirst/update tal como los
 * usa verification.ts, con un array de rows como "tabla".
 */
function fakeDb() {
  const rows: Row[] = []
  const users: Record<string, Record<string, unknown>> = {}
  let seq = 0
  const db: VerificationDb = {
    verificationCode: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0
        for (const row of rows) {
          if (
            row.identifier === where.identifier &&
            row.purpose === where.purpose &&
            row.consumedAt === null
          ) {
            Object.assign(row, data)
            count++
          }
        }
        return { count }
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: Row = {
          id: `vc-${++seq}`,
          userId: null,
          businessId: null,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        }
        rows.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const candidates = rows.filter(
          (row) =>
            (!where.identifier || row.identifier === where.identifier) &&
            (!where.codeHash || row.codeHash === where.codeHash) &&
            (!where.channel || row.channel === where.channel) &&
            row.purpose === where.purpose &&
            (where.consumedAt === null ? row.consumedAt === null : true),
        )
        candidates.sort((a, b) =>
          orderBy?.createdAt === "desc"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        )
        return candidates[0] ?? null
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)
        if (!row) throw new Error("row not found")
        if (data.attempts?.increment) row.attempts += data.attempts.increment
        if (data.consumedAt) row.consumedAt = data.consumedAt
        return row
      }),
      deleteMany: vi.fn(),
      findMany: vi.fn(async () => rows),
    },
    user: {
      update: vi.fn(async ({ where, data }: any) => {
        users[where.id] = { ...(users[where.id] ?? { id: where.id }), ...data }
        return users[where.id]
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0
        for (const user of Object.values(users)) {
          if (
            user.id === where.id &&
            (where.status === undefined || user.status === where.status) &&
            (where.role === undefined || user.role === where.role)
          ) {
            Object.assign(user, data)
            count++
          }
        }
        return { count }
      }),
    },
  } as unknown as VerificationDb
  return { db, rows, users }
}

describe("issueVerificationCode", () => {
  it("emite un código de 6 dígitos y persiste solo el sha256", async () => {
    const { db, rows } = fakeDb()
    const { code, expiresAt } = await issueVerificationCode(db, {
      userId: "u1",
      businessId: "b1",
      identifier: "a@b.com",
      channel: "EMAIL",
    })
    expect(code).toMatch(/^\d{6}$/)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rows).toHaveLength(1)
    expect(rows[0].codeHash).toBe(sha256(code))
    expect(rows[0].purpose).toBe("SIGNUP")
    // El código en claro jamás toca la fila.
    expect(JSON.stringify(rows[0])).not.toContain(code)
  })

  it("invalida códigos vigentes previos del mismo identifier+purpose", async () => {
    const { db, rows } = fakeDb()
    await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    const second = await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    expect(rows).toHaveLength(2)
    expect(rows[0].consumedAt).not.toBeNull()
    expect(rows[1].consumedAt).toBeNull()

    // El primero ya no se puede consumir; el segundo sí.
    await expect(
      consumeVerificationCode(db, { identifier: "a@b.com", code: "000000" }),
    ).rejects.toThrow(VerificationError)
    const consumed = await consumeVerificationCode(db, {
      identifier: "a@b.com",
      code: second.code,
    })
    expect(consumed.id).toBe(rows[1].id)
  })
})

describe("consumeVerificationCode", () => {
  it("consume el código correcto y devuelve el row con userId", async () => {
    const { db, rows } = fakeDb()
    const { code } = await issueVerificationCode(db, {
      userId: "u42",
      identifier: "5512345678",
      channel: "TELEGRAM",
    })
    const row = await consumeVerificationCode(db, { identifier: "5512345678", code })
    expect(row.userId).toBe("u42")
    expect(row.consumedAt).not.toBeNull()
    expect(rows[0].consumedAt).not.toBeNull()
  })

  it("rechaza un código incorrecto e incrementa attempts", async () => {
    const { db, rows } = fakeDb()
    await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    await expect(
      consumeVerificationCode(db, { identifier: "a@b.com", code: "999999" }),
    ).rejects.toMatchObject({ reason: "MISMATCH" })
    expect(rows[0].attempts).toBe(1)
  })

  it("bloquea cuando llega a VERIFICATION_MAX_ATTEMPTS", async () => {
    const { db, rows } = fakeDb()
    const { code } = await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    rows[0].attempts = VERIFICATION_MAX_ATTEMPTS
    await expect(
      consumeVerificationCode(db, { identifier: "a@b.com", code }),
    ).rejects.toMatchObject({ reason: "TOO_MANY_ATTEMPTS" })
    expect(rows[0].consumedAt).toBeNull()
  })

  it("rechaza un código expirado sin consumirlo", async () => {
    const { db, rows } = fakeDb()
    const { code } = await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    rows[0].expiresAt = new Date(Date.now() - 1000)
    await expect(
      consumeVerificationCode(db, { identifier: "a@b.com", code }),
    ).rejects.toMatchObject({ reason: "EXPIRED" })
    expect(rows[0].consumedAt).toBeNull()
  })

  it("falla si el identifier no tiene código vigente", async () => {
    const { db } = fakeDb()
    await expect(
      consumeVerificationCode(db, { identifier: "nadie@x.com", code: "123456" }),
    ).rejects.toMatchObject({ reason: "MISMATCH" })
  })

  it("sin identifier localiza el vigente por codeHash+canal (deep-link del bot)", async () => {
    const { db, rows } = fakeDb()
    const { code } = await issueVerificationCode(db, {
      userId: "u7",
      identifier: "5512345678",
      channel: "TELEGRAM",
    })
    const row = await consumeVerificationCode(db, { code, channel: "TELEGRAM" })
    expect(row.userId).toBe("u7")
    expect(rows[0].consumedAt).not.toBeNull()
  })

  it("sin identifier no consume códigos de otro canal", async () => {
    const { db } = fakeDb()
    const { code } = await issueVerificationCode(db, { identifier: "a@b.com", channel: "EMAIL" })
    await expect(
      consumeVerificationCode(db, { code, channel: "TELEGRAM" }),
    ).rejects.toMatchObject({ reason: "MISMATCH" })
  })
})

describe("markVerified", () => {
  it("EMAIL marca emailVerifiedAt", async () => {
    const { db, users } = fakeDb()
    await markVerified(db, "u1", "EMAIL")
    expect(users.u1.emailVerifiedAt).toBeInstanceOf(Date)
    expect(users.u1.phoneVerifiedAt).toBeUndefined()
  })

  it("PHONE marca phoneVerifiedAt", async () => {
    const { db, users } = fakeDb()
    await markVerified(db, "u1", "PHONE")
    expect(users.u1.phoneVerifiedAt).toBeInstanceOf(Date)
    expect(users.u1.emailVerifiedAt).toBeUndefined()
  })

  it("TELEGRAM marca phoneVerifiedAt", async () => {
    const { db, users } = fakeDb()
    await markVerified(db, "u1", "TELEGRAM")
    expect(users.u1.phoneVerifiedAt).toBeInstanceOf(Date)
    expect(users.u1.emailVerifiedAt).toBeUndefined()
  })

  it("promueve APPROVED al dueño auto-registrado (PENDING + ADMIN)", async () => {
    const { db, users } = fakeDb()
    users.owner = { id: "owner", status: "PENDING", role: "ADMIN" }
    await markVerified(db, "owner", "EMAIL")
    expect(users.owner.status).toBe("APPROVED")
    expect(users.owner.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it("NO promueve clientes pendientes (esperan aprobación del negocio)", async () => {
    const { db, users } = fakeDb()
    users.customer = { id: "customer", status: "PENDING", role: "CUSTOMER" }
    await markVerified(db, "customer", "EMAIL")
    expect(users.customer.status).toBe("PENDING")
    expect(users.customer.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it("no toca a quien ya está APPROVED", async () => {
    const { db, users } = fakeDb()
    users.staff = { id: "staff", status: "APPROVED", role: "EMPLOYEE" }
    await markVerified(db, "staff", "TELEGRAM")
    expect(users.staff.status).toBe("APPROVED")
  })

  it("devuelve promotedOwner con email y slug del negocio al activar al dueño", async () => {
    const { db, users } = fakeDb()
    users.owner = {
      id: "owner",
      status: "PENDING",
      role: "ADMIN",
      email: "dueno@taller.com",
      business: { name: "Taller Don José", slug: "taller-don-jose" },
    }
    const result = await markVerified(db, "owner", "EMAIL")
    expect(result.promotedOwner).toBe(true)
    expect(result.email).toBe("dueno@taller.com")
    expect(result.businessName).toBe("Taller Don José")
    expect(result.businessSlug).toBe("taller-don-jose")
  })

  it("reporta promotedOwner=false para un cliente PENDING", async () => {
    const { db, users } = fakeDb()
    users.customer = { id: "customer", status: "PENDING", role: "CUSTOMER", email: "c@x.com" }
    const result = await markVerified(db, "customer", "EMAIL")
    expect(result.promotedOwner).toBe(false)
    expect(result.email).toBeUndefined()
  })

  it("reporta promotedOwner=false si el dueño ya estaba APPROVED", async () => {
    const { db, users } = fakeDb()
    users.owner = { id: "owner", status: "APPROVED", role: "ADMIN", email: "d@x.com" }
    const result = await markVerified(db, "owner", "PHONE")
    expect(result.promotedOwner).toBe(false)
  })

  it("reporta promotedOwner=false para staff EMPLOYEE pendiente", async () => {
    const { db, users } = fakeDb()
    users.staff = { id: "staff", status: "PENDING", role: "EMPLOYEE" }
    const result = await markVerified(db, "staff", "TELEGRAM")
    expect(result.promotedOwner).toBe(false)
    expect(users.staff.status).toBe("PENDING")
  })
})
