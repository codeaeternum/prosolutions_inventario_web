"use client"

import { useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { X, Upload, ImagePlus, Loader2 } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface ImageUploadProps {
  images: string[]
  onChange: (images: string[]) => void
  maxImages?: number
  className?: string
  /** Si true, sube archivos al servidor (recomendado para productos). Si false, usa base64 (solo para comprobantes pequeños). */
  uploadToServer?: boolean
}

export function ImageUpload({
  images,
  onChange,
  maxImages = 5,
  className,
  uploadToServer = true,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      if (images.length >= maxImages) return

      setUploading(true)
      setUploadError(null)

      const remainingSlots = maxImages - images.length
      const filesToProcess = Array.from(files).slice(0, remainingSlots).filter((f) =>
        f.type.startsWith("image/")
      )

      const newImages: string[] = []

      if (uploadToServer) {
        for (const file of filesToProcess) {
          try {
            const formData = new FormData()
            formData.append("file", file)
            const res = await fetch("/api/upload/product", {
              method: "POST",
              body: formData,
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Error al subir")
            if (data.url) newImages.push(data.url)
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Error al subir la imagen"
            setUploadError(msg)
            break
          }
        }
      } else {
        for (const file of filesToProcess) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
          })
          newImages.push(base64)
        }
      }

      if (newImages.length > 0) onChange([...images, ...newImages])
      setUploading(false)
    },
    [images, maxImages, onChange, uploadToServer]
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
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

  const removeImage = (index: number) => {
    const newImages = [...images]
    newImages.splice(index, 1)
    onChange(newImages)
  }

  const openFileDialog = () => {
    fileInputRef.current?.click()
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
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full shadow-sm hover:bg-destructive/90 transition-colors"
                title="Eliminar imagen"
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />

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
        <p className="text-xs text-destructive text-center">{uploadError}</p>
      )}
    </div>
  )
}
