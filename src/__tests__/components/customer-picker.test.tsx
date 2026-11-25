import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CustomerPicker } from "@/components/pos/customer-picker"

/**
 * CustomerPicker — buscador de cliente del POS con alta inline.
 * fetch se mockea por endpoint: /api/users (ruta principal) y /api/users/pos
 * (fallback y alta rápida). El debounce de búsqueda es de 250 ms — los tests
 * corren con timers reales y waitFor.
 */

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const customersPayload = (users: object[] = []) => ({ users })

const jsonResponse = (body: unknown, ok = true, status = 200) =>
    ({
        ok,
        status,
        json: () => Promise.resolve(body),
    }) as Response

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString()
        return Promise.resolve(handler(url, init))
    })
    vi.stubGlobal("fetch", fn)
    return fn
}

const typeSearch = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const input = screen.getByRole("textbox", { name: /buscar cliente/i })
    await user.type(input, text)
    return input
}

describe("CustomerPicker", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it("muestra coincidencias y selecciona el cliente al hacer clic", async () => {
        mockFetch((url) => {
            if (url.startsWith("/api/users?")) {
                return jsonResponse(customersPayload([{ id: "c1", name: "Ana Ríos", creditLimit: null, creditBalance: 0 }]))
            }
            return jsonResponse({})
        })
        const onChange = vi.fn()
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={onChange} />)

        await typeSearch(user, "ana")
        const row = await screen.findByRole("button", { name: /ana ríos/i })
        await user.click(row)

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", name: "Ana Ríos" }))
    })

    it("red caída: muestra error con Reintentar en vez de 'Sin coincidencias'", async () => {
        mockFetch(() => Promise.reject(new TypeError("fetch failed")))
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        await typeSearch(user, "ana")
        await screen.findByText(/no se pudo buscar/i)

        expect(screen.queryByText(/sin coincidencias/i)).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument()
    })

    it("ambos endpoints con error HTTP: error visible y sin resultados obsoletos", async () => {
        // Primera búsqueda ("an") exitosa; la segunda ("ani") falla en ambos
        // endpoints — las coincidencias de "an" no deben quedar pintadas.
        mockFetch((url) => {
            if (url.includes("search=ani")) {
                return jsonResponse({ error: "boom" }, false, 500)
            }
            if (url.startsWith("/api/users?")) {
                return jsonResponse(customersPayload([{ id: "c1", name: "Ana Ríos", creditLimit: null, creditBalance: 0 }]))
            }
            return jsonResponse({ error: "boom" }, false, 500)
        })
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        const input = await typeSearch(user, "an")
        await screen.findByRole("button", { name: /ana ríos/i })

        await user.type(input, "i") // query = "ani" → fetch falla
        await screen.findByText(/no se pudo buscar/i)
        expect(screen.queryByRole("button", { name: /ana ríos/i })).not.toBeInTheDocument()
    })

    it("Reintentar relanza la búsqueda y recupera resultados", async () => {
        let fail = true
        mockFetch((url) => {
            if (url.startsWith("/api/users?")) {
                if (fail) return Promise.reject(new TypeError("fetch failed"))
                return jsonResponse(customersPayload([{ id: "c1", name: "Ana Ríos" }]))
            }
            return jsonResponse({ users: [] })
        })
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        await typeSearch(user, "ana")
        await screen.findByText(/no se pudo buscar/i)

        fail = false
        await user.click(screen.getByRole("button", { name: /reintentar/i }))
        await screen.findByRole("button", { name: /ana ríos/i })
    })

    it("sin resultados ofrece 'Crear cliente nuevo'; al crearlo queda seleccionado inline", async () => {
        const fetchMock = mockFetch((url, init) => {
            if (url === "/api/users/pos" && init?.method === "POST") {
                return jsonResponse({
                    user: { id: "c9", name: "Ana Ríos", customerType: "NORMAL", phone: "6671234567", creditLimit: null, creditBalance: 0 },
                    existing: false,
                }, true, 201)
            }
            if (url.startsWith("/api/users?")) return jsonResponse(customersPayload([]))
            return jsonResponse(customersPayload([]))
        })
        const onChange = vi.fn()
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={onChange} />)

        await typeSearch(user, "Ana Ríos")
        const createRow = await screen.findByRole("button", { name: /crear cliente nuevo/i })
        await user.click(createRow)

        // Prefill: el término no era teléfono → cae en el nombre.
        const nameInput = screen.getByRole("textbox", { name: /nombre/i })
        expect(nameInput).toHaveValue("Ana Ríos")

        await user.type(screen.getByRole("textbox", { name: /teléfono/i }), "667 123 4567")
        await user.click(screen.getByRole("button", { name: /crear y seleccionar/i }))

        await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c9", name: "Ana Ríos" })))
        const postCall = fetchMock.mock.calls.find(([input]) => input === "/api/users/pos")
        expect(postCall).toBeTruthy()
        const body = JSON.parse((postCall![1] as RequestInit).body as string)
        expect(body).toEqual({ name: "Ana Ríos", phone: "6671234567" })
    })

    it("término numérico prellena el teléfono del alta, no el nombre", async () => {
        mockFetch((url) => {
            if (url.startsWith("/api/users?")) return jsonResponse(customersPayload([]))
            return jsonResponse(customersPayload([]))
        })
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        await typeSearch(user, "6671234567")
        await user.click(await screen.findByRole("button", { name: /crear cliente nuevo/i }))

        expect(screen.getByRole("textbox", { name: /nombre/i })).toHaveValue("")
        expect(screen.getByRole("textbox", { name: /teléfono/i })).toHaveValue("6671234567")
    })

    it("error del servidor al crear: mensaje inline y NO se selecciona nada", async () => {
        mockFetch((url, init) => {
            if (url === "/api/users/pos" && init?.method === "POST") {
                return jsonResponse({ error: "Ese teléfono ya está registrado en el negocio." }, false, 409)
            }
            return jsonResponse(customersPayload([]))
        })
        const onChange = vi.fn()
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={onChange} />)

        await typeSearch(user, "Ana")
        await user.click(await screen.findByRole("button", { name: /crear cliente nuevo/i }))
        await user.click(screen.getByRole("button", { name: /crear y seleccionar/i }))

        await screen.findByRole("alert")
        expect(screen.getByRole("alert")).toHaveTextContent(/teléfono ya está registrado/i)
        expect(onChange).not.toHaveBeenCalled()
    })

    it("validación local: nombre de 1 letra no dispara el POST", async () => {
        const fetchMock = mockFetch(() => jsonResponse(customersPayload([])))
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        await typeSearch(user, "ab")
        await user.click(await screen.findByRole("button", { name: /crear cliente nuevo/i }))
        const nameInput = screen.getByRole("textbox", { name: /nombre/i })
        await user.clear(nameInput)
        await user.type(nameInput, "x")

        // El botón queda deshabilitado con menos de 2 letras.
        expect(screen.getByRole("button", { name: /crear y seleccionar/i })).toBeDisabled()
        expect(fetchMock.mock.calls.some(([input]) => input === "/api/users/pos")).toBe(false)
    })

    it("requiresCredit (cobro a crédito) no ofrece alta: el cliente nuevo nunca tiene línea", async () => {
        mockFetch(() => jsonResponse(customersPayload([])))
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} requiresCredit />)

        await typeSearch(user, "ana")
        await screen.findByText(/sin clientes con crédito/i)
        expect(screen.queryByRole("button", { name: /crear cliente nuevo/i })).not.toBeInTheDocument()
    })

    it("cancelar el alta regresa al buscador sin perder el término", async () => {
        mockFetch(() => jsonResponse(customersPayload([])))
        const user = userEvent.setup()
        render(<CustomerPicker value={null} onChange={vi.fn()} />)

        await typeSearch(user, "ana")
        await user.click(await screen.findByRole("button", { name: /crear cliente nuevo/i }))
        await user.click(screen.getByRole("button", { name: /^cancelar$/i }))

        // El buscador se remonta al salir del alta, pero el término sobrevive.
        expect(screen.getByRole("textbox", { name: /buscar cliente/i })).toHaveValue("ana")
    })
})
