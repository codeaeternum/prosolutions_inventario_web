import { redirect } from "next/navigation"

// La gestión de marcas vive en el hub de clasificación del catálogo.
export default function MarcasPage() {
  redirect("/admin/catalogo?tab=marcas")
}
