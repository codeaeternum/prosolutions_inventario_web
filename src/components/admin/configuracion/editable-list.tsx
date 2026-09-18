"use client"

import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Mismos valores por defecto que el servidor (src/app/api/workshop-config/route.ts).
export const DEFAULT_EQUIPMENT_TYPES = ["Celular", "Tablet", "Laptop", "Computadora", "Consola", "Smartwatch", "Pantalla", "Impresora", "Otro"]
export const DEFAULT_LOCATIONS = ["Recepción", "Mesa 1", "Mesa 2", "Anaquel A", "Anaquel B"]

export function EditableList({ title, description, items, draft, onDraft, onAdd, onRemove, placeholder, maxLength, disabled, readOnly = false }: {
  title: string; description: string; items: string[]; draft: string
  onDraft: (value: string) => void; onAdd: () => void; onRemove: (item: string) => void
  placeholder: string; maxLength: number; disabled: boolean
  /** Solo lectura: muestra la lista sin controles de agregar/quitar (p. ej. empleados). */
  readOnly?: boolean
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Sin elementos.</p>}
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-3 py-1 text-sm">
            {item}
            {!readOnly && (
              <button type="button" aria-label={`Quitar ${item}`} disabled={disabled} onClick={() => onRemove(item)} className="rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-50">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!readOnly && (
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); onAdd() }}>
          <Input value={draft} onChange={event => onDraft(event.target.value)} maxLength={maxLength} placeholder={placeholder} disabled={disabled} className="max-w-xs" />
          <Button type="submit" variant="outline" disabled={disabled || !draft.trim()}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
        </form>
      )}
    </div>
  )
}
