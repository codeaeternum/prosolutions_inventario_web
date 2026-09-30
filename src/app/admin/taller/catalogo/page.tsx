import { redirect } from "next/navigation"

// El catálogo de servicios/precios ahora vive dentro del Taller.
// Se conservan los demás params por si un link viejo traía algo más.
export default async function WorkshopCatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  params.set("tab", "precios")
  for (const [key, value] of Object.entries(sp)) {
    if (key === "tab" || typeof value !== "string" || !value) continue
    params.set(key, value)
  }
  redirect(`/admin/taller?${params.toString()}`)
}
