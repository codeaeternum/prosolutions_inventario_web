"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Eraser } from "lucide-react"

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  label?: string
  // Texto bajo el canvas; por defecto es el de recepción (aceptación de
  // condiciones). La entrega del equipo pasa su propio texto.
  hint?: string
}

// Canvas de firma del cliente. Devuelve PNG base64 (o null si está vacío).
export function SignaturePad({ onChange, label = "Firma del cliente", hint = "Al firmar, el cliente acepta las condiciones y el estado reportado del equipo." }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)

  const emit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(isEmpty ? null : canvas.toDataURL("image/png"))
  }, [isEmpty, onChange])

  useEffect(() => { emit() }, [emit])

  const point = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const ctx = () => canvasRef.current!.getContext("2d")!

  const start = (e: React.PointerEvent) => {
    drawing.current = true
    const c = ctx()
    c.strokeStyle = "#e4e4e7"
    c.lineWidth = 2.5
    c.lineCap = "round"
    c.lineJoin = "round"
    const p = point(e)
    c.beginPath()
    c.moveTo(p.x, p.y)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const c = ctx()
    const p = point(e)
    c.lineTo(p.x, p.y)
    c.stroke()
    if (isEmpty) setIsEmpty(false)
  }

  const end = () => { drawing.current = false; emit() }

  const clear = () => {
    const canvas = canvasRef.current!
    ctx().clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={isEmpty}>
          <Eraser className="h-4 w-4 mr-1" /> Limpiar
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={640}
        height={200}
        className="w-full h-32 rounded-lg border border-dashed bg-muted/30 touch-none cursor-crosshair"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <p className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}
