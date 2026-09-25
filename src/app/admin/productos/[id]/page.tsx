import { redirect } from "next/navigation"

// La ficha/edición de producto ahora es un diálogo dentro de Inventario → Stock.
export default async function EditProductPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    redirect(`/admin/inventario?tab=stock&editar=${encodeURIComponent(id)}`)
}
