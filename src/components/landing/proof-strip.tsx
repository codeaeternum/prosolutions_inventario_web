import Link from "next/link"

export function ProofStrip({ businesses }: { businesses: { name: string; slug: string }[] }) {
  if (!businesses.length) return null
  return <section aria-label="Negocios en Reficio" className="border-b"><div className="mx-auto max-w-6xl px-4 py-6"><p className="text-center text-sm text-muted-foreground">Negocios reales ya publican su vitrina en Reficio</p><ul className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3">{businesses.map(business => <li key={business.slug}><Link className="font-semibold underline-offset-4 hover:underline" href={`/${business.slug}`}>{business.name}</Link></li>)}</ul></div></section>
}
