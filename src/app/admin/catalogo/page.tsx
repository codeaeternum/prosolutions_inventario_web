import { redirect } from "next/navigation"

const SUBTABS = ["categorias", "marcas", "modelos"] as const

// La clasificación del catálogo ahora vive dentro del hub de Productos.
// ?tab=categorias|marcas|modelos se traduce a ?tab=clasificacion&sub=<tab>
export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const sub = (SUBTABS as readonly string[]).includes(tab ?? "") ? `&sub=${tab}` : ""
  redirect(`/admin/productos?tab=clasificacion${sub}`)
}
