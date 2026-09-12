import { redirect } from "next/navigation"

// La gestión de categorías vive en el hub de clasificación del catálogo.
export default function CategoriasPage() {
  redirect("/admin/catalogo?tab=categorias")
}
