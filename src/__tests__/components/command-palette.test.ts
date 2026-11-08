import { describe, it, expect } from "vitest"
import {
  findGoCommand,
  isEditableShortcutTarget,
  resolveNewShortcut,
  GO_SEQUENCE_MS,
  NEW_SHORTCUT_QUERY,
} from "@/components/admin/command-palette"

// La paleta no puede renderizarse en vitest (ambiente node, sin DOM): se
// prueban los helpers puros de los atajos "g"+letra. La regla clave — los
// atajos resuelven sobre visibleCommands, que ya viene filtrada por
// módulo/rol: si el sidebar oculta Taller, "g t" tampoco navega.
const commands = [
  { id: "nav-home", href: "/admin", shortcut: "g d" },
  { id: "nav-ventas", href: "/admin/ventas", shortcut: "g v" },
  { id: "nav-taller", href: "/admin/taller", shortcut: "g t" },
  { id: "nav-inventario", href: "/admin/inventario", shortcut: "g i" },
  { id: "nav-clientes", href: "/admin/clientes", shortcut: "g u" },
  { id: "nav-config", href: "/admin/configuracion", shortcut: "g s" },
  { id: "nav-sucursales", href: "/admin/configuracion?tab=sucursales" }, // sin atajo
]

describe("findGoCommand", () => {
  it("resuelve la segunda tecla al comando con ese atajo", () => {
    expect(findGoCommand(commands, "d")?.href).toBe("/admin")
    expect(findGoCommand(commands, "v")?.href).toBe("/admin/ventas")
    expect(findGoCommand(commands, "t")?.href).toBe("/admin/taller")
    expect(findGoCommand(commands, "i")?.href).toBe("/admin/inventario")
    expect(findGoCommand(commands, "u")?.href).toBe("/admin/clientes")
    expect(findGoCommand(commands, "s")?.href).toBe("/admin/configuracion")
  })

  it("devuelve null cuando el módulo filtró el comando (gate del sidebar)", () => {
    const sinTaller = commands.filter(c => c.id !== "nav-taller")
    expect(findGoCommand(sinTaller, "t")).toBeNull()
    // …pero el resto de atajos sigue funcionando.
    expect(findGoCommand(sinTaller, "v")?.id).toBe("nav-ventas")
  })

  it("tolera mayúscula en la segunda tecla (Shift/CapsLock)", () => {
    expect(findGoCommand(commands, "D")?.id).toBe("nav-home")
  })

  it("devuelve null para teclas sin atajo o comandos sin shortcut", () => {
    expect(findGoCommand(commands, "x")).toBeNull()
    expect(findGoCommand(commands, "g")).toBeNull()
    expect(findGoCommand(commands, "?")).toBeNull()
  })
})

describe("isEditableShortcutTarget", () => {
  // Sin DOM, `target` nunca es HTMLElement → los atajos no interceptan.
  it("devuelve false para targets que no son HTMLElement", () => {
    expect(isEditableShortcutTarget(null)).toBe(false)
    // Ni siquiera algo con pinta de input: el guard exige HTMLElement real.
    const fakeInput = { tagName: "INPUT" } as unknown as EventTarget
    expect(isEditableShortcutTarget(fakeInput)).toBe(false)
  })
})

describe("resolveNewShortcut (tecla n)", () => {
  // El mapa ruta→acción es puro; el gate de módulo/rol se aplica en el
  // componente buscando el commandId en visibleCommands (igual que "g …").
  it("taller (cualquier subruta) → comando recibir equipo", () => {
    expect(resolveNewShortcut("/admin/taller")).toEqual({ kind: "command", commandId: "acc-recibir" })
    expect(resolveNewShortcut("/admin/taller/recibir")).toEqual({ kind: "command", commandId: "acc-recibir" })
    expect(resolveNewShortcut("/admin/taller/catalogo")).toEqual({ kind: "command", commandId: "acc-recibir" })
  })

  it("ventas → enfoca el buscador de producto", () => {
    expect(resolveNewShortcut("/admin/ventas")).toEqual({ kind: "focus", selector: "#pos-product-search" })
  })

  it("inventario → comando nuevo producto", () => {
    expect(resolveNewShortcut("/admin/inventario")).toEqual({ kind: "command", commandId: "acc-nuevo-producto" })
  })

  it("ficha 360 de cliente → nueva venta con cliente precargado, gated por ventas", () => {
    expect(resolveNewShortcut("/admin/clientes/cus_123")).toEqual({
      kind: "href",
      href: "/admin/ventas?cliente=cus_123",
      gatedBy: "acc-vender",
    })
  })

  it("clientes (hub) → paleta: no existe alta de cliente en la página", () => {
    expect(resolveNewShortcut("/admin/clientes")).toEqual({ kind: "palette", query: NEW_SHORTCUT_QUERY })
  })

  it("resto de páginas → paleta pre-cargada con «nuev»", () => {
    for (const path of ["/admin", "/admin/caja", "/admin/equipo", "/admin/reportes", "/admin/configuracion", "/admin/mercado", "/admin/tickets/venta/abc"]) {
      expect(resolveNewShortcut(path)).toEqual({ kind: "palette", query: NEW_SHORTCUT_QUERY })
    }
  })

  it("prefijos no se confunden (ventasx, taller-extra sin slash)", () => {
    expect(resolveNewShortcut("/admin/ventasx")).toEqual({ kind: "palette", query: NEW_SHORTCUT_QUERY })
  })

  it("«nuev» matchea tanto «nueva» como «nuevo» en el filtro de la paleta", () => {
    // Mismo normalize del componente: la query del fallback debe ser
    // prefijo de ambos para listar todas las acciones de alta.
    expect("nueva venta".includes(NEW_SHORTCUT_QUERY)).toBe(true)
    expect("nuevo producto".includes(NEW_SHORTCUT_QUERY)).toBe(true)
    expect("nueva orden de servicio".includes(NEW_SHORTCUT_QUERY)).toBe(true)
  })
})

describe("GO_SEQUENCE_MS", () => {
  it("es la ventana corta estilo GitHub para completar g+letra", () => {
    expect(GO_SEQUENCE_MS).toBe(800)
  })
})
