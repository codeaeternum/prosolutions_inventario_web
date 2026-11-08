import { describe, it, expect } from "vitest"
import {
  grupoFromParams,
  statusFilterFromParams,
  userMatchesQuery,
  sortUsersForReview,
} from "@/components/admin/equipo/usuarios-panel"

// Los helpers del panel de usuarios son puros (vitest corre en node, sin
// DOM): se prueba la lógica de filtros en URL, la búsqueda local y el orden
// "pendientes primero", que son las piezas que deciden si una cuenta nueva
// se localiza rápido o se pierde entre páginas.

const params = (obj: Record<string, string>) => (key: string) => obj[key] ?? null

describe("grupoFromParams", () => {
  it("cae en clientes cuando no hay params", () => {
    expect(grupoFromParams(params({}))).toBe("clientes")
  })

  it("respeta grupos válidos", () => {
    for (const g of ["clientes", "empleados", "talleres", "administradores", "pendientes"]) {
      expect(grupoFromParams(params({ grupo: g }))).toBe(g)
    }
  })

  it("ignora valores inválidos", () => {
    expect(grupoFromParams(params({ grupo: "root" }))).toBe("clientes")
  })

  it("el link viejo ?filter=pending aterriza en pendientes", () => {
    // /admin enlaza "Revisar" con ?tab=usuarios&filter=pending; romperlo
    // dejaría al dueño en Clientes sin las cuentas que pedían revisión.
    expect(grupoFromParams(params({ filter: "pending" }))).toBe("pendientes")
  })

  it("grupo explícito gana sobre filter viejo", () => {
    expect(grupoFromParams(params({ grupo: "empleados", filter: "pending" }))).toBe("empleados")
  })
})

describe("statusFilterFromParams", () => {
  it("cae en all cuando falta o es inválido", () => {
    expect(statusFilterFromParams(params({}))).toBe("all")
    expect(statusFilterFromParams(params({ status: "banana" }))).toBe("all")
  })

  it("acepta los estatus conocidos y es case-insensitive", () => {
    // Links viejos de la paginación llevaban `status=APPROVED` en mayúsculas.
    expect(statusFilterFromParams(params({ status: "approved" }))).toBe("approved")
    expect(statusFilterFromParams(params({ status: "PENDING" }))).toBe("pending")
    expect(statusFilterFromParams(params({ status: "rejected" }))).toBe("rejected")
  })
})

describe("userMatchesQuery", () => {
  const user = {
    name: "Kevin Garza",
    email: "kevin@taller.com",
    phone: "811 234 5678",
    jobTitle: "Técnico",
    homeBranch: { name: "Sucursal Norte" },
  }

  it("consulta vacía no filtra nada", () => {
    expect(userMatchesQuery(user, "")).toBe(true)
    expect(userMatchesQuery(user, "   ")).toBe(true)
  })

  it("encuentra por nombre, correo y teléfono", () => {
    expect(userMatchesQuery(user, "kevin")).toBe(true)
    expect(userMatchesQuery(user, "TALLER.com")).toBe(true)
    expect(userMatchesQuery(user, "811 234")).toBe(true)
  })

  it("encuentra por puesto y por nombre de sucursal base", () => {
    // Buscar "técnico" o "norte" debe localizar a la persona aunque el nombre
    // no coincida — son los datos que el dueño recuerda.
    expect(userMatchesQuery(user, "técnico")).toBe(true)
    expect(userMatchesQuery(user, "norte")).toBe(true)
  })

  it("tolera campos nulos", () => {
    const sinDatos = { name: "Ana", email: "ana@x.com", phone: null, jobTitle: null, homeBranch: null }
    expect(userMatchesQuery(sinDatos, "ana")).toBe(true)
    expect(userMatchesQuery(sinDatos, "técnico")).toBe(false)
  })
})

describe("sortUsersForReview", () => {
  const mk = (id: string, status: string, createdAt: string) => ({ id, status, createdAt })

  it("las pendientes van primero, más nuevas arriba", () => {
    const list = [
      mk("a1", "APPROVED", "2024-01-01T00:00:00Z"),
      mk("p-old", "PENDING", "2024-01-02T00:00:00Z"),
      mk("a2", "APPROVED", "2024-01-05T00:00:00Z"),
      mk("p-new", "PENDING", "2024-01-10T00:00:00Z"),
      mk("r1", "REJECTED", "2024-01-09T00:00:00Z"),
    ]
    const result = sortUsersForReview(list)
    expect(result.map(u => u.id)).toEqual(["p-new", "p-old", "a1", "a2", "r1"])
  })

  it("el resto conserva el orden del servidor (estable)", () => {
    const list = [
      mk("a", "APPROVED", "2024-01-01T00:00:00Z"),
      mk("b", "REJECTED", "2024-01-03T00:00:00Z"),
      mk("c", "APPROVED", "2024-01-02T00:00:00Z"),
    ]
    expect(sortUsersForReview(list).map(u => u.id)).toEqual(["a", "b", "c"])
  })

  it("sin pendientes devuelve el mismo orden", () => {
    const list = [mk("x", "APPROVED", "2024-01-01T00:00:00Z"), mk("y", "REJECTED", "2024-01-02T00:00:00Z")]
    expect(sortUsersForReview(list)).toEqual(list)
    expect(sortUsersForReview([])).toEqual([])
  })
})
