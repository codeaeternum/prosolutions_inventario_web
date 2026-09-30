import { redirect } from "next/navigation"

// Escanear el QR de un apartado ahora es una acción del mostrador (Vender).
export default function AdminVerificarPage() {
  redirect("/admin/ventas?escanear=1")
}
