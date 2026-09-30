import { redirect } from "next/navigation"

// La bandeja de Pendientes en /admin y la campanita cubren esta pantalla.
export default function NotificacionesPage() {
  redirect("/admin")
}
