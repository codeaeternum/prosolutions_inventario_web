"use client"

import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { Camera, ImagePlus, Link2, Loader2, QrCode, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type EvidencePhoto = {
    id: string
    label: string | null
    createdAt: string
    uploadedBy?: { name: string } | null
}

// Sección autónoma de evidencias: el padre solo pasa la orden y recarga con
// onChanged() — las fotos llegan de nuevo vía GET /api/workshop/{id}.
export function EvidenceSection(props: {
    order: { id: string; uploadToken?: string | null; photos?: EvidencePhoto[] }
    onChanged: () => void
    // Estado del enlace público (QR del sticker): "closed" = orden terminal —
    // el QR impreso ya no sirve; "expired" = venció y el admin puede
    // regenerarlo; "active" = usable (default cuando hay uploadToken).
    linkState?: "active" | "expired" | "closed"
    // Solo admin: rota el uploadToken — el enlace/QR anterior muere.
    onRotateLink?: () => void
    rotateBusy?: boolean
}) {
    const [busy, setBusy] = useState(false)
    const [label, setLabel] = useState("")
    const [qrOpen, setQrOpen] = useState(false)
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
    const [linkUrl, setLinkUrl] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)
    const photos = props.order.photos ?? []
    const linkState = props.linkState ?? "active"

    // Solo en cliente (window no existe durante el SSR de este componente).
    useEffect(() => {
        if (qrOpen && linkUrl) {
            QRCode.toDataURL(linkUrl, { width: 220, margin: 1 })
                .then(dataUrl => setQrDataUrl(dataUrl))
                .catch(() => setQrDataUrl(null))
        }
    }, [qrOpen, linkUrl])

    function openQr() {
        if (!props.order.uploadToken) return
        setLinkUrl(`${window.location.origin}/evidencia/${props.order.uploadToken}`)
        setQrOpen(true)
    }

    async function uploadFiles(files: FileList | null) {
        if (!files?.length || busy) return
        setBusy(true)
        try {
            for (const file of Array.from(files)) {
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                    toast.error(`"${file.name}" no es JPG, PNG ni WebP.`)
                    continue
                }
                if (file.size > 5 * 1024 * 1024) {
                    toast.error(`"${file.name}" pesa más de 5 MB.`)
                    continue
                }
                const form = new FormData()
                form.append("file", file)
                if (label.trim()) form.append("label", label.trim())
                const res = await fetch(`/api/workshop/${props.order.id}/photos`, { method: "POST", body: form })
                const data = await res.json().catch(() => null) as { error?: string } | null
                if (!res.ok) {
                    toast.error(data?.error ?? `No se pudo subir "${file.name}".`)
                    continue
                }
            }
            toast.success("Evidencia guardada")
            setLabel("")
            props.onChanged()
        } catch {
            toast.error("Sin conexión. Intenta de nuevo.")
        } finally {
            setBusy(false)
            if (inputRef.current) inputRef.current.value = ""
        }
    }

    async function remove(photo: EvidencePhoto) {
        if (busy) return
        if (!window.confirm(`¿Eliminar esta evidencia${photo.label ? ` (${photo.label})` : ""}?`)) return
        setBusy(true)
        try {
            const res = await fetch(`/api/workshop/${props.order.id}/photos`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ photoId: photo.id }),
            })
            const data = await res.json().catch(() => null) as { error?: string } | null
            if (!res.ok) {
                toast.error(data?.error ?? "No se pudo eliminar la evidencia.")
                return
            }
            toast.success("Evidencia eliminada")
            props.onChanged()
        } catch {
            toast.error("Sin conexión. Intenta de nuevo.")
        } finally {
            setBusy(false)
        }
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(linkUrl)
            toast.success("Enlace copiado")
        } catch {
            toast.error("No se pudo copiar el enlace")
        }
    }

    return (
        <section className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold flex items-center gap-2"><Camera size={16} />Evidencias</h2>
                <span className="text-sm text-muted-foreground">{photos.length} foto{photos.length === 1 ? "" : "s"}</span>
            </div>

            {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin evidencias todavía.</p>
            ) : (
                <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {photos.map(photo => (
                        <li key={photo.id} className="group relative">
                            <a
                                href={`/api/evidence?id=${encodeURIComponent(photo.id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block aspect-square overflow-hidden rounded-lg border bg-muted"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={`/api/evidence?id=${encodeURIComponent(photo.id)}`}
                                    alt={photo.label ?? "Evidencia"}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                />
                            </a>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void remove(photo)}
                                aria-label="Eliminar evidencia"
                                className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 focus:opacity-100"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            {(photo.label || photo.uploadedBy) && (
                                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                    {photo.label ?? ""}{photo.label && photo.uploadedBy ? " · " : ""}{photo.uploadedBy?.name ?? ""}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {/* Subida desde esta computadora */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={e => void uploadFiles(e.target.files)}
                />
                <Input
                    value={label}
                    onChange={e => setLabel(e.target.value.slice(0, 80))}
                    placeholder="Etiqueta opcional (Frente, Detalle…)"
                    className="h-9 flex-1 min-w-36 text-xs"
                    disabled={busy}
                />
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    Subir fotos
                </Button>
                {props.order.uploadToken && linkState === "active" && (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={openQr}>
                        <QrCode className="h-4 w-4" />
                        QR para celular
                    </Button>
                )}
                {props.onRotateLink && linkState !== "closed" && (
                    <Button type="button" size="sm" variant="outline" disabled={busy || props.rotateBusy} onClick={props.onRotateLink}>
                        {props.rotateBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Regenerar link
                    </Button>
                )}
            </div>

            {/* Aviso del estado del enlace público: en orden cerrada el QR
                impreso ya murió; si solo venció, el admin lo regenera arriba. */}
            {linkState === "closed" && (
                <p className="text-xs text-muted-foreground">
                    El enlace público de evidencias está inactivo: la orden está cerrada y el QR impreso ya no funciona.
                </p>
            )}
            {linkState === "expired" && (
                <p className="text-xs text-muted-foreground">
                    El enlace público de evidencias expiró.{props.onRotateLink ? " Usa «Regenerar link» para emitir uno nuevo." : ""}
                </p>
            )}

            {/* QR del enlace público de subida */}
            <Dialog open={qrOpen} onOpenChange={setQrOpen}>
                <DialogContent className="max-w-xs text-center">
                    <DialogHeader>
                        <DialogTitle>Subir fotos desde el celular</DialogTitle>
                        <DialogDescription>
                            Escanea el código o comparte el enlace. No requiere iniciar sesión.
                        </DialogDescription>
                    </DialogHeader>
                    {qrDataUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qrDataUrl} alt="QR del enlace de evidencias" className="mx-auto h-48 w-48 rounded-lg border" />
                    )}
                    <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {linkUrl}
                    </p>
                    <Button type="button" variant="outline" size="sm" className="mx-auto" onClick={() => void copyLink()}>
                        <Link2 className="h-4 w-4" />
                        Copiar enlace
                    </Button>
                </DialogContent>
            </Dialog>
        </section>
    )
}
