import { redirect } from "next/navigation"

// La impresión de etiquetas QR vive como herramienta dentro de Inventario → Stock.
export default function EtiquetasPage() {
  redirect("/admin/inventario?tab=stock&herramienta=etiquetas")
}
