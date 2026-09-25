import Link from "next/link"
import { MapPin, MessageCircle, Package, Store } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/utils"
import { waMeHref } from "./whatsapp-button"

export interface PublicProduct {
  id: string
  name: string
  barcode: string | null
  retailPrice: number
  stock: number
  images: string[]
  category: { name: string } | null
  /**
   * Sucursales donde la pieza está disponible — SOLO nombres (la
   * disponibilidad pública es binaria, nunca cantidades exactas).
   */
  branchNames?: string[]
}

interface PublicProductCardProps {
  product: PublicProduct
  /** Namespace del negocio — para el fallback "Ver en tienda". */
  slug: string
  /** WhatsApp del negocio (SystemSettings public_phone); puede faltar. */
  phone?: string
}

/**
 * Tarjeta del catálogo público (/<slug>/market). El público ve precio de
 * menudeo (retailPrice); el mayoreo es solo para cuentas aprobadas.
 * CTA principal: "Preguntar" por WhatsApp con el producto y código ya
 * escritos en el mensaje; sin teléfono público cae a un enlace a la vitrina.
 */
export function PublicProductCard({ product, slug, phone }: PublicProductCardProps) {
  const inStock = product.stock > 0
  const waText = `Hola, me interesa ${product.name}${product.barcode ? ` (${product.barcode})` : ""}`
  const waUrl = waMeHref(phone, waText)

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-square bg-primary/5">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- URLs locales/remotas no registradas en remotePatterns
          <img
            src={product.images[0]}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-10 w-10 text-primary/40" aria-hidden />
          </div>
        )}
        <Badge
          variant={inStock ? "success" : "secondary"}
          className="absolute right-2 top-2"
        >
          {inStock ? "Disponible" : "Agotado"}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="space-y-1">
          {product.category && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{product.category.name}</p>
          )}
          <h3 className="text-sm font-medium leading-snug line-clamp-2">{product.name}</h3>
        </div>

        <p className="mt-auto text-lg font-bold text-primary">{formatPrice(product.retailPrice)}</p>

        {/* En qué sucursal hay: nombres únicamente, jamás existencias. */}
        {product.branchNames && product.branchNames.length > 0 && (
          <p className="inline-flex items-start gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="line-clamp-2">
              En: {product.branchNames.join(" · ")}
            </span>
          </p>
        )}

        {waUrl ? (
          <Button size="sm" className="w-full gap-1.5" asChild>
            <a href={waUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              Preguntar
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="w-full gap-1.5" asChild>
            <Link href={`/${slug}#contacto`}>
              <Store className="h-4 w-4" />
              Ver en tienda
            </Link>
          </Button>
        )}
      </div>
    </article>
  )
}
