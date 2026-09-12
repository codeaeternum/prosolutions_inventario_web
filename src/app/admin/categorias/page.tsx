import { redirect } from "next/navigation"

// La gestión de categorías vive en el hub de Productos, pestaña Clasificación.
export default function CategoriasPage() {
  redirect("/admin/productos?tab=clasificacion&sub=categorias")
}
