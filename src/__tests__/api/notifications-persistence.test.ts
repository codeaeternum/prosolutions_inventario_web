import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Persistencia de notificaciones in-app:
 *  a) broadcast() (stream/route) guarda la fila ANTES de emitir el SSE y un
 *     fallo de BD solo se loguea — el evento en vivo sigue saliendo.
 *  b) GET /api/notifications filtra por businessId + audiencia del rol y
 *     traduce NotificationRead a `read` por usuario.
 *  c) POST /api/notifications/read solo marca filas del tenant y respeta la
 *     audiencia de EMPLOYEE (jamás toca notificaciones "ADMIN").
 *
 * Prisma y la sesión se mockean como en api/activity.test.ts.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  notifCreate: vi.fn(),
  notifFindMany: vi.fn(),
  notifCount: vi.fn(),
  readCreateMany: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: mocks.notifCreate,
      findMany: mocks.notifFindMany,
      count: mocks.notifCount,
    },
    notificationRead: { createMany: mocks.readCreateMany },
    user: { findUnique: mocks.userFindUnique },
  },
}))

import { GET as listNotifications } from "@/app/api/notifications/route"
import { POST as markRead } from "@/app/api/notifications/read/route"
import {
  GET as openStream,
  sendNotificationToAdmins,
  sendNotificationToStaff,
} from "@/app/api/notifications/stream/route"

const session = (id: string, role = "ADMIN", status = "APPROVED") => ({
  user: { id, role, status, businessId: "biz-test" },
})

const post = (body: unknown) =>
  markRead(
    new NextRequest("https://app.invalid/api/notifications/read", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  )

const row = (over: Record<string, unknown> = {}) => ({
  id: "notif-1",
  businessId: "biz-test",
  type: "low_stock",
  audience: "STAFF",
  title: "Stock bajo",
  message: "2 productos bajo mínimo",
  data: { products: [{ id: "p-1", name: "Pantalla", stock: 0, minStock: 1 }] },
  createdAt: new Date("2025-06-10T18:00:00Z"),
  reads: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.notifCreate.mockResolvedValue({ id: "notif-db-1" })
  mocks.notifFindMany.mockResolvedValue([])
  mocks.notifCount.mockResolvedValue(0)
  mocks.readCreateMany.mockResolvedValue({ count: 0 })
  mocks.userFindUnique.mockResolvedValue({
    role: "ADMIN",
    status: "APPROVED",
    password: "pw",
    businessId: "biz-test",
    business: { isActive: true },
  })
})

describe("broadcast — persistencia", () => {
  it("persiste la fila del tenant con audience STAFF antes de emitir", async () => {
    await sendNotificationToStaff(
      { type: "low_stock", title: "Stock bajo", message: "Falta pantalla", data: { products: [] } },
      "biz-test",
    )
    expect(mocks.notifCreate).toHaveBeenCalledTimes(1)
    const data = mocks.notifCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      businessId: "biz-test",
      type: "low_stock",
      audience: "STAFF",
      title: "Stock bajo",
      message: "Falta pantalla",
    })
  })

  it("sendNotificationToAdmins persiste audience ADMIN", async () => {
    await sendNotificationToAdmins(
      { type: "user_registered", title: "Nueva cuenta", message: "Ana solicita cuenta" },
      "biz-test",
    )
    expect(mocks.notifCreate.mock.calls[0][0].data.audience).toBe("ADMIN")
  })

  it("depura PII de data al persistir (email/phone/token no van a la BD)", async () => {
    await sendNotificationToAdmins(
      {
        type: "user_registered",
        title: "Nueva cuenta",
        message: "Ana solicita cuenta",
        data: { userId: "u-1", name: "Ana", email: "ana@x.com", phone: "5512345678", requestedType: "NORMAL" },
      },
      "biz-test",
    )
    const data = mocks.notifCreate.mock.calls[0][0].data.data
    expect(data).toMatchObject({ userId: "u-1", name: "Ana", requestedType: "NORMAL" })
    expect(data.email).toBeUndefined()
    expect(data.phone).toBeUndefined()
  })

  it("un fallo de BD NO rompe el broadcast ni propaga excepción", async () => {
    mocks.notifCreate.mockRejectedValue(new Error("db caída"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test"),
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("el SSE emitido lleva el id de la fila persistida (dedupe del cliente)", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    const res = await openStream(new NextRequest("https://app.invalid/api/notifications/stream"))
    const reader = res.body!.getReader()
    try {
      await reader.read() // evento "connected"
      await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
      const chunk = new TextDecoder().decode((await reader.read()).value)
      const payload = JSON.parse(chunk.replace(/^data: /, "").trim())
      expect(payload.id).toBe("notif-db-1")
      expect(payload.type).toBe("low_stock")
    } finally {
      await reader.cancel()
    }
  })

  it("si la persistencia falla el SSE sale igual, sin id", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifCreate.mockRejectedValue(new Error("db caída"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await openStream(new NextRequest("https://app.invalid/api/notifications/stream"))
    const reader = res.body!.getReader()
    try {
      await reader.read() // "connected"
      await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
      const chunk = new TextDecoder().decode((await reader.read()).value)
      const payload = JSON.parse(chunk.replace(/^data: /, "").trim())
      expect(payload.type).toBe("low_stock")
      expect(payload.id).toBeUndefined()
    } finally {
      await reader.cancel()
      spy.mockRestore()
    }
  })
})

describe("broadcast — destinatarios", () => {
  /** read() pendiente = la conexión sigue abierta; done = la cerraron. */
  const pendingOrClosed = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
    Promise.race([
      reader.read().then(r => (r.done ? "closed" : "chunk")),
      new Promise<string>(resolve => setTimeout(() => resolve("pending"), 60)),
    ])

  it("NO cierra ni revalida una conexión de OTRO tenant", async () => {
    // La sesión foránea abre su stream con businessId de otro negocio.
    mocks.auth.mockResolvedValue({ user: { id: "u-ext", role: "ADMIN", status: "APPROVED", businessId: "biz-otro" } })
    const res = await openStream(new NextRequest("https://app.invalid/api/notifications/stream"))
    const reader = res.body!.getReader()
    try {
      await reader.read() // "connected"
      mocks.userFindUnique.mockClear()
      await sendNotificationToStaff({ type: "low_stock", title: "t", message: "m" }, "biz-test")
      // Antes el broadcast cerraba a TODOS los no-destinatarios y les pegaba
      // el stillAuthorized(); ahora ni siquiera los recorre.
      expect(mocks.userFindUnique).not.toHaveBeenCalled()
      expect(await pendingOrClosed(reader)).toBe("pending")
    } finally {
      await reader.cancel()
    }
  })

  it("NO cierra a un EMPLOYEE del tenant cuando el broadcast es solo para admins", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    mocks.userFindUnique.mockResolvedValue({
      role: "EMPLOYEE", status: "APPROVED", password: "pw", businessId: "biz-test", business: { isActive: true },
    })
    const res = await openStream(new NextRequest("https://app.invalid/api/notifications/stream"))
    const reader = res.body!.getReader()
    try {
      await reader.read() // "connected"
      mocks.userFindUnique.mockClear()
      await sendNotificationToAdmins({ type: "sensitive_alert", title: "t", message: "m" }, "biz-test")
      expect(mocks.userFindUnique).not.toHaveBeenCalled() // no-destinatario: sin revalidación
      expect(await pendingOrClosed(reader)).toBe("pending")
    } finally {
      await reader.cancel()
    }
  })

  it("SÍ cierra al destinatario que ya no está autorizado (password cambió)", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    const res = await openStream(new NextRequest("https://app.invalid/api/notifications/stream"))
    const reader = res.body!.getReader()
    try {
      await reader.read() // "connected"
      // La revalidación del destinatario falla: la sesión quedó vieja.
      mocks.userFindUnique.mockResolvedValue({
        role: "ADMIN", status: "APPROVED", password: "cambió", businessId: "biz-test", business: { isActive: true },
      })
      await sendNotificationToAdmins({ type: "sensitive_alert", title: "t", message: "m" }, "biz-test")
      expect((await reader.read()).done).toBe(true)
    } finally {
      await reader.cancel()
    }
  })
})

describe("GET /api/notifications", () => {
  it("rechaza sin sesión o sin rol de staff", async () => {
    for (const s of [null, session("c", "CUSTOMER"), session("p", "ADMIN", "PENDING")]) {
      mocks.auth.mockResolvedValue(s)
      const res = await listNotifications()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.notifFindMany).not.toHaveBeenCalled()
  })

  it("ADMIN ve todo el negocio; EMPLOYEE solo audience STAFF", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    await listNotifications()
    expect(mocks.notifFindMany.mock.calls[0][0].where).toMatchObject({ businessId: "biz-test" })
    expect(mocks.notifFindMany.mock.calls[0][0].where.audience).toBeUndefined()

    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    await listNotifications()
    expect(mocks.notifFindMany.mock.calls[1][0].where).toMatchObject({ businessId: "biz-test", audience: "STAFF" })
    expect(mocks.notifCount.mock.calls[1][0].where).toMatchObject({ businessId: "biz-test", audience: "STAFF" })
  })

  it("devuelve read por usuario, timestamp ISO y unreadCount", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifFindMany.mockResolvedValue([
      row({ id: "n-1", reads: [{ notificationId: "n-1" }] }),
      row({ id: "n-2", type: "repair_ready", reads: [] }),
    ])
    mocks.notifCount.mockResolvedValue(3)

    const res = await listNotifications()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unreadCount).toBe(3)
    expect(body.notifications).toHaveLength(2)
    expect(body.notifications[0]).toMatchObject({
      id: "n-1",
      type: "low_stock",
      read: true,
      timestamp: "2025-06-10T18:00:00.000Z",
    })
    expect(body.notifications[1].read).toBe(false)
    // El read-flag se consultó con el userId de la sesión.
    expect(mocks.notifFindMany.mock.calls[0][0].select.reads.where).toEqual({ userId: "admin-1" })
    // unreadCount solo cuenta las visibles sin leer por ESTE usuario.
    expect(mocks.notifCount.mock.calls[0][0].where.reads).toEqual({ none: { userId: "admin-1" } })
  })
})

describe("POST /api/notifications/read", () => {
  it("rechaza sin sesión y sin body válido", async () => {
    const res = await post({})
    expect(res.status).toBe(401)

    mocks.auth.mockResolvedValue(session("admin-1"))
    expect((await post({})).status).toBe(400)
    expect((await post({ ids: "no-array" })).status).toBe(400)
    expect(mocks.readCreateMany).not.toHaveBeenCalled()
  })

  it("ids: re-filtra contra el tenant antes de marcar (no confía en el body)", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifFindMany.mockResolvedValue([{ id: "n-1" }]) // la otra era de otro tenant

    const res = await post({ ids: ["n-1", "n-de-otro-tenant"] })
    expect(res.status).toBe(200)

    const where = mocks.notifFindMany.mock.calls[0][0].where
    expect(where.businessId).toBe("biz-test")
    expect(where.id).toEqual({ in: ["n-1", "n-de-otro-tenant"] })
    expect(mocks.readCreateMany).toHaveBeenCalledWith({
      data: [{ notificationId: "n-1", userId: "admin-1" }],
      skipDuplicates: true,
    })
  })

  it("all: true marca solo las visibles aún no leídas", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifFindMany.mockResolvedValue([{ id: "n-1" }, { id: "n-2" }])

    await post({ all: true })
    const where = mocks.notifFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ businessId: "biz-test", reads: { none: { userId: "admin-1" } } })
    expect(where.id).toBeUndefined()
    expect(mocks.readCreateMany.mock.calls[0][0].data).toHaveLength(2)
  })

  it("EMPLOYEE solo marca audience STAFF (jamás notificaciones ADMIN)", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    mocks.notifFindMany.mockResolvedValue([])

    await post({ all: true })
    const where = mocks.notifFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ businessId: "biz-test", audience: "STAFF" })
  })

  it("devuelve el unreadCount recalculado del servidor", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifCount.mockResolvedValue(7)
    const body = await (await post({ ids: ["n-1"] })).json()
    expect(body).toEqual({ ok: true, unreadCount: 7 })
  })

  it("sin objetos válidos no escribe pero responde ok", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.notifFindMany.mockResolvedValue([])
    const res = await post({ ids: ["n-x"] })
    expect(res.status).toBe(200)
    expect(mocks.readCreateMany).not.toHaveBeenCalled()
  })
})
