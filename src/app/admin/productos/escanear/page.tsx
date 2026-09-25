import { redirect } from "next/navigation"

// "Escanear producto" ahora abre la Entrada rápida de Inventario → Stock,
// que incluye el lector de código de barras.
export default function ScanProductPage() {
    redirect("/admin/inventario?tab=stock&entrada=1")
}
