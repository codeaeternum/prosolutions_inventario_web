import { redirect } from "next/navigation"

// La cartera de crédito ahora vive en el hub de Clientes (?tab=cobranza).
// Se conservan los params de la URL vieja (p. ej. ?cliente=<id>) si llegan.
export default async function CreditoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v)
  }
  qs.set("tab", "cobranza")
  redirect(`/admin/clientes?${qs.toString()}`)
}
