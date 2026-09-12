import { redirect } from "next/navigation"

// La gestión de modelos vive en el hub de clasificación del catálogo.
export default function ModelosPage() {
  redirect("/admin/catalogo?tab=modelos")
}
