import { redirect } from "next/navigation"

// El historial de movimientos vive ahora dentro del hub de inventario.
export default function MovimientosPage() {
  redirect("/admin/inventario?tab=historial")
}
