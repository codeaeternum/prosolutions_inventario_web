import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alertas Telegram de actividad sensible (lib/audit-alerts): complemento del
 * AuditEvent — avisa a los ADMIN del negocio cuando un NO-admin toca algo
 * que mueve dinero o accesos. Best-effort total (nunca lanza) y anti-spam de
 * 60 s por negocio+actor+acción.
 */

const mocks = vi.hoisted(() => ({
  sendTelegramToUsers: vi.fn(),
  userFindUnique: vi.fn(),
}))

// lib/audit-alerts los importa perezoso (await import); el mock aplica igual.
vi.mock("@/lib/telegram", () => ({ sendTelegramToUsers: mocks.sendTelegramToUsers }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }))

type AuditAlertsModule = typeof import("@/lib/audit-alerts")
type AlertEntry = Parameters<AuditAlertsModule["alertSensitiveAudit"]>[0]

let mod: AuditAlertsModule
const alertSensitiveAudit = (entry: AlertEntry) => mod.alertSensitiveAudit(entry)

const entry = (over: Partial<AlertEntry> = {}): AlertEntry => ({
  businessId: "biz-1",
  actorId: "kevin-1",
  action: "PRODUCT_UPDATE",
  entityName: "Pantalla iPhone 11",
  summary: "Precio $500.00 → $450.00",
  changes: { precio: { before: 500, after: 450 } },
  ...over,
})

const sentMessage = () => mocks.sendTelegramToUsers.mock.calls[0]?.[1] as string

beforeEach(async () => {
  // El throttle vive en memoria del módulo: reimportarlo por test lo reinicia.
  vi.resetModules()
  vi.clearAllMocks()
  mod = await import("@/lib/audit-alerts")
  mocks.userFindUnique.mockResolvedValue({ role: "EMPLOYEE", name: "Kevin" })
  mocks.sendTelegramToUsers.mockResolvedValue(1)
})

describe("ALERTED_ACTIONS", () => {
  it("expone exactamente las acciones sensibles", () => {
    expect([...mod.ALERTED_ACTIONS].sort()).toEqual([
      "CUSTOMER_UPDATE",
      "PRODUCT_DELETE",
      "PRODUCT_IMPORT",
      "PRODUCT_UPDATE",
      "SETTINGS_UPDATE",
      "SUPPLIER_DELETE",
      "USER_CREATE",
      "USER_DELETE",
      "USER_UPDATE",
    ])
  })
})

describe("filtro de acciones y actor", () => {
  it("NO alerta acciones no listadas (ni consulta al actor)", async () => {
    await alertSensitiveAudit(entry({ action: "BRANCH_CREATE" }))
    await alertSensitiveAudit(entry({ action: "SUPPLIER_UPDATE" }))
    await alertSensitiveAudit(entry({ action: "PRODUCT_CREATE" }))
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("alerta cada acción listada sin condición extra", async () => {
    const actions = [
      "PRODUCT_DELETE",
      "PRODUCT_IMPORT",
      "USER_CREATE",
      "USER_UPDATE",
      "USER_DELETE",
      "CUSTOMER_UPDATE",
      "SETTINGS_UPDATE",
      "SUPPLIER_DELETE",
    ]
    for (const [i, action] of actions.entries()) {
      await alertSensitiveAudit(entry({ action, changes: undefined }))
      expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(i + 1)
    }
  })

  it("NO alerta cuando el actor es ADMIN (el dueño ya sabe lo que hizo)", async () => {
    mocks.userFindUnique.mockResolvedValue({ role: "ADMIN", name: "Diego" })
    await alertSensitiveAudit(entry())
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("NO alerta cuando el actor no existe en el tenant", async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    await alertSensitiveAudit(entry())
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })

  it("consulta el rol del actor acotado al negocio", async () => {
    await alertSensitiveAudit(entry())
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "kevin-1", businessId: "biz-1" },
      select: { role: true, name: true },
    })
  })
})

describe("PRODUCT_UPDATE solo si tocó precio", () => {
  it("alerta a un EMPLOYEE que cambió el precio (diff con precio)", async () => {
    await alertSensitiveAudit(entry())
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledWith(
      "biz-1",
      expect.stringContaining("Actividad sensible"),
      { role: "ADMIN" },
    )
  })

  it("también cuenta mayoreo y costo como cambio de dinero", async () => {
    await alertSensitiveAudit(
      entry({ summary: "Mayoreo $300.00 → $280.00", changes: { mayoreo: { before: 300, after: 280 } } }),
    )
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
    await alertSensitiveAudit(
      entry({ action: "PRODUCT_UPDATE", actorId: "otro-1", summary: "Costo $200.00 → $210.00", changes: { costo: { before: 200, after: 210 } } }),
    )
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(2)
  })

  it("detecta el cambio de precio por summary aunque no haya diff", async () => {
    await alertSensitiveAudit(entry({ changes: undefined }))
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
  })

  it("NO alerta un PRODUCT_UPDATE sin cambio de precio", async () => {
    await alertSensitiveAudit(
      entry({ summary: "Stock 3 → 5", changes: { stock: { before: 3, after: 5 } } }),
    )
    await alertSensitiveAudit(
      entry({ actorId: "otro-1", summary: "Editó el producto", changes: undefined }),
    )
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
  })
})

describe("mensaje", () => {
  it("lleva nombre del actor, resumen, entidad y fecha MX", async () => {
    await alertSensitiveAudit(entry())
    const msg = sentMessage()
    expect(msg).toContain("⚠️ <b>Actividad sensible</b>")
    expect(msg).toContain("<b>Kevin</b> Precio $500.00 → $450.00")
    expect(msg).toContain("Pantalla iPhone 11")
    expect(msg).toMatch(/🕒 \d{2}\/\d{2}\/\d{2}/)
  })

  it("omite la línea de entidad cuando no hay entityName", async () => {
    await alertSensitiveAudit(entry({ entityName: undefined }))
    expect(sentMessage()).not.toContain("📌")
  })

  it("escapa HTML en los valores que vienen del usuario", async () => {
    mocks.userFindUnique.mockResolvedValue({ role: "EMPLOYEE", name: 'Kev <script>alert("x")</script>' })
    await alertSensitiveAudit(
      entry({
        entityName: "Pantalla <b>& rota",
        summary: 'Precio <i>$500</i> → "$450" & más',
      }),
    )
    const msg = sentMessage()
    expect(msg).toContain('Kev &lt;script&gt;alert("x")&lt;/script&gt;')
    expect(msg).toContain("Pantalla &lt;b&gt;&amp; rota")
    expect(msg).toContain('Precio &lt;i&gt;$500&lt;/i&gt; → "$450" &amp; más')
    expect(msg).not.toContain("<script>")
  })
})

describe("anti-spam (throttle 60 s)", () => {
  it("la segunda acción igual en <60s no vuelve a avisar ni consulta", async () => {
    await alertSensitiveAudit(entry())
    await alertSensitiveAudit(entry())
    await alertSensitiveAudit(entry())
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(1)
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1)
  })

  it("otra acción u otro actor del mismo negocio sí avisan", async () => {
    await alertSensitiveAudit(entry())
    await alertSensitiveAudit(entry({ action: "PRODUCT_DELETE" }))
    await alertSensitiveAudit(entry({ actorId: "luis-1" }))
    expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(3)
  })

  it("pasados 60 s el mismo actor vuelve a avisar", async () => {
    vi.useFakeTimers()
    try {
      await alertSensitiveAudit(entry())
      vi.advanceTimersByTime(61 * 1000)
      await alertSensitiveAudit(entry())
      expect(mocks.sendTelegramToUsers).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("best-effort", () => {
  it("NUNCA lanza: un fallo de Telegram solo se loguea", async () => {
    mocks.sendTelegramToUsers.mockRejectedValue(new Error("telegram caído"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(alertSensitiveAudit(entry())).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("NUNCA lanza: un fallo al leer el actor solo se loguea", async () => {
    mocks.userFindUnique.mockRejectedValue(new Error("db caída"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(alertSensitiveAudit(entry())).resolves.toBeUndefined()
    expect(mocks.sendTelegramToUsers).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
