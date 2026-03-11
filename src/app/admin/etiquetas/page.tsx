"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
    QrCode,
    Search,
    Printer,
    Loader2,
    Package,
    CheckSquare,
    Square,
} from "lucide-react"
import { toast } from "sonner"
import { QRCodeSVG } from "qrcode.react"
import { useCurrency } from "@/components/currency-provider"

interface Product {
    id: string
    name: string
    barcode: string | null
    retailPrice: number
    stock: number
}

export default function EtiquetasPage() {
    const { formatPrice } = useCurrency()
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
    const [labelSize, setLabelSize] = useState<"small" | "medium" | "large">("medium")
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const printRef = useRef<HTMLDivElement>(null)

    const [showPrice, setShowPrice] = useState(true)
    const [showName, setShowName] = useState(true)
    const [showBarcode, setShowBarcode] = useState(true)

    const fetchProducts = async (pageNum: number = 1) => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set("page", String(pageNum))
            params.set("limit", "50")
            if (searchQuery.trim()) params.set("search", searchQuery.trim())
            const res = await fetch(`/api/products?${params}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Error al cargar productos")
            const mapped = (data.products || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                barcode: p.barcode ?? null,
                retailPrice: p.retailPrice ?? 0,
                stock: p.stock ?? 0
            }))
            setProducts(mapped)
            setTotalPages(data.totalPages ?? 1)
        } catch (error) {
            console.error("Error fetching products:", error)
            setProducts([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchProducts(page)
    }, [page, searchQuery])

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setPage(1)
        fetchProducts(1)
    }

    /** Escapa HTML para evitar XSS al inyectar nombre/código en la ventana de impresión. */
    const escapeHtml = (str: string) =>
        str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")

    const toggleProduct = (productId: string) => {
        setSelectedProducts(prev => {
            const next = new Set(prev)
            if (next.has(productId)) {
                next.delete(productId)
            } else {
                next.add(productId)
            }
            return next
        })
    }

    const selectAll = () => {
        setSelectedProducts(new Set(products.map(p => p.id)))
    }

    const selectNone = () => {
        setSelectedProducts(new Set())
    }

    const handlePrint = () => {
        const printContent = printRef.current
        if (!printContent) return

        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            toast.error("Por favor permite las ventanas emergentes (pop-ups) para imprimir")
            return
        }

        const sizeStyles = {
            small: { width: '3cm', height: '3cm', qrSize: 50, fontSize: '7px', padding: '2px' },
            medium: { width: '5cm', height: '5cm', qrSize: 80, fontSize: '10px', padding: '6px' },
            large: { width: '7cm', height: '7cm', qrSize: 120, fontSize: '12px', padding: '8px' },
        }
        const size = sizeStyles[labelSize]

        // Importamos QRCode dinámicamente para no bloquear el render inicial
        import('qrcode').then(async (QRCode) => {
            // Generar las imágenes QR en base64 para inyectarlas en el HTML
            const labelsHtmlPromise = Array.from(selectedProducts).map(async (id) => {
                const product = products.find(p => p.id === id)
                if (!product) return ''
                
                const qrValue = product.barcode || product.id
                const safeName = escapeHtml(product.name)
                const safeBarcode = product.barcode ? escapeHtml(product.barcode) : ""
                
                // Generar QR localmente como Data URL
                const qrDataUrl = await QRCode.default.toDataURL(qrValue, {
                    width: size.qrSize,
                    margin: 1,
                })

                return `
                    <div class="label">
                        ${showName ? `<div class="label-name">${safeName}</div>` : ""}
                        <div class="qr-container">
                            <img src="${qrDataUrl}" width="${size.qrSize}" height="${size.qrSize}" />
                        </div>
                        ${showPrice ? `<div class="label-price">${formatPrice(product.retailPrice)}</div>` : ""}
                        ${showBarcode && safeBarcode ? `<div class="label-code">${safeBarcode}</div>` : ""}
                    </div>
                `
            })

            const labelsHtmlArray = await Promise.all(labelsHtmlPromise)
            const labelsHtml = labelsHtmlArray.join('')

            printWindow.document.write(`
                <html>
                <head>
                    <title>Etiquetas de Productos</title>
                    <style>
                    @page { margin: 5mm; }
                    body { margin: 0; font-family: Arial, sans-serif; }
                    .labels-container { 
                        display: flex; 
                        flex-wrap: wrap; 
                        gap: 5mm;
                        justify-content: flex-start;
                    }
                    :root {
                        --print-border: 0 0% 92%;
                        --print-success: 142 76% 36%;
                        --print-muted: 0 0% 40%;
                    }
                    .label {
                        width: ${size.width};
                        height: ${size.height};
                        border: 1px solid hsl(var(--print-border));
                        padding: ${size.padding};
                        text-align: center;
                        page-break-inside: avoid;
                        box-sizing: border-box;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                    }
                    .label-name {
                        font-size: ${size.fontSize};
                        font-weight: bold;
                        margin-bottom: 4px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    }
                    .label-price {
                        font-size: calc(${size.fontSize} + 2px);
                        font-weight: bold;
                        color: hsl(var(--print-success));
                        margin-top: 4px;
                    }
                    .label-code {
                        font-size: calc(${size.fontSize} - 1px);
                        color: hsl(var(--print-muted));
                        margin-top: 2px;
                    }
                    .qr-container {
                        display: flex;
                        justify-content: center;
                        margin: 4px 0;
                    }
                </style>
            </head>
            <body>
                <div class="labels-container">
                    ${labelsHtml}
                </div>
                <script>
                    window.onload = function() { window.print(); window.close(); }
                </script>
            </body>
            </html>
        `)
        printWindow.document.close()
    })
}

    const selectedProductsData = products.filter(p => selectedProducts.has(p.id))

    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <QrCode className="h-6 w-6" />
                        Etiquetas QR
                    </h1>
                    <p className="text-muted-foreground">
                        Genera etiquetas con código QR para pegar en los productos
                    </p>
                </div>
                <Button
                    onClick={handlePrint}
                    disabled={selectedProducts.size === 0}
                    size="lg"
                >
                    <Printer className="h-5 w-5 mr-2" />
                    Imprimir ({selectedProducts.size})
                </Button>
            </div>

            {/* Options */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar productos..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <Button type="submit" variant="secondary">
                                Buscar
                            </Button>
                        </form>

                        <div className="flex items-center gap-2">
                            <Label className="text-sm whitespace-nowrap">Tamaño:</Label>
                            <div className="flex gap-1">
                                {(["small", "medium", "large"] as const).map(size => (
                                    <Button
                                        key={size}
                                        variant={labelSize === size ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setLabelSize(size)}
                                    >
                                        {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4 items-center">
                        <Button variant="outline" size="sm" onClick={selectAll}>
                            <CheckSquare className="h-4 w-4 mr-1" />
                            Seleccionar todos
                        </Button>
                        <Button variant="outline" size="sm" onClick={selectNone}>
                            <Square className="h-4 w-4 mr-1" />
                            Deseleccionar
                        </Button>
                        <div className="border-l mx-2 h-6" />
                        <div className="flex items-center gap-4 text-sm">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <Checkbox checked={showName} onCheckedChange={(c) => setShowName(!!c)} />
                                Nombre
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <Checkbox checked={showPrice} onCheckedChange={(c) => setShowPrice(!!c)} />
                                Precio
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <Checkbox checked={showBarcode} onCheckedChange={(c) => setShowBarcode(!!c)} />
                                Código/SKU
                            </label>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Preview */}
            {selectedProducts.size > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Vista previa ({selectedProducts.size} etiquetas)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div ref={printRef} className="flex flex-wrap gap-4">
                            {selectedProductsData.slice(0, 6).map(product => (
                                <div
                                    key={product.id}
                                    className="border rounded-lg p-3 text-center bg-white"
                                    style={{ width: labelSize === "small" ? 120 : labelSize === "medium" ? 150 : 180 }}
                                >
                                    {showName && <p className="text-xs font-medium line-clamp-2 mb-2">{product.name}</p>}
                                    <QRCodeSVG
                                        value={product.barcode || product.id}
                                        size={labelSize === "small" ? 60 : labelSize === "medium" ? 80 : 100}
                                        className="mx-auto"
                                    />
                                    {showPrice && (
                                        <p className="text-sm font-bold text-green-600 mt-2">
                                            {formatPrice(product.retailPrice)}
                                        </p>
                                    )}
                                    {showBarcode && product.barcode && (
                                        <p className="text-[10px] text-muted-foreground">{product.barcode}</p>
                                    )}
                                </div>
                            ))}
                            {selectedProducts.size > 6 && (
                                <div className="flex items-center justify-center border rounded-lg p-3 bg-muted/50" style={{ width: 150 }}>
                                    <span className="text-sm text-muted-foreground">
                                        +{selectedProducts.size - 6} más
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Products List */}
            <Card>
                <CardHeader>
                    <CardTitle>Productos</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : products.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No se encontraron productos</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {products.map(product => (
                                <div
                                    key={product.id}
                                    className={`flex items-center gap-4 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${selectedProducts.has(product.id) ? "bg-primary/5 border-primary" : ""
                                        }`}
                                    onClick={() => toggleProduct(product.id)}
                                >
                                    <Checkbox
                                        checked={selectedProducts.has(product.id)}
                                        onCheckedChange={() => toggleProduct(product.id)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{product.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {product.barcode || "Sin código"} • Stock: {product.stock}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-green-600">{formatPrice(product.retailPrice)}</p>
                                    </div>
                                    <QRCodeSVG
                                        value={product.barcode || product.id}
                                        size={40}
                                        className="hidden sm:block"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    {totalPages > 1 && !loading && (
                        <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                            >
                                Anterior
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                Página {page} de {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                            >
                                Siguiente
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
