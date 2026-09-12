import { redirect } from "next/navigation"

// La gestión de modelos vive en el hub de Productos, pestaña Clasificación.
export default function ModelosPage() {
  redirect("/admin/productos?tab=clasificacion&sub=modelos")
}
