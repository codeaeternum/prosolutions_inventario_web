import { redirect } from "next/navigation"

// Los encargos ahora viven dentro del hub de Almacén.
export default function EncargosPage() {
  redirect("/admin/inventario?tab=encargos")
}
