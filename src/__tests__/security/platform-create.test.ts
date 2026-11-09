import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  businessFindUnique: vi.fn(),
  businessCreate: vi.fn(),
  branchCreate: vi.fn(),
  branchFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  systemSettingsCreate: vi.fn(),
  workshopServiceCreateMany: vi.fn(),
  platformEventCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: {
      findUnique: mocks.businessFindUnique,
      create: mocks.businessCreate,
    },
    branch: {
      create: mocks.branchCreate,
      findFirst: mocks.branchFindFirst,
    },
    user: {
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
    },
    systemSettings: {
      create: mocks.systemSettingsCreate,
    },
    workshopService: {
      createMany: mocks.workshopServiceCreateMany,
    },
    platformEvent: {
      create: mocks.platformEventCreate,
    },
    $transaction: mocks.transaction,
  },
}))

import { POST as createBusiness } from "@/app/api/platform/businesses/route"
import { POST as createBusinessUser } from "@/app/api/platform/businesses/[id]/users/route"

const superAdmin = {
  user: {
    id: "op-1",
    email: "admin@reficio.app",
    role: "ADMIN",
    status: "APPROVED",
    businessId: "biz-reficio-hq",
    isSuperAdmin: true,
  },
}

describe("POST /api/platform/businesses & /api/platform/businesses/[id]/users", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(superAdmin)
    mocks.transaction.mockImplementation((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => Promise<unknown>)({
            business: { create: mocks.businessCreate },
            branch: { create: mocks.branchCreate },
            user: { create: mocks.userCreate },
            systemSettings: { create: mocks.systemSettingsCreate },
            workshopService: { createMany: mocks.workshopServiceCreateMany },
            platformEvent: { create: mocks.platformEventCreate },
          }),
    )
    mocks.businessFindUnique.mockResolvedValue(null)
    mocks.userFindUnique.mockResolvedValue(null)
    mocks.businessCreate.mockResolvedValue({ id: "biz-new", name: "Taller Norte", slug: "taller-norte" })
    mocks.branchCreate.mockResolvedValue({ id: "br-new" })
    mocks.branchFindFirst.mockResolvedValue({ id: "br-1" })
    mocks.userCreate.mockResolvedValue({ id: "u-new", name: "Carlos", email: "carlos@norte.mx", role: "ADMIN", status: "APPROVED" })
    mocks.systemSettingsCreate.mockResolvedValue({})
    mocks.workshopServiceCreateMany.mockResolvedValue({ count: 5 })
    mocks.platformEventCreate.mockResolvedValue({ id: "ev-1" })
  })

  it("crea un nuevo negocio, sucursal principal, usuario ADMIN y evento TENANT_CREATED desde /platform", async () => {
    const res = await createBusiness(
      new Request("https://app.invalid/api/platform/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: "Taller Norte",
          slug: "taller-norte",
          businessKind: "REPAIR",
          adminName: "Carlos",
          email: "carlos@norte.mx",
          password: "PasswordSegura123",
        }),
      }),
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.business).toEqual({ id: "biz-new", name: "Taller Norte", slug: "taller-norte" })
    expect(mocks.businessCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Taller Norte",
          slug: "taller-norte",
          businessKind: "REPAIR",
        }),
      }),
    )
    expect(mocks.platformEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "TENANT_CREATED",
          businessId: "biz-new",
          detail: {
            adminEmail: "carlos@norte.mx",
            businessKind: "REPAIR",
          },
        }),
      }),
    )
  })

  it("crea un usuario aprobado dentro de una empresa existente desde /platform/[id]", async () => {
    mocks.businessFindUnique.mockResolvedValue({ id: "biz-1", name: "ProSolutions", slug: "prosolutions" })
    mocks.userCreate.mockResolvedValueOnce({
      id: "u-tech",
      name: "Nuevo Técnico",
      email: "tecnico@prosolutions.com",
      role: "EMPLOYEE",
      status: "APPROVED",
    })

    const res = await createBusinessUser(
      new Request("https://app.invalid/api/platform/businesses/biz-1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nuevo Técnico",
          email: "tecnico@prosolutions.com",
          role: "EMPLOYEE",
          jobTitle: "Técnico Senior",
          password: "PasswordSegura123",
        }),
      }),
      { params: Promise.resolve({ id: "biz-1" }) },
    )

    expect(res.status).toBe(201)
    expect(mocks.userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: "biz-1",
          name: "Nuevo Técnico",
          email: "tecnico@prosolutions.com",
          role: "EMPLOYEE",
          status: "APPROVED",
          homeBranchId: "br-1",
        }),
      }),
    )
    expect(mocks.platformEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "USER_CREATED_BY_PLATFORM",
          businessId: "biz-1",
          detail: {
            targetUserId: "u-tech",
            targetEmail: "tecnico@prosolutions.com",
            targetName: "Nuevo Técnico",
            role: "EMPLOYEE",
          },
        }),
      }),
    )
  })
})
