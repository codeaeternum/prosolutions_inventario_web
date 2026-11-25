import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ProductCatalog } from "@/components/pos/product-catalog"
import type { PosProduct } from "@/components/pos/types"

/**
 * ProductCatalog — error de red persistente con reintento. Antes un catch
 * vaciaba los datos y mandaba toast transitorio: el mostrador veía "No hay
 * productos" como si la sucursal estuviera vacía, sin forma de reintentar.
 * Estos tests cubren las dos superficies del catálogo (exploración y
 * búsqueda) y la distinción error ≠ vacío real.
 */

const product: PosProduct = {
    id: "p1",
    name: "Balata delantera",
    barcode: "7501234567890",
    stock: 4,
    retailPrice: 350,
    wholesalePrice: 300,
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    })
}

/** fetch mockeado por ruta; las banderas mutables permiten fallar la primera
 *  vuelta y recuperarse en el reintento. */
function stubPosFetch(state: { browseFails: boolean; searchFails: boolean; searchProducts?: PosProduct[]; browseProducts?: PosProduct[] }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/categories")) return jsonResponse([])
        if (url.includes("/api/search/pos")) {
            if (state.searchFails) return jsonResponse({ error: "boom" }, 500)
            return jsonResponse({ products: state.searchProducts ?? [] })
        }
        if (url.includes("/api/pos/products")) {
            if (state.browseFails) return jsonResponse({ error: "boom" }, 500)
            return jsonResponse({ products: state.browseProducts ?? [], nextCursor: null })
        }
        throw new Error(`fetch inesperado: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
}

function CatalogHarness() {
    const [query, setQuery] = useState("")
    return (
        <ProductCatalog
            branchId="branch-1"
            workshopActive={false}
            query={query}
            onQueryChange={setQuery}
            onAdd={() => {}}
        />
    )
}

describe("ProductCatalog — estado de error con reintento", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it("exploración falla: muestra error persistente con Reintentar y no el vacío; al reintentar carga la parrilla", async () => {
        const user = userEvent.setup()
        const state = { browseFails: true, searchFails: false, browseProducts: [product] }
        stubPosFetch(state)
        render(<CatalogHarness />)

        // El error sustituye a la parrilla y NO aparece el estado vacío.
        const alert = await screen.findByRole("alert")
        expect(alert).toHaveTextContent(/no se pudo cargar el catálogo/i)
        expect(screen.queryByText(/no hay productos en esta categoría/i)).not.toBeInTheDocument()

        // Reintentar con la red recuperada: la parrilla llega y el error se va.
        state.browseFails = false
        await user.click(screen.getByRole("button", { name: /reintentar/i }))
        await waitFor(() => expect(screen.getByText("Balata delantera")).toBeInTheDocument())
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("exploración exitosa sin productos: sí muestra el estado vacío real", async () => {
        const state = { browseFails: false, searchFails: false, browseProducts: [] as PosProduct[] }
        stubPosFetch(state)
        render(<CatalogHarness />)

        await waitFor(() => expect(screen.getByText(/no hay productos en esta categoría/i)).toBeInTheDocument())
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("búsqueda falla: error persistente con Reintentar; al reintentar llegan los resultados", async () => {
        const user = userEvent.setup()
        const state = { browseFails: false, searchFails: true, searchProducts: [product] }
        stubPosFetch(state)
        render(<CatalogHarness />)

        const input = screen.getByRole("textbox", { name: /buscar producto/i })
        await user.type(input, "bala")

        // Debounce de 300ms + fetch fallido: aparece el error de búsqueda,
        // no el "sin resultados".
        const alert = await screen.findByRole("alert", {}, { timeout: 2500 })
        expect(alert).toHaveTextContent(/no se pudo completar la búsqueda/i)
        expect(screen.queryByText(/sin resultados para esta búsqueda/i)).not.toBeInTheDocument()

        state.searchFails = false
        await user.click(screen.getByRole("button", { name: /reintentar/i }))
        await waitFor(() => expect(screen.getByText("Balata delantera")).toBeInTheDocument(), { timeout: 2500 })
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })
})
