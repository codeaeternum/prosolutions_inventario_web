import { redirect } from "next/navigation"

/**
 * /admin/productos ya no existe: todo el catálogo/stock vive en
 * /admin/inventario. Se conserva la query para que bookmarks y links viejos
 * caigan en la pestaña/acción equivalente.
 *
 * Mapeo:
 *   ?tab=productos|existencias  → /admin/inventario (Stock)
 *   ?tab=captura                → /admin/inventario?tab=stock&captura=1
 *   ?tab=clasificacion&sub=X    → /admin/inventario?tab=stock&herramienta=clasificacion&sub=X
 *   ?tab=etiquetas              → /admin/inventario?tab=stock&herramienta=etiquetas
 *   ?mercado=publicados|ocultos → ?visibilidad=publicos|ocultos
 *   ?filter=low-stock           → ?lowStock=true
 */
export default async function ProductosPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const sp = await searchParams
    const tab = typeof sp.tab === "string" ? sp.tab : ""
    const sub = typeof sp.sub === "string" ? sp.sub : ""

    const params = new URLSearchParams()
    params.set("tab", "stock")

    if (tab === "captura") {
        params.set("captura", "1")
    } else if (tab === "clasificacion") {
        params.set("herramienta", "clasificacion")
        if (sub) params.set("sub", sub)
    } else if (tab === "etiquetas") {
        params.set("herramienta", "etiquetas")
    }

    // Filtros que sí tienen equivalente en la lista de stock.
    for (const key of ["search", "page", "categoryId", "lowStock"] as const) {
        const value = sp[key]
        if (typeof value === "string" && value) params.set(key, value)
    }
    if (sp.filter === "low-stock") params.set("lowStock", "true")
    if (sp.mercado === "publicados") params.set("visibilidad", "publicos")
    else if (sp.mercado === "ocultos") params.set("visibilidad", "ocultos")

    redirect(`/admin/inventario?${params.toString()}`)
}
