"use client"

import { useState, useCallback, useRef } from "react"
import { X, ImagePlus, Loader2 } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface ImageUploadProps {
  images: string[]
  onChange: (images: string[]) => void
  maxImages?: number
  className?: string
  /** Si true, sube archivos al servidor (recomendado para productos). Si false, usa base64 (solo para comprobantes pequeños). */
  uploadToServer?: boolean
  uploadEndpoint?: string
  onUploadingChange?: (uploading: boolean) => void
  disabled?: boolean
  /** Tira horizontal compacta (thumbnails + botón agregar) en vez del dropzone grande. */
  compact?: boolean
}

export function ImageUpload({
  images,
  onChange,
  maxImages = 5,
  className,
  uploadToServer = true,
  uploadEndpoint = "/api/upload/product",
  onUploadingChange,
  disabled = false,
  compact = false,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Reorden de thumbnails (variante compact): cuál se arrastra y sobre cuál está.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const uploadingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || disabled || uploadingRef.current || images.length >= maxImages) return
      const filesToProcess = Array.from(files).slice(0, maxImages - images.length)
      if (filesToProcess.some((file) => !file.type.startsWith("image/"))) {
        setUploadError("Selecciona archivos de imagen válidos.")
        if (fileInputRef.current) fileInputRef.current.value = ""
        return
      }
      uploadingRef.current = true
      setUploading(true)
      onUploadingChange?.(true)
      setUploadError(null)
      const newImages: string[] = []
      try {
        for (const file of filesToProcess) {
          if (uploadToServer) {
            const formData = new FormData()
            formData.append("file", file)
            const res = await fetch(uploadEndpoint, { method: "POST", body: formData })
            const data = await res.json().catch(() => null)
            if (!res.ok || !data?.url) throw new Error(data?.error || "No se pudo subir la imagen. Vuelve a seleccionarla para reintentar.")
            newImages.push(data.url)
          } else {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = () => reject(new Error("No se pudo leer la imagen"))
              reader.readAsDataURL(file)
            })
            newImages.push(base64)
          }
        }
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "No se pudo subir la imagen. Revisa tu conexión y reintenta.")
      } finally {
        if (newImages.length) onChange([...images, ...newImages])
        if (fileInputRef.current) fileInputRef.current.value = ""
        uploadingRef.current = false
        setUploading(false)
        onUploadingChange?.(false)
      }
    },
    [images, maxImages, onChange, uploadToServer, uploadEndpoint, onUploadingChange, disabled]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    // El anillo solo cuando vienen archivos; al reordenar thumbnails no aplica.
    if (e.dataTransfer.types.includes("Files")) setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  // Reorden por drag de las fotos ya subidas (solo compact): el primer elemento
  // del array es la foto principal, así que basta moverlo dentro de `images`.
  const moveImage = (from: number, to: number) => {
    if (from === to) return
    const next = [...images]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const handleThumbDragStart = (e: React.DragEvent, index: number) => {
    setDraggingIndex(index)
    e.dataTransfer.effectAllowed = "move"
    // Firefox no inicia el drag sin setData.
    e.dataTransfer.setData("text/plain", String(index))
  }

  const handleThumbDragOver = (e: React.DragEvent, index: number) => {
    // draggingIndex null = se arrastran archivos, no un thumbnail: lo maneja el contenedor.
    if (draggingIndex === null) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    setDropTargetIndex(index === draggingIndex ? null : index)
  }

  const handleThumbDrop = (e: React.DragEvent, index: number) => {
    if (draggingIndex === null) return
    e.preventDefault()
    e.stopPropagation()
    moveImage(draggingIndex, index)
    setDraggingIndex(null)
    setDropTargetIndex(null)
  }

  const handleThumbDragEnd = () => {
    setDraggingIndex(null)
    setDropTargetIndex(null)
  }

  const removeImage = (index: number) => {
    const newImages = [...images]
    newImages.splice(index, 1)
    onChange(newImages)
  }

  const openFileDialog = () => {
    if (!disabled && !uploadingRef.current) fileInputRef.current?.click()
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple={maxImages > 1}
      disabled={disabled || uploading}
      onChange={(e) => handleFiles(e.target.files)}
      className="hidden"
    />
  )

  if (compact) {
    return (
      <div className={cn("space-y-2", className)}>
        {fileInput}
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg transition-colors",
            dragOver && "ring-2 ring-primary/50"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {images.map((image, index) => (
            <div
              key={index}
              draggable={!disabled && !uploading}
              onDragStart={(e) => handleThumbDragStart(e, index)}
              onDragOver={(e) => handleThumbDragOver(e, index)}
              onDrop={(e) => handleThumbDrop(e, index)}
              onDragEnd={handleThumbDragEnd}
              title={images.length > 1 ? "Arrastra para reordenar" : undefined}
              className={cn(
                "relative h-16 w-16 shrink-0 rounded-md overflow-hidden bg-muted group",
                !disabled && !uploading && "cursor-grab",
                draggingIndex === index && "opacity-40",
                dropTargetIndex === index && "ring-2 ring-primary"
              )}
            >
              <Image
                src={image}
                alt={`Imagen ${index + 1}`}
                fill
                sizes="64px"
                className="object-cover"
                unoptimized={image.startsWith("/api/payment-proofs/") || image.startsWith("/uploads/payments/")}
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute top-0.5 right-0.5 p-0.5 bg-destructive text-destructive-foreground rounded-full shadow-sm hover:bg-destructive/90 transition-colors"
                title="Eliminar imagen"
                aria-label={`Eliminar imagen ${index + 1}`}
                disabled={disabled || uploading}
              >
                <X className="h-3 w-3" />
              </button>
              {index === 0 && (
                <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 py-px bg-primary text-primary-foreground rounded">
                  Principal
                </span>
              )}
            </div>
          ))}
          {images.length < maxImages && (
            <button
              type="button"
              onClick={openFileDialog}
              disabled={disabled || uploading}
              className={cn(
                "flex h-16 min-w-28 items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-3 text-xs transition-colors",
                "border-muted-foreground/25 text-muted-foreground hover:border-primary/50 hover:bg-muted/50 hover:text-foreground",
                (disabled || uploading) && "cursor-not-allowed opacity-50"
              )}
              title="Arrastra imágenes aquí o haz clic"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" />
                  {images.length === 0 ? "Agregar fotos" : `${images.length}/${maxImages}`}
                </>
              )}
            </button>
          )}
        </div>
        {uploadError && (
          <p role="alert" className="text-xs text-destructive">{uploadError}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Preview Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {images.map((image, index) => (
            <div
              key={index}
              className="relative aspect-square rounded-lg overflow-hidden bg-muted group"
            >
              <Image
                src={image}
                alt={`Imagen ${index + 1}`}
                fill
                sizes="(max-width: 640px) 33vw, 20vw"
                className="object-cover"
                unoptimized={image.startsWith("/api/payment-proofs/") || image.startsWith("/uploads/payments/")}
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full shadow-sm hover:bg-destructive/90 transition-colors"
                title="Eliminar imagen"
                aria-label={`Eliminar imagen ${index + 1}`}
                disabled={disabled || uploading}
              >
                <X className="h-4 w-4" />
              </button>
              {index === 0 && (
                <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground rounded">
                  Principal
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload Area */}
      {images.length < maxImages && (
        <div
          role="button"
          tabIndex={disabled || uploading ? -1 : 0}
          aria-label="Seleccionar imágenes"
          aria-disabled={disabled || uploading}
          aria-busy={uploading}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFileDialog() } }}
          onClick={openFileDialog}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
          )}
        >
          {fileInput}

          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Procesando...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 rounded-full bg-muted">
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  Arrastra imágenes aquí o haz clic para seleccionar
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {images.length} de {maxImages} imágenes
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {images.length >= maxImages && (
        <p className="text-xs text-muted-foreground text-center">
          Máximo de {maxImages} imágenes alcanzado
        </p>
      )}
      {uploadError && (
        <p role="alert" className="text-xs text-destructive text-center">{uploadError}</p>
      )}
    </div>
  )
}
