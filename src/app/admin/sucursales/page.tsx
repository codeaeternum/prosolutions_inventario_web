import { redirect } from "next/navigation"

// Las sucursales ahora viven dentro de Configuración.
export default async function SucursalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value)
    else if (Array.isArray(value)) for (const v of value) params.append(key, v)
  }
  params.set("tab", "sucursales")
  redirect(`/admin/configuracion?${params.toString()}`)
}
