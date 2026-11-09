"use client"

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Check, Loader2, X } from "lucide-react"

interface InlineNameEditorProps {
  /** Nombre actual de la entidad: precarga el input y nombra los controles. */
  currentName: string
  /** PATCH del padre; resuelve `true` cuando el rename se aplicó (el editor se cierra). */
  onSave: (name: string) => Promise<boolean>
  /** Sale del modo edición: lo llaman Escape, el botón ✕ y un guardado exitoso. */
  onClose: () => void
}

/**
 * Rename inline para las tarjetas de catálogo (marcas, modelos, categorías):
 * el lápiz convierte el nombre en input — Enter/✓ guarda, Escape/✕ cancela.
 * El foco entra al montar con el texto seleccionado para reescribir de una;
 * Guardar queda deshabilitado mientras el PATCH está en vuelo.
 *
 * Escape lleva stopPropagation: los paneles viven dentro del Dialog de
 * Clasificación (stock-panel) y sin él la tecla también cerraría el diálogo
 * padre en vez de solo cancelar la edición.
 */
export function InlineNameEditor({ currentName, onSave, onClose }: InlineNameEditorProps) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const trimmed = name.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !trimmed) return
    setSaving(true)
    try {
      if (await onSave(trimmed)) onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={80}
        disabled={saving}
        aria-label={`Nuevo nombre para ${currentName}`}
        className="h-8 min-w-0 flex-1 text-sm"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="shrink-0"
        disabled={saving || !trimmed}
        aria-label="Guardar nombre"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={onClose}
        disabled={saving}
        aria-label="Cancelar edición"
      >
        <X className="h-4 w-4" />
      </Button>
    </form>
  )
}
