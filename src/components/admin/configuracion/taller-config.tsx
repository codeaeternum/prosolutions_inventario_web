"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { DEFAULT_WARRANTY_DAYS, MAX_WARRANTY_DAYS, repairLabels } from "@/lib/workshop-labels"
import { DEFAULT_SLA_HOURS, readSlaHours, SLA_STAGES, type SlaHours, type SlaStage } from "@/lib/workshop-config"
import { DEFAULT_EQUIPMENT_TYPES, DEFAULT_LOCATIONS, EditableList } from "./editable-list"

export interface WorkshopConfig {
  equipmentTypes: string[]
  locations: string[]
  // Vigencia de la garantía en días al reingresar un equipo entregado.
  warrantyDays: number
  // Semáforo del taller: horas máximas por etapa activa sin movimiento.
  slaHours: SlaHours
}

// Borradores en texto para los inputs del SLA: permiten vacío mientras se
// teclea y se validan como enteros al guardar.
const slaTextOf = (hours: SlaHours): Record<SlaStage, string> =>
  Object.fromEntries(SLA_STAGES.map(stage => [stage, String(hours[stage])])) as Record<SlaStage, string>

/**
 * Editor autocontenido de las listas del taller (tipos de equipo y locaciones).
 * Carga y guarda contra GET/POST /api/workshop-config.
 * `onConfigChange` se invoca tras cargar y tras cada guardado para que el
 * consumidor pueda sincronizar su propio estado (datalists, filtros, etc.).
 */
export function WorkshopConfigEditor({ onConfigChange, readOnly = false }: { onConfigChange?: (config: WorkshopConfig) => void; readOnly?: boolean }) {
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>(DEFAULT_EQUIPMENT_TYPES)
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS)
  const [warrantyDaysDraft, setWarrantyDaysDraft] = useState(String(DEFAULT_WARRANTY_DAYS))
  const [slaDraft, setSlaDraft] = useState<Record<SlaStage, string>>(() => slaTextOf(DEFAULT_SLA_HOURS))
  const [equipmentDraft, setEquipmentDraft] = useState("")
  const [locationDraft, setLocationDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const notifyRef = useRef(onConfigChange)
  useEffect(() => { notifyRef.current = onConfigChange })

  useEffect(() => {
    let cancelled = false
    fetch("/api/workshop-config")
      .then(response => response.json())
      .then(data => {
        if (cancelled) return
        const config: WorkshopConfig = {
          equipmentTypes: Array.isArray(data.equipmentTypes) ? data.equipmentTypes : DEFAULT_EQUIPMENT_TYPES,
          locations: Array.isArray(data.locations) ? data.locations : DEFAULT_LOCATIONS,
          warrantyDays: Number.isInteger(data.warrantyDays) ? data.warrantyDays : DEFAULT_WARRANTY_DAYS,
          slaHours: readSlaHours(data.slaHours),
        }
        setEquipmentTypes(config.equipmentTypes)
        setLocations(config.locations)
        setWarrantyDaysDraft(String(config.warrantyDays))
        setSlaDraft(slaTextOf(config.slaHours))
        notifyRef.current?.(config)
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar la configuración del taller. Se muestran los valores por defecto.")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function addToList(list: string[], value: string, setList: (items: string[]) => void, setDraft: (value: string) => void, limit: number, label: string) {
    const item = value.trim()
    if (!item) return
    if (list.some(existing => existing.toLowerCase() === item.toLowerCase())) { toast.error(`"${item}" ya está en la lista.`); return }
    if (list.length >= limit) { toast.error(`Máximo ${limit} ${label}.`); return }
    setList([...list, item])
    setDraft("")
    setDirty(true)
  }

  async function save(nextEquipmentTypes: string[] = equipmentTypes, nextLocations: string[] = locations, nextWarrantyDays: string = warrantyDaysDraft, nextSlaDraft: Record<SlaStage, string> = slaDraft) {
    if (inFlight.current) return
    if (!nextEquipmentTypes.length || !nextLocations.length) { toast.error("Cada lista necesita al menos un elemento."); return }
    const days = Number.parseInt(nextWarrantyDays, 10)
    if (!Number.isInteger(days) || days < 1 || days > MAX_WARRANTY_DAYS) { toast.error(`Los días de garantía deben ser un entero entre 1 y ${MAX_WARRANTY_DAYS}.`); return }
    const nextSla = {} as SlaHours
    for (const stage of SLA_STAGES) {
      const text = nextSlaDraft[stage].trim()
      const hours = Number(text)
      if (text === "" || !Number.isInteger(hours) || hours < 0) { toast.error(`El SLA de "${repairLabels[stage]}" debe ser un entero de horas mayor o igual a 0.`); return }
      nextSla[stage] = hours
    }
    inFlight.current = true
    setSaving(true)
    try {
      const payload = { equipmentTypes: nextEquipmentTypes, locations: nextLocations, warrantyDays: days, slaHours: nextSla }
      operationKey.current = getClientOperationKey(operationKey.current, { url: "/api/workshop-config", ...payload })
      const response = await fetch("/api/workshop-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se confirmó el cambio")
      operationKey.current = null
      const config: WorkshopConfig = {
        equipmentTypes: Array.isArray(data.equipmentTypes) ? data.equipmentTypes : nextEquipmentTypes,
        locations: Array.isArray(data.locations) ? data.locations : nextLocations,
        warrantyDays: Number.isInteger(data.warrantyDays) ? data.warrantyDays : days,
        slaHours: readSlaHours(data.slaHours),
      }
      setEquipmentTypes(config.equipmentTypes)
      setLocations(config.locations)
      setWarrantyDaysDraft(String(config.warrantyDays))
      setSlaDraft(slaTextOf(config.slaHours))
      setDirty(false)
      notifyRef.current?.(config)
      toast.success("Configuración del taller guardada")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  function reset() {
    if (inFlight.current) return
    setEquipmentDraft("")
    setLocationDraft("")
    setEquipmentTypes(DEFAULT_EQUIPMENT_TYPES)
    setLocations(DEFAULT_LOCATIONS)
    setWarrantyDaysDraft(String(DEFAULT_WARRANTY_DAYS))
    setSlaDraft(slaTextOf(DEFAULT_SLA_HOURS))
    void save(DEFAULT_EQUIPMENT_TYPES, DEFAULT_LOCATIONS, String(DEFAULT_WARRANTY_DAYS), slaTextOf(DEFAULT_SLA_HOURS))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando listas del taller…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <EditableList
        title="Tipos de equipo"
        description="Opciones disponibles al catalogar servicios y recibir equipos en el taller."
        items={equipmentTypes}
        draft={equipmentDraft}
        onDraft={setEquipmentDraft}
        onAdd={() => addToList(equipmentTypes, equipmentDraft, setEquipmentTypes, setEquipmentDraft, 60, "tipos de equipo")}
        onRemove={item => { setEquipmentTypes(equipmentTypes.filter(type => type !== item)); setDirty(true) }}
        placeholder="Ej. Drone"
        maxLength={40}
        disabled={saving}
        readOnly={readOnly}
      />
      <EditableList
        title="Locaciones del taller"
        description="Ubicaciones físicas donde se resguardan los equipos durante el servicio."
        items={locations}
        draft={locationDraft}
        onDraft={setLocationDraft}
        onAdd={() => addToList(locations, locationDraft, setLocations, setLocationDraft, 30, "locaciones")}
        onRemove={item => { setLocations(locations.filter(location => location !== item)); setDirty(true) }}
        placeholder="Ej. Mesa 3"
        maxLength={60}
        disabled={saving}
        readOnly={readOnly}
      />
      {/* Vigencia de la garantía al reingresar un equipo entregado. */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Días de garantía</h3>
        <p className="text-xs text-muted-foreground">
          Vigencia de la garantía cuando un equipo entregado reingresa al taller.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_WARRANTY_DAYS}
            value={warrantyDaysDraft}
            onChange={event => { setWarrantyDaysDraft(event.target.value); setDirty(true) }}
            disabled={saving || readOnly}
            className="w-28"
            aria-label="Días de garantía"
          />
          <span className="text-sm text-muted-foreground">días</span>
        </div>
      </div>
      {/* Semáforo del tablero: horas máximas por etapa sin movimiento. */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">SLA por etapa (horas)</h3>
        <p className="text-xs text-muted-foreground">
          Tiempo máximo que una orden puede permanecer en cada etapa sin moverse: al superarlo el semáforo la marca en rojo y en el último 20% del plazo pasa a ámbar. No aplica a laboratorio externo ni a las etapas de cierre.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SLA_STAGES.map(stage => (
            <label key={stage} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <span>{repairLabels[stage]}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={slaDraft[stage]}
                  onChange={event => { setSlaDraft({ ...slaDraft, [stage]: event.target.value }); setDirty(true) }}
                  disabled={saving || readOnly}
                  className="w-24"
                  aria-label={`SLA de ${repairLabels[stage]} en horas`}
                />
                <span className="text-xs text-muted-foreground">h</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {readOnly ? (
        <p className="border-t pt-5 text-xs text-muted-foreground">La edición de estas listas requiere administrador.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t pt-5">
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar cambios
          </Button>
          <Button variant="outline" onClick={reset} disabled={saving}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Restablecer valores
          </Button>
          {dirty && <p className="text-xs text-muted-foreground">Hay cambios sin guardar.</p>}
        </div>
      )}
    </div>
  )
}
