import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JWT } from "@auth/core/jwt"

/**
 * Integration coverage for SEC-03/SEC-07: the real NextAuth config from
 * src/lib/auth.ts is captured while next-auth, the credentials provider,
 * bcrypt and prisma are mocked. This proves the jwt callback re-reads the
 * database row on every call (so demotion/rejection/deletion/password change
 * revoke old cookies) and that authorize applies a per-account attempt limit.
 */
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  bcryptCompare: vi.fn(),
  config: undefined as {
    callbacks: { jwt: (args: { token: JWT; user?: { id: string } }) => Promise<JWT | null> }
    providers: { authorize: (credentials: unknown) => Promise<unknown> }[]
  } | undefined,
}))

vi.mock("next-auth", () => ({
  default: vi.fn((config: NonNullable<typeof mocks.config>) => {
    mocks.config = config
    return { auth: vi.fn(), handlers: { GET: vi.fn(), POST: vi.fn() }, signIn: vi.fn(), signOut: vi.fn() }
  }),
}))
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn((provider: unknown) => provider) }))
vi.mock("bcryptjs", () => ({ default: { compare: mocks.bcryptCompare } }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique, findFirst: mocks.findFirst } } }))

import "@/lib/auth"

const jwtCallback = (args: { token: JWT; user?: { id: string } }) => mocks.config!.callbacks.jwt(args)
const authorize = (credentials: unknown) => mocks.config!.providers[0].authorize(credentials)

type UserRow = {
  id: string; name: string; email: string | null; phone: string | null
  password: string | null; role: string; status: string; customerType: string
}

const adminRow: UserRow = {
  id: "admin-1", name: "Admin", email: "admin@test.invalid", phone: null,
  password: "hash-A", role: "ADMIN", status: "APPROVED", customerType: "NORMAL",
}

describe("jwt callback revalidates the database row on every call", () => {
  beforeEach(() => { vi.clearAllMocks() })

  async function signInToken(row: UserRow = adminRow): Promise<JWT> {
    mocks.findUnique.mockResolvedValueOnce(row)
    const token = await jwtCallback({ token: {} as JWT, user: { id: row.id } })
    expect(token).not.toBeNull()
    return token!
  }

  it("a demoted admin loses the role while keeping the same cookie", async () => {
    const token = await signInToken()
    mocks.findUnique.mockResolvedValueOnce({ ...adminRow, role: "CUSTOMER" })
    const refreshed = await jwtCallback({ token })
    expect(refreshed!.role).toBe("CUSTOMER")
  })

  it("rejected and deleted accounts get a null session immediately", async () => {
    const token = await signInToken()
    mocks.findUnique.mockResolvedValueOnce({ ...adminRow, status: "REJECTED" })
    expect(await jwtCallback({ token })).toBeNull()
    mocks.findUnique.mockResolvedValueOnce(null)
    expect(await jwtCallback({ token })).toBeNull()
  })

  it("a password change revokes sessions minted before it", async () => {
    const token = await signInToken()
    mocks.findUnique.mockResolvedValueOnce({ ...adminRow, password: "hash-B" })
    expect(await jwtCallback({ token })).toBeNull()
  })

  it("approving a pending account takes effect without a new login", async () => {
    const token = await signInToken({ ...adminRow, status: "PENDING" })
    expect(token.status).toBe("PENDING")
    mocks.findUnique.mockResolvedValueOnce(adminRow)
    expect((await jwtCallback({ token }))!.status).toBe("APPROVED")
  })

  it("cookies minted before the credential-version upgrade are dropped", async () => {
    mocks.findUnique.mockResolvedValueOnce(adminRow)
    expect(await jwtCallback({ token: { id: adminRow.id } as JWT })).toBeNull()
  })

  it("a token without a user id is dropped before hitting the database", async () => {
    expect(await jwtCallback({ token: {} as JWT })).toBeNull()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})

describe("authorize applies a per-account attempt limit (SEC-07)", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("stops querying the database after ten attempts for the same account", async () => {
    mocks.findFirst.mockResolvedValue(null)
    for (let i = 0; i < 10; i++) await authorize({ identifier: "victim@test.invalid", password: "wrong" })
    expect(mocks.findFirst).toHaveBeenCalledTimes(10)
    expect(await authorize({ identifier: "victim@test.invalid", password: "wrong" })).toBeNull()
    expect(mocks.findFirst).toHaveBeenCalledTimes(10)
  })

  it("case and whitespace variants of the identifier share one bucket", async () => {
    mocks.findFirst.mockResolvedValue(null)
    for (let i = 0; i < 10; i++) {
      await authorize({ identifier: i % 2 ? "VICTIM2@TEST.INVALID" : "  victim2@test.invalid ", password: "x" })
    }
    expect(await authorize({ identifier: "victim2@test.invalid", password: "x" })).toBeNull()
    expect(mocks.findFirst).toHaveBeenCalledTimes(10)
  })

  it("rejects malformed credentials and overlong passwords before bcrypt", async () => {
    await expect(authorize({ identifier: 42, password: "x" })).rejects.toThrow()
    await expect(authorize({ identifier: "a@b.c", password: "x".repeat(2000) })).rejects.toThrow()
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.bcryptCompare).not.toHaveBeenCalled()
  })

  it("rejected users cannot log in even with a valid password", async () => {
    mocks.findFirst.mockResolvedValue({ ...adminRow, status: "REJECTED" })
    mocks.bcryptCompare.mockResolvedValue(true)
    expect(await authorize({ identifier: "rejected@test.invalid", password: "secret" })).toBeNull()
  })

  it("approved credentials return the user row for the session", async () => {
    mocks.findFirst.mockResolvedValue(adminRow)
    mocks.bcryptCompare.mockResolvedValue(true)
    const user = await authorize({ identifier: "ok@test.invalid", password: "secret" })
    expect(user).toMatchObject({ id: adminRow.id, role: "ADMIN", status: "APPROVED" })
  })
})
