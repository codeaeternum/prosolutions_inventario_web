import { redirect } from "next/navigation"

// La gestión de marcas vive en el hub de Productos, pestaña Clasificación.
export default function MarcasPage() {
  redirect("/admin/productos?tab=clasificacion&sub=marcas")
}
