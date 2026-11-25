import { afterEach, describe, expect, it, vi } from "vitest"
import { checkAndRecord, checkOnly, getClientIp, getRateLimitStats, loginAttemptAllowed, recordFailure, recordLoginFailure } from "@/lib/rate-limit"
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
describe("login throttling", () => {
  it("does not trust user supplied forwarding headers on desktop/direct access", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } }))).toBe("direct-clients")
  })
  it("trusts only explicitly configured overwritten real IP and validates it", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-real-ip": "5.6.7.8", "x-forwarded-for": "attacker" } }))).toBe("5.6.7.8")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-real-ip": "random" } }))).toBe("unknown")
  })
  it("prefers CF-Connecting-IP behind Cloudflare Tunnel, then first X-Forwarded-For", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    // cloudflared escribe CF-Connecting-IP + X-Forwarded-For; nunca X-Real-IP.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.1.1.1", "x-real-ip": "10.2.2.2" },
    }))).toBe("203.0.113.9")
    // Sin CF-Connecting-IP cae al primer IP de X-Forwarded-For.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "x-forwarded-for": "198.51.100.7, 172.16.0.1, 10.0.0.1", "x-real-ip": "10.2.2.2" },
    }))).toBe("198.51.100.7")
    // CF-Connecting-IP inválido no cuenta: se sigue la cadena de fallbacks.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "forjado", "x-forwarded-for": "198.51.100.8" },
    }))).toBe("198.51.100.8")
    // IPv6 también se acepta como IP válida.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "2001:db8::1" },
    }))).toBe("2001:db8::1")
  })
  it("blocks exhausted account keys and expires the window", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
  })
  it("fails open under saturation: a full store evicts the oldest instead of blocking login", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    // Llenar el mapa hasta MAX_KEYS (10000) con llaves vivas de un solo prefijo.
    for (let i = 0; i < 10000; i++) {
      expect(checkAndRecord("flood", `attacker-${i}`, 60_000, 5)).toBe(true)
    }
    // Con el mapa lleno, una llave NUEVA (otro usuario) no debe recibir false:
    // la víctima no paga el flood del atacante.
    expect(checkAndRecord("login", "victima-legitima", 60_000, 5)).toBe(true)
    // La evicción es por lote: entran varias llaves nuevas sin quedarse a medias.
    expect(checkAndRecord("register", "otro-usuario", 60_000, 5)).toBe(true)
  })
  it("counts denied requests per scope for observability", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const before = getRateLimitStats()
    const key = `deny-${Math.random()}`
    expect(checkAndRecord(key, "op", 60_000, 1)).toBe(true)
    expect(checkAndRecord(key, "op", 60_000, 1)).toBe(false)
    expect(checkAndRecord(key, "op", 60_000, 1)).toBe(false)
    const stats = getRateLimitStats()
    expect(stats.deniedLast24h).toBe(before.deniedLast24h + 2)
    expect(stats.byRoute[key]).toBe(2)
  })
  it("drops denied entries older than 24h from the stats", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const key = `stale-${Math.random()}`
    expect(checkAndRecord(key, "op", 60_000, 1)).toBe(true)
    expect(checkAndRecord(key, "op", 60_000, 1)).toBe(false)
    // Fuera de la ventana de 24 h el scope desaparece del desglose.
    vi.advanceTimersByTime(25 * 60 * 60 * 1000)
    expect(getRateLimitStats().byRoute[key]).toBeUndefined()
  })
  it("checkOnly does not consume attempts until recordFailure reaches maxAttempts", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    for (let i = 0; i < 5; i++) {
      expect(checkOnly("login-account", "u@test.mx", 2)).toBe(true)
    }
    recordFailure("login-account", "u@test.mx", 1000)
    expect(checkOnly("login-account", "u@test.mx", 2)).toBe(true)
    recordFailure("login-account", "u@test.mx", 1000)
    expect(checkOnly("login-account", "u@test.mx", 2)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkOnly("login-account", "u@test.mx", 2)).toBe(true)
  })
})

describe("anti-evicción de scopes críticos (S4)", () => {
  // El store vive en el módulo y lo comparten todos los tests del archivo:
  // para llenar el mapa con contenido controlado se reimporta fresco.
  const freshRateLimit = async () => {
    vi.resetModules()
    return await import("@/lib/rate-limit")
  }

  it("un flood de llaves no críticas NO evicta los bloqueos de login", async () => {
    const rl = await freshRateLimit()
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const victim = `flood-victim-${Math.random()}@test.mx`
    // La víctima queda bloqueada en el par (6.6.6.6, victim) antes del flood.
    for (let i = 0; i < 10; i++) rl.recordLoginFailure("6.6.6.6", victim)
    expect(rl.loginAttemptAllowed("6.6.6.6", victim)).toBe(false)
    // El atacante siembra llaves basura no críticas hasta llenar el mapa:
    // antes de la protección, la evicción de "las más viejas" se llevaba el
    // bloqueo de login (fail-open). Ahora las llaves login-* son intocables.
    for (let i = 0; i < 10000; i++) {
      rl.checkAndRecord("flood-nc", `semilla-${i}`, 60_000, 5)
    }
    expect(rl.loginAttemptAllowed("6.6.6.6", victim)).toBe(false)
    // Y el mapa sigue admitiendo llaves nuevas: el flood sí es evictable.
    expect(rl.checkAndRecord("register", `llegada-${Math.random()}`, 60_000, 5)).toBe(true)
  })

  it("con el mapa lleno de puro crítico: el no-crítico nuevo se rechaza y el crítico entra", async () => {
    const rl = await freshRateLimit()
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    // Llenar el mapa con llaves CRÍTICAS vivas (verify con identificador
    // arbitrario — el vector exacto del ataque original).
    for (let i = 0; i < 10000; i++) {
      rl.checkAndRecord("verify", `codigo-${i}`, 60_000, 5)
    }
    // Una llave NUEVA de scope no crítico no tiene ya nada evictable delante:
    // fail-closed — se rechaza en vez de tumbar castigos de seguridad.
    expect(rl.checkAndRecord("directory", `visitante-${Math.random()}`, 60_000, 5)).toBe(false)
    // La llave crítica nueva sí se admite aunque el mapa exceda MAX_KEYS:
    // sus entradas expiran solas; perder el bloqueo sería peor.
    expect(rl.checkAndRecord("verify", `codigo-nuevo-${Math.random()}`, 60_000, 5)).toBe(true)
    // recordFailure de scope no crítico no revienta ni desplaza nada: no-op.
    rl.recordFailure("catalog-list", `x-${Math.random()}`, 60_000)
    // El backoff del login (scope crítico) sigue registrándose con el mapa lleno.
    const acct = `saturada-${Math.random()}@test.mx`
    for (let i = 0; i < 10; i++) rl.recordLoginFailure("7.7.7.7", acct)
    expect(rl.loginAttemptAllowed("7.7.7.7", acct)).toBe(false)
  })

  it("las llaves críticas expiran solas por ventana aunque nunca se evicten", async () => {
    const rl = await freshRateLimit()
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const key = `expira-${Math.random()}`
    expect(rl.checkAndRecord("verify", key, 1000, 1)).toBe(true)
    expect(rl.checkAndRecord("verify", key, 1000, 1)).toBe(false)
    vi.advanceTimersByTime(1001)
    // La protección es contra evicción forzada, no contra la expiración natural.
    expect(rl.checkAndRecord("verify", key, 1000, 1)).toBe(true)
  })
})

describe("TRUST_PROXY_SECRET — candado de los headers de proxy", () => {
  it("con secreto configurado, solo honra los headers si x-origin-secret coincide", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    vi.stubEnv("TRUST_PROXY_SECRET", "s3cret-origen")
    const forged = { headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7" } }
    // Sin el header del proxy: la IP forjada no abre bucket — cae al
    // compartido "direct-clients" (la LAN :3005 no puede spoofear).
    expect(getClientIp(new Request("https://app.invalid", forged))).toBe("direct-clients")
    // Con el secreto correcto (lo inyecta la Transform Rule de Cloudflare):
    // vuelve a mandar la cadena CF-Connecting-IP → XFF → X-Real-IP.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-origin-secret": "s3cret-origen" },
    }))).toBe("203.0.113.9")
    // Secreto incorrecto: tampoco.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-origin-secret": "nope" },
    }))).toBe("direct-clients")
    // Tras el gate, la preferencia de headers se conserva (XFF si no hay CF).
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "x-forwarded-for": "198.51.100.7", "x-origin-secret": "s3cret-origen" },
    }))).toBe("198.51.100.7")
  })

  it("sin secreto configurado conserva el comportamiento y avisa una sola vez", async () => {
    vi.resetModules() // el flag de "ya avisé" vive en el módulo
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    vi.stubEnv("TRUST_PROXY_SECRET", "")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const fresh = await import("@/lib/rate-limit")
      const req = () => new Request("https://app.invalid", { headers: { "cf-connecting-ip": "203.0.113.9" } })
      expect(fresh.getClientIp(req())).toBe("203.0.113.9") // comportamiento previo
      fresh.getClientIp(req())
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain("TRUST_PROXY_SECRET")
    } finally {
      warn.mockRestore()
    }
  })
})

describe("login lockout por par (IP, cuenta) — anti lockout-DoS", () => {
  it("los fallos del atacante solo bloquean su (IP, cuenta), no a la víctima", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const victim = `victim-${Math.random()}@test.mx`
    // 10 fallos contra la cuenta de la víctima desde la IP del atacante…
    for (let i = 0; i < 10; i++) recordLoginFailure("6.6.6.6", victim)
    // …agotan el bucket del atacante (él queda fuera)…
    expect(loginAttemptAllowed("6.6.6.6", victim)).toBe(false)
    // …pero la víctima conserva sus intentos desde su propia IP: el par no
    // se comparte — antes el bucket era solo la cuenta y quedaba bloqueada.
    expect(loginAttemptAllowed("203.0.113.7", victim)).toBe(true)
  })

  it("el techo por cuenta (más alto) frena el stuffing distribuido", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const acct = `acct-${Math.random()}@test.mx`
    // 50 fallos desde 50 IPs distintas llenan el bucket por cuenta.
    for (let i = 0; i < 50; i++) recordLoginFailure(`10.9.9.${i}`, acct)
    expect(loginAttemptAllowed("10.9.9.200", acct)).toBe(false)
    // Pero 10 desde una sola IP no bastan (aunque el atacante rotara IP,
    // cada par nuevo sigue contando contra la cuenta hasta el techo).
    const other = `other-${Math.random()}@test.mx`
    for (let i = 0; i < 10; i++) recordLoginFailure("6.6.6.6", other)
    expect(loginAttemptAllowed("203.0.113.9", other)).toBe(true)
  })

  it("backoff exponencial: insistir sobre el par bloqueado estira su ventana", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    const id = `bk-${Math.random()}@test.mx`
    for (let i = 0; i < 10; i++) recordLoginFailure("6.6.6.6", id)
    // El intento #11 ya bloqueado rearma la ventana ×2 (~30 min desde ahora).
    expect(loginAttemptAllowed("6.6.6.6", id)).toBe(false)
    vi.advanceTimersByTime(16 * 60 * 1000)
    // Pasada la ventana base de 15 min seguiría fuera: el backoff ganó.
    expect(loginAttemptAllowed("6.6.6.6", id)).toBe(false)
    // La víctima en otra IP jamás se vio afectada.
    expect(loginAttemptAllowed("203.0.113.8", id)).toBe(true)
  })
})
