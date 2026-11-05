import { describe, expect, it } from "vitest"
import {
  LEGACY_NOTIFICATION_KEYS,
  notificationClearedKey,
  notificationScope,
  notificationStorageKey,
} from "@/lib/notification-cache"

// El caché local de la campana se segmenta por businessId+userId para que el
// feed de un negocio nunca reaparezca dentro del panel de otro al cambiar de
// cuenta o entrar en modo soporte desde /platform.
describe("notificationScope", () => {
  it("combina businessId y userId", () => {
    expect(notificationScope("biz-1", "user-1")).toBe("biz-1:user-1")
  })

  it("sin usuario autenticado no hay scope (no se cachea)", () => {
    expect(notificationScope("biz-1", null)).toBeNull()
    expect(notificationScope("biz-1", undefined)).toBeNull()
    expect(notificationScope(null, null)).toBeNull()
  })

  it("scopes de negocios distintos producen claves distintas", () => {
    const a = notificationStorageKey(notificationScope("prosolutions", "u1")!)
    const b = notificationStorageKey(notificationScope("citymovil", "u2")!)
    expect(a).not.toBe(b)
  })

  it("mismo negocio pero usuarios distintos tampoco comparten caché", () => {
    const a = notificationStorageKey(notificationScope("biz", "u1")!)
    const b = notificationStorageKey(notificationScope("biz", "u2")!)
    expect(a).not.toBe(b)
  })

  it("las claves scoped son distintas de las legacy globales", () => {
    const scope = notificationScope("biz", "u1")!
    expect(LEGACY_NOTIFICATION_KEYS).not.toContain(notificationStorageKey(scope))
    expect(LEGACY_NOTIFICATION_KEYS).not.toContain(notificationClearedKey(scope))
    expect(notificationClearedKey(scope)).not.toBe(notificationStorageKey(scope))
  })
})
