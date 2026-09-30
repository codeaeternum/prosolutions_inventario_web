import { redirect } from "next/navigation"

// Las reservas/apartados ahora viven en el hub de Clientes (?tab=pedidos).
export default function ReservasPage() {
  redirect("/admin/clientes?tab=pedidos")
}
