import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InlineNameEditor } from "@/components/admin/inline-name-editor"

/**
 * InlineNameEditor — rename inline de las tarjetas de catálogo (marcas,
 * modelos, categorías). El componente no hace fetch: recibe onSave del
 * padre (PATCH que resuelve true cuando el rename se aplicó). El harness de
 * abajo reproduce ese contrato —incluido el 409 de duplicado— para probar el
 * comportamiento de punta a punta con fetch mockeado.
 */

/** Harness que imita al padre real: PATCH, cierra solo si res.ok. */
function RenameHarness({ entity = "Marca", initial = "Genérica" } = {}) {
  const [editing, setEditing] = useState(true)
  if (!editing) return <div data-testid="closed">Guardado</div>
  return (
    <InlineNameEditor
      currentName={initial}
      onClose={() => setEditing(false)}
      onSave={async (name) => {
        const res = await fetch(`/api/catalog/${entity}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName: initial, newName: name }),
        })
        return res.ok
      }}
    />
  )
}

describe("InlineNameEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("precarga el nombre actual, enfoca el input y selecciona el texto", async () => {
    render(<InlineNameEditor currentName="Genérica" onSave={vi.fn()} onClose={vi.fn()} />)
    const input = screen.getByRole("textbox", { name: /nuevo nombre para genérica/i })
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveValue("Genérica")
    expect((input as HTMLInputElement).selectionStart).toBe(0)
    expect((input as HTMLInputElement).selectionEnd).toBe("Genérica".length)
  })

  it("Enter guarda el nombre recortado y cierra cuando onSave resuelve true", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    render(<InlineNameEditor currentName="Genérica" onSave={onSave} onClose={onClose} />)
    const input = screen.getByRole("textbox")

    await user.clear(input)
    await user.type(input, "  Bosch  {Enter}")

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith("Bosch") // trim aplicado
  })

  it("onSave resuelve false (p. ej. 409 duplicado): el editor sigue abierto y editable", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(false)
    const onClose = vi.fn()
    render(<InlineNameEditor currentName="Genérica" onSave={onSave} onClose={onClose} />)
    const input = screen.getByRole("textbox")

    await user.clear(input)
    await user.type(input, "Duplicada{Enter}")

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.getByRole("button", { name: /guardar nombre/i })).toBeEnabled()
  })

  it("nombre vacío o solo espacios: Guardar deshabilitado y Enter no llama onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineNameEditor currentName="Genérica" onSave={onSave} onClose={vi.fn()} />)
    const input = screen.getByRole("textbox")

    await user.clear(input)
    const saveButton = screen.getByRole("button", { name: /guardar nombre/i })
    expect(saveButton).toBeDisabled()

    await user.type(input, "   {Enter}")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("Escape cancela con stopPropagation: el Dialog padre no recibe la tecla", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const parentKeyDown = vi.fn()
    render(
      // El uso real es dentro del Dialog de Clasificación: si Escape
      // burbujeara también cerraría el diálogo.
      <div onKeyDown={parentKeyDown}>
        <InlineNameEditor currentName="Genérica" onSave={vi.fn()} onClose={onClose} />
      </div>,
    )
    const input = screen.getByRole("textbox")

    await user.type(input, "{Escape}")

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it("el botón ✕ cancela sin guardar", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<InlineNameEditor currentName="Genérica" onSave={onSave} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: /cancelar edición/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("mientras el PATCH está en vuelo el input y los botones quedan deshabilitados", async () => {
    const user = userEvent.setup()
    let resolveSave: (v: boolean) => void = () => {}
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve }))
    render(<InlineNameEditor currentName="Genérica" onSave={onSave} onClose={vi.fn()} />)
    const input = screen.getByRole("textbox")

    await user.type(input, "{Enter}")

    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole("button", { name: /guardar nombre/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /cancelar edición/i })).toBeDisabled()

    resolveSave(false) // libera: el editor vuelve a estar usable
    await waitFor(() => expect(input).toBeEnabled())
  })

  describe("con el PATCH real del padre (fetch mockeado)", () => {
    it("200 → cierra el editor", async () => {
      const user = userEvent.setup()
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
      vi.stubGlobal("fetch", fetchMock)
      render(<RenameHarness />)

      const input = screen.getByRole("textbox")
      await user.clear(input)
      await user.type(input, "Bosch{Enter}")

      await waitFor(() => expect(screen.getByTestId("closed")).toBeInTheDocument())
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/catalog/Marca",
        expect.objectContaining({ method: "PATCH" }),
      )
    })

    it("409 duplicado → el editor no cierra y permite reintentar", async () => {
      const user = userEvent.setup()
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 409 }))
      vi.stubGlobal("fetch", fetchMock)
      render(<RenameHarness />)

      const input = screen.getByRole("textbox")
      await user.clear(input)
      await user.type(input, "Ya existe{Enter}")

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(screen.queryByTestId("closed")).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled())
    })
  })
})
