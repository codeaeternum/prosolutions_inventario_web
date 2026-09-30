"use client"

// Catálogo de servicios del taller (precios sugeridos, precios por
// dispositivo, modelos de equipo y listas de tipos/locaciones). Antes era
// /admin/taller/catalogo; ahora es la pestaña "Precios" de /admin/taller.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen,
  CheckCircle2,
  DollarSign,
  Gamepad2,
  Laptop,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Power,
  Printer,
  Search,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Watch,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DeviceModelsImportDialog } from "@/components/admin/taller/import-models-dialog"
import { WorkshopConfigEditor } from "@/components/admin/configuracion/taller-config"
import { DEFAULT_EQUIPMENT_TYPES } from "@/components/admin/configuracion/editable-list"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { cn } from "@/lib/utils"

// Precio específico del servicio: deviceModelId (modelo exacto) XOR
// equipmentType (tipo genérico); gana sobre priceCents al recibir el equipo.
type ServicePrice = {
  id: string; deviceModelId: string | null; equipmentType: string | null
  priceCents: number; deviceModel: { brand: string; model: string } | null
}
type Service = {
  id: string; name: string; description: string | null; priceCents: number | null
  equipmentType: string | null; isActive: boolean; prices?: ServicePrice[]
}
type ServiceForm = { name: string; price: string; equipmentType: string; description: string }
// Fila editable del bloque "Precios por dispositivo" del formulario.
type PriceRow = {
  key: string; scope: "model" | "type"
  deviceModelId: string; deviceLabel: string; equipmentType: string; price: string
}
// businessId null = fila del catálogo global de plataforma; con valor =
// modelo privado del tenant (solo esos los puede borrar el staff del tenant).
type DeviceModelRow = { id: string; businessId: string | null; brand: string; model: string; code: string | null; type: string }
type DeviceModelForm = { brand: string; model: string; code: string; type: string }

const emptyModelForm: DeviceModelForm = { brand: "", model: "", code: "", type: "" }
const DEVICE_MODEL_TYPES = ["SMARTPHONE", "TABLET", "LAPTOP", "CONSOLA", "SMARTWATCH", "TV", "PANTALLA", "OTRO"]

const emptyForm: ServiceForm = { name: "", price: "", equipmentType: "", description: "" }
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100)

function equipmentIcon(type: string | null): LucideIcon {
  const value = (type ?? "").toLowerCase()
  if (value.includes("celular") || value.includes("smartphone") || value.includes("fono")) return Smartphone
  if (value.includes("tablet")) return Tablet
  if (value.includes("laptop") || value.includes("notebook")) return Laptop
  if (value.includes("computadora") || value.includes("pc") || value.includes("escritorio")) return Monitor
  if (value.includes("consola") || value.includes("game")) return Gamepad2
  if (value.includes("watch") || value.includes("reloj")) return Watch
  if (value.includes("pantalla") || value.includes("monitor") || value.includes("tv")) return Monitor
  if (value.includes("impresora") || value.includes("printer")) return Printer
  return Wrench
}

export function CatalogoPanel() {
  const { data: session } = useSession()
  // El catálogo se puede consultar como staff, pero crear/editar/desactivar
  // servicios, importar o eliminar modelos y editar las listas es admin-only.
  const isAdmin = session?.user?.role === "ADMIN"
  // El catálogo de modelos mezcla global (plataforma) y privado del tenant:
  // importar la base global o borrar modelos globales es solo del superadmin.
  const isSuperAdmin = session?.user?.isSuperAdmin === true
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState<ServiceForm>(emptyForm)
  const [editing, setEditing] = useState<Service | null>(null)
  const [saving, setSaving] = useState(false)
  const [toDeactivate, setToDeactivate] = useState<Service | null>(null)
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>(DEFAULT_EQUIPMENT_TYPES)
  const [deviceModels, setDeviceModels] = useState<DeviceModelRow[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelSearch, setModelSearch] = useState("")
  const [modelForm, setModelForm] = useState<DeviceModelForm>(emptyModelForm)
  const [toDeleteModel, setToDeleteModel] = useState<DeviceModelRow | null>(null)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const requestVersion = useRef(0)
  const modelRequestVersion = useRef(0)
  // Precios por dispositivo del formulario de servicio + buscador de modelos
  // (picker por fila: una sola lista de opciones para la fila enfocada).
  const [priceRows, setPriceRows] = useState<PriceRow[]>([])
  const [pickerRowKey, setPickerRowKey] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState("")
  const [pickerOptions, setPickerOptions] = useState<DeviceModelRow[]>([])
  const priceKeyCounter = useRef(0)
  const pickerRequestVersion = useRef(0)

  // Se cargan todos los servicios (activos e inactivos) una sola vez; la búsqueda,
  // el filtro por tipo y "mostrar inactivos" se aplican del lado del cliente.
  const loadServices = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const response = await fetch("/api/workshop-services?all=1")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los servicios")
      if (version !== requestVersion.current) return
      setServices(data.services ?? [])
    } catch (cause) {
      if (version === requestVersion.current) toast.error(cause instanceof Error ? cause.message : "Error de conexión")
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])
  useEffect(() => { const timer = setTimeout(() => { void loadServices() }, 0); return () => clearTimeout(timer) }, [loadServices])

  const loadModels = useCallback(async () => {
    const version = ++modelRequestVersion.current
    setModelsLoading(true)
    try {
      const params = new URLSearchParams()
      if (modelSearch.trim()) params.set("q", modelSearch.trim())
      const response = await fetch(`/api/device-models?${params}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los modelos")
      if (version !== modelRequestVersion.current) return
      setDeviceModels(data.models ?? [])
    } catch (cause) {
      if (version === modelRequestVersion.current) toast.error(cause instanceof Error ? cause.message : "Error de conexión")
    } finally {
      if (version === modelRequestVersion.current) setModelsLoading(false)
    }
  }, [modelSearch])
  useEffect(() => { const timer = setTimeout(() => { void loadModels() }, 200); return () => clearTimeout(timer) }, [loadModels])

  // Buscador del picker de modelos (filas "modelo exacto" del bloque de
  // precios): consulta el mismo endpoint que el autocompletado de recepción.
  useEffect(() => {
    const version = ++pickerRequestVersion.current
    const timer = setTimeout(() => {
      if (pickerRowKey === null) { setPickerOptions([]); return }
      void (async () => {
        try {
          const params = new URLSearchParams()
          if (pickerQuery.trim()) params.set("q", pickerQuery.trim())
          const response = await fetch(`/api/device-models?${params}`)
          const data = await response.json().catch(() => ({}))
          if (!response.ok || version !== pickerRequestVersion.current) return
          setPickerOptions(data.models ?? [])
        } catch { if (version === pickerRequestVersion.current) setPickerOptions([]) }
      })()
    }, 200)
    return () => clearTimeout(timer)
  }, [pickerRowKey, pickerQuery])

  useEffect(() => {
    let cancelled = false
    fetch("/api/workshop-config")
      .then(response => response.json())
      .then(data => {
        if (cancelled) return
        if (Array.isArray(data.equipmentTypes)) setEquipmentTypes(data.equipmentTypes)
      })
      .catch(() => { if (!cancelled) toast.error("No se pudo cargar la configuración. Se muestran los valores por defecto.") })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => ({
    total: services.length,
    active: services.filter(service => service.isActive).length,
    fixedPrice: services.filter(service => service.priceCents !== null).length,
  }), [services])

  // Tipos configurados + cualquier tipo ya usado por servicios que no esté en la lista.
  const typeOptions = useMemo(() => {
    const extras = new Set<string>()
    for (const service of services) {
      if (service.equipmentType && !equipmentTypes.includes(service.equipmentType)) extras.add(service.equipmentType)
    }
    return [...equipmentTypes, ...extras]
  }, [equipmentTypes, services])

  const filteredServices = useMemo(() => {
    const term = search.trim().toLowerCase()
    return services.filter(service => {
      if (!showInactive && !service.isActive) return false
      if (typeFilter && service.equipmentType !== typeFilter) return false
      if (term && !`${service.name} ${service.description ?? ""}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [services, search, typeFilter, showInactive])

  async function post(url: string, payload: Record<string, unknown>) {
    operationKey.current = getClientOperationKey(operationKey.current, { url, ...payload })
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || "No se confirmó el cambio")
    operationKey.current = null
    return data
  }

  function startEdit(service: Service) {
    setEditing(service)
    setForm({ name: service.name, price: service.priceCents === null ? "" : (service.priceCents / 100).toFixed(2), equipmentType: service.equipmentType ?? "", description: service.description ?? "" })
    setPriceRows((service.prices ?? []).map(row => ({
      key: `pr-${++priceKeyCounter.current}`,
      scope: row.deviceModelId ? "model" : "type",
      deviceModelId: row.deviceModelId ?? "",
      deviceLabel: row.deviceModel ? `${row.deviceModel.brand} ${row.deviceModel.model}` : "",
      equipmentType: row.equipmentType ?? "",
      price: (row.priceCents / 100).toFixed(2),
    })))
    setPickerRowKey(null)
  }
  function cancelEdit() { setEditing(null); setForm(emptyForm); setPriceRows([]); setPickerRowKey(null) }

  function addPriceRow() {
    setPriceRows(previous => [...previous, { key: `pr-${++priceKeyCounter.current}`, scope: "model", deviceModelId: "", deviceLabel: "", equipmentType: "", price: "" }])
  }
  function updatePriceRow(key: string, patch: Partial<PriceRow>) {
    setPriceRows(previous => previous.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }
  function removePriceRow(key: string) {
    setPriceRows(previous => previous.filter(row => row.key !== key))
    setPickerRowKey(current => (current === key ? null : current))
  }

  async function submitService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const name = form.name.trim()
    const description = form.description.trim()
    const equipmentType = form.equipmentType.trim()
    const price = form.price === "" ? null : Number(form.price)
    if (name.length < 2) { toast.error("El nombre debe tener al menos 2 caracteres."); return }
    if (price !== null && (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001)) { toast.error("El precio admite hasta dos decimales."); return }
    // Cada fila lleva exactamente un alcance (modelo elegido de la lista o
    // tipo de equipo) y un precio de hasta dos decimales — igual que la API.
    const prices: { deviceModelId?: string; equipmentType?: string; priceCents: number }[] = []
    for (const row of priceRows) {
      const value = row.price === "" ? Number.NaN : Number(row.price)
      if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
        toast.error("Cada precio por dispositivo admite hasta dos decimales."); return
      }
      const priceCents = Math.round(value * 100)
      if (row.scope === "model") {
        if (!row.deviceModelId) { toast.error("Elige un modelo de la lista en cada precio por modelo."); return }
        prices.push({ deviceModelId: row.deviceModelId, priceCents })
      } else {
        const scopeType = row.equipmentType.trim()
        if (!scopeType) { toast.error("Cada precio por tipo necesita el tipo de equipo."); return }
        prices.push({ equipmentType: scopeType, priceCents })
      }
    }
    inFlight.current = true; setSaving(true)
    try {
      if (editing) {
        const response = await fetch(`/api/workshop-services/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, equipmentType, priceCents: price === null ? null : Math.round(price * 100), prices }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "No se pudo actualizar el servicio")
        toast.success("Servicio actualizado")
      } else {
        await post("/api/workshop-services", { name, description, equipmentType, priceCents: price === null ? null : Math.round(price * 100), prices })
        toast.success("Servicio creado")
      }
      cancelEdit()
      await loadServices()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  async function submitModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const brand = modelForm.brand.trim()
    const model = modelForm.model.trim()
    const code = modelForm.code.trim()
    const type = modelForm.type.trim()
    if (!brand || !model) { toast.error("Marca y modelo son obligatorios."); return }
    inFlight.current = true; setSaving(true)
    try {
      // El superadmin siembra el catálogo global; el staff del tenant crea
      // modelos privados de su negocio (la API estampa el businessId).
      await post("/api/device-models", { brand, model, code, type, ...(isSuperAdmin ? { global: true } : {}) })
      toast.success("Modelo de equipo guardado")
      setModelForm(emptyModelForm)
      await loadModels()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  async function deleteModel(item: DeviceModelRow) {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true)
    try {
      const response = await fetch(`/api/device-models/${item.id}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el modelo")
      toast.success("Modelo eliminado")
      await loadModels()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio.") }
    finally { inFlight.current = false; setSaving(false); setToDeleteModel(null) }
  }

  // Carga el catálogo sugerido de servicios; el endpoint omite los nombres
  // que ya existen en el negocio (dedup case-insensitive).
  async function seedSuggested() {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true)
    try {
      const data = await post("/api/workshop-services/seed-suggested", {})
      toast.success(data.created > 0
        ? `${data.created} ${data.created === 1 ? "servicio agregado" : "servicios agregados"}${data.skipped > 0 ? ` · ${data.skipped} ya ${data.skipped === 1 ? "existía" : "existían"}` : ""}`
        : "Ya tenías todos los servicios sugeridos")
      await loadServices()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio. Reintenta sin cambiar los datos.") }
    finally { inFlight.current = false; setSaving(false) }
  }

  async function toggleService(service: Service) {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true)
    try {
      const response = await fetch(`/api/workshop-services/${service.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !service.isActive }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se pudo cambiar el estado")
      if (service.isActive && editing?.id === service.id) cancelEdit()
      toast.success(service.isActive ? "Servicio desactivado" : "Servicio activado")
      await loadServices()
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "No se confirmó el cambio.") }
    finally { inFlight.current = false; setSaving(false); setToDeactivate(null) }
  }

  const statCards = [
    { label: "Servicios en catálogo", value: stats.total, icon: BookOpen, tone: "bg-primary/10 text-primary" },
    { label: "Activos", value: stats.active, icon: CheckCircle2, tone: "bg-success/10 text-success" },
    { label: "Con precio fijo", value: stats.fixedPrice, icon: DollarSign, tone: "bg-warning/10 text-warning" },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {statCards.map(card => (
          <div key={card.label} className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <span className={cn("rounded-lg p-2", card.tone)}>
              <card.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-bold tabular-nums">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="servicios">
        <TabsList>
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
          <TabsTrigger value="modelos">Modelos de equipo</TabsTrigger>
          <TabsTrigger value="configuracion">Tipos de equipo y locaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="servicios" className="space-y-6 pt-4">
          {isAdmin && <section className="rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="mb-4 font-semibold">{editing ? `Editar: ${editing.name}` : "Nuevo servicio"}</h2>
            <form onSubmit={submitService} className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm">Nombre *
                <Input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} maxLength={120} placeholder="Ej. Cambio de pantalla" autoComplete="off" required />
              </label>
              <label className="block space-y-2 text-sm">Precio base (MXN) — opcional
                <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={event => setForm(previous => ({ ...previous, price: event.target.value }))} placeholder="Variable / según dispositivo" />
              </label>
              <label className="block space-y-2 text-sm">Tipo de equipo
                <Input list="service-equipment-types" value={form.equipmentType} onChange={event => setForm(previous => ({ ...previous, equipmentType: event.target.value }))} maxLength={80} placeholder="Ej. Celular (opcional)" autoComplete="off" />
                <datalist id="service-equipment-types">{equipmentTypes.map(type => <option key={type} value={type} />)}</datalist>
              </label>
              <label className="block space-y-2 text-sm">Descripción
                <Input value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} maxLength={300} placeholder="Detalle breve del servicio (opcional)" autoComplete="off" />
              </label>
              <div className="space-y-3 rounded-lg border border-dashed p-4 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Precios por dispositivo</p>
                    <p className="text-xs text-muted-foreground">Ganan sobre el precio base cuando el equipo recibido coincide con el modelo exacto o el tipo de equipo.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addPriceRow} disabled={saving}>
                    <Plus className="mr-1 h-3.5 w-3.5" />Agregar precio
                  </Button>
                </div>
                {priceRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin precios específicos: siempre se usa el precio base (o se cotiza al recibir si está vacío).</p>
                ) : (
                  <div className="space-y-2">
                    {priceRows.map(row => (
                      <div key={row.key} className="grid items-start gap-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_7.5rem_2.25rem]">
                        <select
                          value={row.scope}
                          onChange={event => updatePriceRow(row.key, { scope: event.target.value as PriceRow["scope"] })}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          disabled={saving}
                        >
                          <option value="model">Modelo exacto</option>
                          <option value="type">Tipo de equipo</option>
                        </select>
                        {row.scope === "model" ? (
                          <div className="relative">
                            <Input
                              value={row.deviceLabel}
                              onChange={event => { updatePriceRow(row.key, { deviceLabel: event.target.value, deviceModelId: "" }); setPickerRowKey(row.key); setPickerQuery(event.target.value) }}
                              onFocus={() => { setPickerRowKey(row.key); setPickerQuery(row.deviceLabel) }}
                              onBlur={() => setTimeout(() => setPickerRowKey(current => (current === row.key ? null : current)), 150)}
                              maxLength={140}
                              placeholder="Buscar marca o modelo…"
                              autoComplete="off"
                              disabled={saving}
                              className={row.deviceModelId ? "pr-8" : undefined}
                            />
                            {row.deviceModelId && <CheckCircle2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />}
                            {pickerRowKey === row.key && pickerOptions.length > 0 && (
                              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                                {pickerOptions.map(option => (
                                  <li key={option.id}>
                                    <button
                                      type="button"
                                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                                      onMouseDown={event => {
                                        event.preventDefault()
                                        updatePriceRow(row.key, { deviceModelId: option.id, deviceLabel: `${option.brand} ${option.model}` })
                                        setPickerRowKey(null)
                                      }}
                                    >
                                      <span>{option.brand} {option.model}</span>
                                      {option.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{option.code}</span>}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <Input
                            list="service-equipment-types"
                            value={row.equipmentType}
                            onChange={event => updatePriceRow(row.key, { equipmentType: event.target.value })}
                            maxLength={80}
                            placeholder="Ej. Celular"
                            autoComplete="off"
                            disabled={saving}
                          />
                        )}
                        <Input type="number" min="0" step="0.01" inputMode="decimal" value={row.price} onChange={event => updatePriceRow(row.key, { price: event.target.value })} placeholder="0.00" disabled={saving} />
                        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 px-0" onClick={() => removePriceRow(row.key)} disabled={saving} aria-label="Quitar precio">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? "Guardar cambios" : "Crear servicio"}
                </Button>
                {editing && <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>Cancelar</Button>}
              </div>
            </form>
          </section>}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-56 flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder="Buscar por nombre o descripción…" className="pl-9" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} className="h-4 w-4 rounded border" />
                Mostrar inactivos
              </label>
              {isAdmin && (
                <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void seedSuggested()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Cargar servicios sugeridos
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTypeFilter("")}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  typeFilter === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                Todos
              </button>
              {typeOptions.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                    typeFilter === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <section className="rounded-xl border bg-card">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredServices.length === 0 ? (
              <div className="p-12 text-center">
                <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <h2 className="text-lg font-semibold">{services.length === 0 ? "Aún no hay servicios" : "Sin resultados"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{services.length === 0 ? (isAdmin ? "Crea el primero con el formulario de arriba o carga el catálogo sugerido." : "Un administrador aún no registra servicios.") : "Prueba con otro nombre o ajusta los filtros."}</p>
                {isAdmin && services.length === 0 && (
                  <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void seedSuggested()} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Cargar servicios sugeridos
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead className="hidden md:table-cell">Descripción</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead className="hidden sm:table-cell">Tipo de equipo</TableHead>
                    <TableHead>Estado</TableHead>
                    {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServices.map(service => {
                    const ServiceIcon = equipmentIcon(service.equipmentType)
                    return (
                      <TableRow key={service.id} className={service.isActive ? "" : "opacity-60"}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
                              <ServiceIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium">{service.name}</p>
                              {service.description && <p className="line-clamp-1 text-xs text-muted-foreground md:hidden">{service.description}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell">{service.description || "—"}</TableCell>
                        <TableCell>
                          {service.priceCents === null
                            ? <span className="text-muted-foreground">Según dispositivo</span>
                            : <span className="font-medium tabular-nums">{money(service.priceCents)}</span>}
                          {(service.prices?.length ?? 0) > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">+{service.prices!.length} por dispositivo</p>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {service.equipmentType
                            ? <Badge variant="outline" className="font-normal">{service.equipmentType}</Badge>
                            : <span className="text-muted-foreground">Cualquiera</span>}
                        </TableCell>
                        <TableCell><Badge variant={service.isActive ? "success" : "secondary"}>{service.isActive ? "Activo" : "Inactivo"}</Badge></TableCell>
                        {isAdmin && <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(service)} disabled={saving}>
                              <Pencil className="mr-1 h-3.5 w-3.5" />Editar
                            </Button>
                            <Button type="button" size="sm" variant={service.isActive ? "outline" : "default"} onClick={() => { if (service.isActive) setToDeactivate(service); else void toggleService(service) }} disabled={saving}>
                              <Power className="mr-1 h-3.5 w-3.5" />{service.isActive ? "Desactivar" : "Activar"}
                            </Button>
                          </div>
                        </TableCell>}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="modelos" className="space-y-6 pt-4">
          <p className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            {isSuperAdmin
              ? "Catálogo global de la plataforma: los modelos que agregues o importes alimentan el autocompletado de recepción de todas las empresas."
              : "Los modelos que agregues son privados de tu negocio y se suman al catálogo global de la plataforma en el autocompletado de recepción. Los modelos marcados como Global solo los administra Reficio."}
          </p>
          <section className="rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="mb-1 font-semibold">Nuevo modelo de equipo</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              {isSuperAdmin
                ? "Se guarda en el catálogo global. Si marca + modelo ya existen, se actualiza su código y tipo."
                : "Se guarda como modelo privado de tu negocio. Si marca + modelo ya existen en tu catálogo, se actualiza su código y tipo."}
            </p>
            <form onSubmit={submitModel} className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm">Marca *
                <Input value={modelForm.brand} onChange={event => setModelForm(previous => ({ ...previous, brand: event.target.value }))} maxLength={60} placeholder="Ej. Samsung" autoComplete="off" required />
              </label>
              <label className="block space-y-2 text-sm">Modelo *
                <Input value={modelForm.model} onChange={event => setModelForm(previous => ({ ...previous, model: event.target.value }))} maxLength={120} placeholder="Ej. Galaxy A21" autoComplete="off" required />
              </label>
              <label className="block space-y-2 text-sm">Código
                <Input value={modelForm.code} onChange={event => setModelForm(previous => ({ ...previous, code: event.target.value }))} maxLength={60} placeholder="Ej. SM-A245M (opcional)" autoComplete="off" />
              </label>
              <label className="block space-y-2 text-sm">Tipo
                <Input list="device-model-types" value={modelForm.type} onChange={event => setModelForm(previous => ({ ...previous, type: event.target.value }))} maxLength={40} placeholder="SMARTPHONE" autoComplete="off" />
                <datalist id="device-model-types">{DEVICE_MODEL_TYPES.map(type => <option key={type} value={type} />)}</datalist>
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar modelo
                </Button>
              </div>
            </form>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={modelSearch} onChange={event => setModelSearch(event.target.value)} maxLength={100} placeholder="Buscar por marca, modelo o código…" className="pl-9" />
            </div>
            <p className="text-xs text-muted-foreground">{deviceModels.length} {deviceModels.length === 1 ? "modelo" : "modelos"}</p>
            {isSuperAdmin && <div className="ml-auto">
              <DeviceModelsImportDialog onImported={() => void loadModels()} />
            </div>}
          </div>

          <section className="rounded-xl border bg-card">
            {modelsLoading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : deviceModels.length === 0 ? (
              <div className="p-12 text-center">
                <Smartphone className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <h2 className="text-lg font-semibold">{modelSearch ? "Sin resultados" : "Aún no hay modelos"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{modelSearch ? "Prueba con otra marca o código." : "Registra el primero con el formulario de arriba."}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marca</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="hidden sm:table-cell">Código</TableHead>
                    <TableHead className="hidden md:table-cell">Tipo</TableHead>
                    <TableHead className="hidden sm:table-cell">Origen</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deviceModels.map(item => {
                    // Globales: solo superadmin los borra. Del tenant: su staff.
                    const canDelete = item.businessId === null ? isSuperAdmin : true
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.brand}</TableCell>
                        <TableCell>{item.model}</TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{item.code || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell"><Badge variant="outline" className="font-normal">{item.type}</Badge></TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {item.businessId === null
                            ? <Badge variant="secondary" className="font-normal">Global</Badge>
                            : <Badge variant="outline" className="font-normal">Propio</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          {canDelete && (
                            <Button type="button" size="sm" variant="outline" onClick={() => setToDeleteModel(item)} disabled={saving}>
                              <Trash2 className="mr-1 h-3.5 w-3.5" />Eliminar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">Se muestran hasta 15 resultados; usa la búsqueda para encontrar un modelo específico.</p>
          </section>
        </TabsContent>

        <TabsContent value="configuracion" className="pt-4">
          <section className="rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="font-semibold">Tipos de equipo y locaciones</h2>
            <p className="mb-5 mt-0.5 text-xs text-muted-foreground">Estas listas alimentan el formulario de servicios y la recepción de equipos.</p>
            <WorkshopConfigEditor readOnly={!isAdmin} onConfigChange={config => setEquipmentTypes(config.equipmentTypes)} />
          </section>
        </TabsContent>
      </Tabs>

      <AlertDialog open={toDeactivate !== null} onOpenChange={open => { if (!open) setToDeactivate(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar servicio</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{toDeactivate?.name}&quot; dejará de aparecer en el catálogo activo. Puedes reactivarlo después marcando &quot;Mostrar inactivos&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toDeactivate) void toggleService(toDeactivate) }}>Desactivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={toDeleteModel !== null} onOpenChange={open => { if (!open) setToDeleteModel(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar modelo de equipo</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{toDeleteModel?.brand} {toDeleteModel?.model}&quot; dejará de sugerirse en el autocompletado de recepción. Las órdenes ya registradas no se ven afectadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toDeleteModel) void deleteModel(toDeleteModel) }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
