import { redirect } from "next/navigation"

// El registro de actividad ahora vive dentro del hub de Equipo.
export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value)
    else if (Array.isArray(value)) for (const v of value) params.append(key, v)
  }
  params.set("tab", "actividad")
  redirect(`/admin/equipo?${params.toString()}`)
}
