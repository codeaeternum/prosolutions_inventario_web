import { redirect } from "next/navigation"

// La impresión de etiquetas QR ahora vive como pestaña dentro del hub de Productos.
export default function EtiquetasPage() {
  redirect("/admin/productos?tab=etiquetas")
}
