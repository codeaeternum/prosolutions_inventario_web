import { redirect } from "next/navigation"

// El alta de producto ahora es un diálogo dentro de Inventario → Stock.
// ?barcode=X (del viejo escáner) viaja como ?codigo=X para prellenar el alta.
export default async function NuevoProductoPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const sp = await searchParams
    const params = new URLSearchParams({ tab: "stock", nuevo: "1" })
    const barcode = typeof sp.barcode === "string" ? sp.barcode : ""
    if (barcode) params.set("codigo", barcode)
    redirect(`/admin/inventario?${params.toString()}`)
}
