"use client"

import Image from "next/image"
import { Smartphone, Lock, Package } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useCurrency } from "@/components/currency-provider"

interface Product {
  id: string
  name: string
  images: string[]
  stock: number
  minStock: number
  hidePrice: boolean
  retailPrice: number
  wholesalePrice: number
  models: Array<{
    model: {
      name: string
      brand: {
        name: string
      }
    }
  }>
  category: {
    name: string
  }
}

interface ProductGridProps {
  products: Product[]
  isLoggedIn: boolean
  isApproved: boolean
  customerType?: string
}

export function ProductGrid({ products, isLoggedIn, isApproved, customerType }: ProductGridProps) {
  const { formatPrice } = useCurrency()

  if (products.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Smartphone className="h-16 w-16 mx-auto mb-4 opacity-50" />
        <p>Próximamente más productos</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
      {products.map((product) => (
        <Card key={product.id} className="overflow-hidden group hover:shadow-md transition-shadow">
          <div className="aspect-square relative bg-gradient-to-br from-muted to-muted/50">
            {product.images[0] ? (
              <Image
                src={product.images[0]}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 50vw, 33vw"
                className="object-cover group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Package className="h-12 w-12 text-muted-foreground/40" />
              </div>
            )}
            {/* Stock badge */}
            {product.stock > 0 && product.stock <= product.minStock && (
              <Badge variant="destructive" className="absolute top-2 right-2 text-[10px] px-1.5">
                {product.stock} UD
              </Badge>
            )}
            {product.stock === 0 && (
              <Badge variant="secondary" className="absolute top-2 right-2 text-[10px] px-1.5">
                Agotado
              </Badge>
            )}
            {product.stock > product.minStock && (
              <Badge variant="default" className="absolute top-2 right-2 text-[10px] px-1.5 bg-green-600">
                {product.stock} UD
              </Badge>
            )}
          </div>
          <CardContent className="p-3">
            {/* Modelo/Marca */}
            <div className="text-[10px] text-muted-foreground truncate mb-0.5">
              {product.models[0]?.model?.brand?.name} {product.models[0]?.model?.name}
            </div>

            {/* Nombre */}
            <h3 className="font-medium text-sm line-clamp-2 mb-2 min-h-[2.5rem]">
              {product.name}
            </h3>

            {/* Categoría */}
            <Badge variant="outline" className="mb-2 text-[10px] px-1.5 py-0">
              {product.category.name}
            </Badge>

            {/* Precio */}
            {product.hidePrice ? (
              isLoggedIn && isApproved ? (
                <div className="text-base font-bold text-primary">
                  {formatPrice(
                    customerType === "STORE"
                      ? product.wholesalePrice
                      : product.retailPrice
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  <span className="text-xs">Inicia sesión</span>
                </div>
              )
            ) : (
              <div className="text-base font-bold text-primary">
                {formatPrice(
                  isLoggedIn && isApproved && customerType === "STORE"
                    ? product.wholesalePrice
                    : product.retailPrice
                )}
                {isLoggedIn && isApproved && customerType === "STORE" && (
                  <span className="text-[10px] font-normal text-cyan-600 ml-1">
                    mayoreo
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
