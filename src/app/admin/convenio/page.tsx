import { redirect } from "next/navigation"

// Las cuentas del convenio B2B ahora viven dentro del Mercado.
// Se conservan los demás params por si un link viejo traía algo más.
export default async function ConvenioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  params.set("tab", "cuentas")
  for (const [key, value] of Object.entries(sp)) {
    if (key === "tab" || typeof value !== "string" || !value) continue
    params.set(key, value)
  }
  redirect(`/admin/mercado?${params.toString()}`)
}
