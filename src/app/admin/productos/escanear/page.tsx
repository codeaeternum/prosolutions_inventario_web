"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BarcodeScanner } from "@/components/barcode-scanner"
import { ArrowLeft, Search, Loader2, Package, Plus } from "lucide-react"
import { EmptyState } from "@/components/admin/empty-state"
import { useCurrency } from "@/components/currency-provider"

interface Product {
  id: string
  name: string
  barcode: string
  retailPrice: number
  stock: number
}

export default function ScanProductPage() {
  const { formatPrice } = useCurrency()
  const router = useRouter()
  const [scannedCode, setScannedCode] = useState("")
  const [manualCode, setManualCode] = useState("")
  const [searching, setSearching] = useState(false)
  const [product, setProduct] = useState<Product | null>(null)
  const [notFound, setNotFound] = useState(false)

    const searchProduct = async (code: string) => {
    setSearching(true)
    setNotFound(false)
    setProduct(null)

    try {
      const res = await fetch(`/api/search/pos?q=${encodeURIComponent(code)}`)
      const data = await res.json()
      const products = Array.isArray(data.products) ? data.products : []

      if (products.length > 0) {
        // Find exact barcode match
        const exactMatch = products.find((p: Product) => p.barcode === code)
        if (exactMatch) {
          setProduct(exactMatch)
        } else {
          setProduct(products[0])
        }
      } else {
        setNotFound(true)
      }
    } catch (error) {
      console.error("Error searching product:", error)
    } finally {
      setSearching(false)
    }
  }

  const handleScan = (code: string) => {
    setScannedCode(code)
    setManualCode(code)
    searchProduct(code)
  }

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (manualCode) {
      setScannedCode(manualCode)
      searchProduct(manualCode)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/productos">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Escanear Producto</h2>
          <p className="text-muted-foreground">
            Escanea o ingresa un código de barras
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Scanner */}
        <BarcodeScanner onScan={handleScan} />

        {/* Manual Search */}
        <Card>
          <CardHeader>
            <CardTitle>Búsqueda Manual</CardTitle>
            <CardDescription>
              Ingresa el código de barras manualmente
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleManualSearch} className="flex gap-2 w-full">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Código de barras..."
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={searching}>
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Result */}
      {scannedCode && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado: {scannedCode}</CardTitle>
          </CardHeader>
          <CardContent>
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : product ? (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{product.name}</h3>
                  <p className="text-muted-foreground">
                    Stock: {product.stock} UD
                  </p>
                  <p className="text-primary font-bold">
                    {formatPrice(product.retailPrice)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <Link href={`/admin/productos/${product.id}`}>
                      Ver Detalles
                    </Link>
                  </Button>
                </div>
              </div>
            ) : notFound ? (
              <EmptyState 
                icon={Package} 
                title="Producto no encontrado" 
                description="No se encontró ningún producto con este código." 
                action={{ label: "Crear Producto con este código", href: `/admin/productos/nuevo?barcode=${scannedCode}`, icon: Plus }} 
              />
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
