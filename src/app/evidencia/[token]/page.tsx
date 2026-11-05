"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { Camera, ImagePlus, Loader2, AlertCircle, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DocumentShell } from "@/components/public/document-shell"
import { repairFolio } from "@/lib/workshop-labels"
import { formatDate } from "@/lib/utils"

interface EvidencePhoto {
  id: string
  label: string | null
  createdAt: string
}

interface PendingFile {
  file: File
  preview: string
  status: "pending" | "uploading" | "done" | "error"
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 5 * 1024 * 1024
const LABEL_SUGGESTIONS = ["Frente", "Trasera", "Detalle", "Pantalla", "Antes", "Después"]

export default function EvidenciaPage() {
  return (
    <DocumentShell>
      <EvidenceUploader />
    </DocumentShell>
  )
}

function EvidenceUploader() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [expired, setExpired] = useState(false)
  const [folio, setFolio] = useState("")
  const [photos, setPhotos] = useState<EvidencePhoto[]>([])
  const [pending, setPending] = useState<PendingFile[]>([])
  const [label, setLabel] = useState("")
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const previewsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    // token viene del segmento dinámico; si no existiera, el fetch da 404 → invalid.
    fetch(`/api/evidencia/${encodeURIComponent(token ?? "")}`)
      .then(async res => {
        if (cancelled) return
        // 410 = el token existe pero ya no está vigente: se muestra un
        // mensaje distinto al 404 genérico de enlace inválido.
        if (res.status === 410) { setExpired(true); return }
        if (!res.ok) { setInvalid(true); return }
        const data = await res.json() as { orderNumber: number; folio?: string; photos: EvidencePhoto[] }
        // El API ya manda el folio con el formato del negocio (prefijo +
        // dígitos configurados); repairFolio queda como respaldo de respuestas
        // anteriores al campo.
        setFolio(data.folio ?? repairFolio(data.orderNumber))
        setPhotos(data.photos)
      })
      .catch(() => { if (!cancelled) setInvalid(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  // Liberar las URLs de previsualización solo al desmontar.
  useEffect(() => () => previewsRef.current.forEach(url => URL.revokeObjectURL(url)), [])

  function addFiles(files: FileList | null) {
    if (!files?.length) return
    const next: PendingFile[] = []
    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" no es JPG, PNG ni WebP.`)
        continue
      }
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" pesa más de 5 MB.`)
        continue
      }
      const preview = URL.createObjectURL(file)
      previewsRef.current.add(preview)
      next.push({ file, preview, status: "pending" })
    }
    if (next.length) setPending(prev => [...prev, ...next])
    if (inputRef.current) inputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""
  }

  function revoke(preview: string) {
    previewsRef.current.delete(preview)
    URL.revokeObjectURL(preview)
  }

  function removePending(index: number) {
    setPending(prev => {
      const copy = [...prev]
      const [removed] = copy.splice(index, 1)
      if (removed) revoke(removed.preview)
      return copy
    })
  }

  async function uploadAll() {
    if (uploading || pending.length === 0) return
    setUploading(true)
    try {
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i]
        if (item.status === "done" || item.status === "uploading") continue
        setPending(prev => prev.map((p, j) => j === i ? { ...p, status: "uploading" } : p))
        const form = new FormData()
        form.append("file", item.file)
        if (label.trim()) form.append("label", label.trim())
        try {
          const res = await fetch(`/api/evidencia/${encodeURIComponent(token)}`, { method: "POST", body: form })
          const data = await res.json().catch(() => null) as { photo?: EvidencePhoto; error?: string } | null
          if (!res.ok || !data?.photo) {
            setPending(prev => prev.map((p, j) => j === i ? { ...p, status: "error" } : p))
            // Si el link venció a media subida, la vista completa cambia al aviso.
            if (res.status === 410) setExpired(true)
            toast.error(data?.error ?? `No se pudo subir "${item.file.name}".`)
            continue
          }
          setPending(prev => prev.map((p, j) => j === i ? { ...p, status: "done" } : p))
          setPhotos(prev => [...prev, data.photo!])
        } catch {
          setPending(prev => prev.map((p, j) => j === i ? { ...p, status: "error" } : p))
          toast.error("Sin conexión. Revisa tu internet e intenta de nuevo.")
        }
      }
      toast.success("Fotos subidas correctamente.")
    } finally {
      setUploading(false)
      // Conserva los que fallaron (reintento) y los agregados durante la subida.
      setPending(prev => {
        const keep = prev.filter(p => p.status === "error" || p.status === "pending")
        prev.filter(p => !keep.includes(p)).forEach(p => revoke(p.preview))
        return keep.map(p => p.status === "error" ? { ...p, status: "pending" as const } : p)
      })
    }
  }

  const pendingCount = pending.filter(p => p.status !== "done").length

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-10 pb-20">
      <div className="text-center space-y-4 mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
          <Camera className="h-4 w-4" />
          Evidencia fotográfica
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Subir fotos del equipo</h1>
        {folio && <p className="text-muted-foreground">Orden <span className="font-semibold text-foreground">{folio}</span></p>}
      </div>

      {loading ? (
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      ) : expired ? (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="font-semibold text-lg">Este link expiró</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            El enlace para subir fotos ya no está vigente. Contacta al taller para pedir uno nuevo.
          </p>
        </div>
      ) : invalid ? (
        <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="font-semibold text-lg">Enlace no válido o expirado</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Escanea de nuevo el código QR del ticket de la orden o pide al taller un enlace nuevo.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Uploader */}
          <div className="rounded-xl border bg-card p-6 space-y-4 shadow-sm">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
            <div className="space-y-1.5">
              <label htmlFor="label" className="text-sm font-medium">Etiqueta (opcional)</label>
              <Input
                id="label"
                value={label}
                onChange={e => setLabel(e.target.value.slice(0, 80))}
                placeholder="Ej. Frente, Detalle, Pantalla…"
                list="evidence-labels"
                autoComplete="off"
                className="h-11"
              />
              <datalist id="evidence-labels">
                {LABEL_SUGGESTIONS.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Button
                type="button"
                variant="default"
                className="h-auto py-6 rounded-xl flex-col gap-2"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="h-7 w-7" />
                <span className="text-sm font-medium">Tomar foto con cámara</span>
              </Button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed p-6 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors flex flex-col items-center justify-center"
              >
                <ImagePlus className="h-7 w-7 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Elegir de galería o archivos</p>
                <p className="mt-1 text-xs text-muted-foreground">JPG, PNG o WebP · máximo 5 MB por foto</p>
              </button>
            </div>

            {/* Previsualización */}
            {pending.length > 0 && (
              <div className="space-y-3">
                <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {pending.map((item, i) => (
                    <li key={i} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt="" className="h-full w-full object-cover" />
                      {item.status === "uploading" && (
                        <span className="absolute inset-0 grid place-items-center bg-black/50">
                          <Loader2 className="h-5 w-5 animate-spin text-white" />
                        </span>
                      )}
                      {item.status === "done" && (
                        <span className="absolute inset-0 grid place-items-center bg-emerald-600/60">
                          <Check className="h-5 w-5 text-white" />
                        </span>
                      )}
                      {item.status === "error" && (
                        <span className="absolute inset-0 grid place-items-center bg-destructive/60">
                          <AlertCircle className="h-5 w-5 text-white" />
                        </span>
                      )}
                      {!uploading && item.status !== "done" && (
                        <button
                          type="button"
                          onClick={() => removePending(i)}
                          aria-label="Quitar foto"
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <Button size="lg" className="w-full gap-2" onClick={() => void uploadAll()} disabled={uploading || pendingCount === 0}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {uploading ? "Subiendo…" : `Subir ${pendingCount} foto${pendingCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            )}
          </div>

          {/* Fotos ya subidas */}
          {photos.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h2 className="text-sm font-semibold mb-3">Fotos subidas ({photos.length})</h2>
              <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {photos.map(photo => (
                  <li key={photo.id} className="space-y-1">
                    <a
                      href={`/api/evidence?id=${encodeURIComponent(photo.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square overflow-hidden rounded-lg border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/evidence?id=${encodeURIComponent(photo.id)}`} alt={photo.label ?? "Evidencia"} loading="lazy" className="h-full w-full object-cover" />
                    </a>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {photo.label ? `${photo.label} · ` : ""}{formatDate(photo.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Las fotos quedan ligadas a la orden y las puede ver el taller y el cliente en el rastreo.
          </p>
        </div>
      )}
    </section>
  )
}
