"use client"

// Registro de actividad (solo ADMIN): timeline unificado de quién hizo qué
// en el sistema — ediciones auditadas con diff campo a campo, operaciones
// de negocio (ventas, caja, reservas) y eventos del taller. Consume
// GET /api/activity con paginación por cursor; los `summary` y los valores
// de `changes` ya vienen formateados desde el servidor (montos incluidos).
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  Download,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDate, formatDay } from "@/lib/utils"

type ActivitySource = "audit" | "operation" | "repair"

interface ActivityChange {
  field: string
  before: unknown
  after: unknown
}

interface ActivityItem {
  id: string
  source: ActivitySource
  actorId: string
  actorName: string
  actorRole: string
  action: string
  label: string
  summary: string
  changes?: ActivityChange[]
  /** Tipo de entidad afectada ("sale", "product", "repair"…), filtro `entity`. */
  entity?: string
  entityLabel?: string
  createdAt: string // ISO
}

interface ActivityActor {
  id: string
  name: string
  role: string
}

interface ActivityResponse {
  items: ActivityItem[]
  nextCursor: string | null
  actors: ActivityActor[]
  /** Tipos de entidad presentes en el resultado (para el selector Entidad). */
  entities: string[]
}

const PAGE_SIZE = 50

// Color por fuente: ediciones en ámbar, operaciones de negocio en verde,
// taller en violeta. La misma clase pinta el badge y el punto del timeline.
const sourceMeta: Record<ActivitySource, { badgeClass: string; dotClass: string; filterLabel: string }> = {
  audit: {
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dotClass: "bg-amber-500",
    filterLabel: "Ediciones",
  },
  operation: {
    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dotClass: "bg-emerald-500",
    filterLabel: "Operaciones",
  },
  repair: {
    badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
    dotClass: "bg-violet-500",
    filterLabel: "Taller",
  },
}
const fallbackSourceMeta = {
  badgeClass: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30",
  dotClass: "bg-zinc-400",
}

const ACTOR_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  EMPLOYEE: "Empleado",
  WORKSHOP: "Taller aliado",
  CUSTOMER: "Cliente",
}

// Nombre visible de cada tipo de entidad; las que lleguen sin etiqueta se
// muestran con su clave cruda (p. ej. una entidad auditada nueva).
const ENTITY_LABELS: Record<string, string> = {
  sale: "Ventas",
  cash: "Caja",
  purchase: "Compras",
  count: "Conteos",
  credit: "Crédito",
  reservation: "Reservas",
  shopping: "Encargos",
  inventory: "Inventario",
  convenio: "Convenios",
  repair: "Taller",
  product: "Productos",
  user: "Usuarios",
  supplier: "Proveedores",
  settings: "Configuración",
  category: "Categorías",
  brand: "Marcas",
  model: "Modelos",
  branch: "Sucursales",
  customer: "Clientes",
  business: "Negocio",
}

function actorInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join("")
  return initials || "?"
}

// before/after llegan como unknown: texto y números van directo; objetos y
// arrays se compactan con JSON corto para que el chip no reviente el layout.
function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    const json = JSON.stringify(value)
    return json.length > 48 ? `${json.slice(0, 45)}…` : json
  } catch {
    return String(value)
  }
}

// Relativo para lo reciente ("hace 5 min"), fecha para lo viejo. `now` se
// captura en estado al cargar la página: nada de Date.now() durante render
// (react-hooks/purity).
function formatWhen(iso: string, now: number | null): string {
  if (now === null) return formatDate(iso)
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (diffMin < 0) return formatDate(iso) // reloj del cliente adelantado al server
  if (diffMin < 1) return "ahora mismo"
  if (diffMin < 60) return `hace ${diffMin} min`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days} d`
  return formatDay(iso)
}

// Datos de ejemplo SOLO en desarrollo: si /api/activity todavía no existe
// (lo construye otro equipo en paralelo) la página muestra este set para
// poder revisar la UI. En producción un 404 cae en el estado de error.
function buildDemoResponse(now: number): ActivityResponse {
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString()
  return {
    nextCursor: null,
    actors: [
      { id: "demo-admin", name: "Galindo (dueño)", role: "ADMIN" },
      { id: "demo-emp", name: "María Mostrador", role: "EMPLOYEE" },
    ],
    entities: ["cash", "customer", "product", "repair", "sale"],
    items: [
      {
        id: "demo-1",
        source: "audit",
        actorId: "demo-admin",
        actorName: "Galindo (dueño)",
        actorRole: "ADMIN",
        action: "product.update",
        label: "Edición",
        summary: "Actualizó el producto \"Pantalla iPhone 12\" en el catálogo",
        entity: "product",
        entityLabel: "Pantalla iPhone 12",
        changes: [
          { field: "Precio", before: "$500.00", after: "$450.00" },
          { field: "Stock", before: "4", after: "6" },
        ],
        createdAt: iso(4),
      },
      {
        id: "demo-2",
        source: "operation",
        actorId: "demo-emp",
        actorName: "María Mostrador",
        actorRole: "EMPLOYEE",
        action: "sale.create",
        label: "Venta",
        summary: "Cobró una venta de 2 artículos por $1,250.00 en mostrador",
        entity: "sale",
        entityLabel: "Ticket VT-000231",
        createdAt: iso(38),
      },
      {
        id: "demo-3",
        source: "repair",
        actorId: "demo-emp",
        actorName: "María Mostrador",
        actorRole: "EMPLOYEE",
        action: "repair.status",
        label: "Taller",
        summary: "La orden OT-000104 pasó de \"En reparación\" a \"Listo\"",
        entity: "repair",
        entityLabel: "OT-000104 · Galaxy S21",
        createdAt: iso(160),
      },
      {
        id: "demo-4",
        source: "operation",
        actorId: "demo-admin",
        actorName: "Galindo (dueño)",
        actorRole: "ADMIN",
        action: "cash.movement",
        label: "Caja",
        summary: "Registró una salida de caja de $800.00 (pago a proveedor)",
        entity: "cash",
        createdAt: iso(60 * 26),
      },
      {
        id: "demo-5",
        source: "audit",
        actorId: "demo-emp",
        actorName: "María Mostrador",
        actorRole: "EMPLOYEE",
        action: "user.update",
        label: "Edición",
        summary: "Actualizó datos del cliente \"Juan Pérez\"",
        entity: "customer",
        entityLabel: "Juan Pérez",
        changes: [{ field: "Teléfono", before: "—", after: "811 234 5678" }],
        createdAt: iso(60 * 30),
      },
    ],
  }
}

export default function ActividadPage() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [actors, setActors] = useState<ActivityActor[]>([])
  const [entities, setEntities] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [forbidden, setForbidden] = useState(false)
  // "Ahora" capturado al terminar cada carga: da tiempos relativos sin
  // llamar Date.now() durante el render.
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const [actorId, setActorId] = useState("")
  const [source, setSource] = useState<"" | ActivitySource>("")
  const [entity, setEntity] = useState("")
  const [search, setSearch] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const requestVersion = useRef(0)

  // Búsqueda con debounce (~300 ms), mismo patrón que inventario/mercado.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      const version = ++requestVersion.current
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError("")
        setForbidden(false)
      }
      try {
        const params = new URLSearchParams({ take: String(PAGE_SIZE) })
        if (actorId) params.set("actorId", actorId)
        if (source) params.set("source", source)
        if (entity) params.set("entity", entity)
        if (from) params.set("from", from)
        if (to) params.set("to", to)
        if (debouncedQ) params.set("q", debouncedQ)
        if (cursor) params.set("cursor", cursor)
        const res = await fetch(`/api/activity?${params}`)
        const data: (Partial<ActivityResponse> & { error?: string }) | null = await res
          .json()
          .catch(() => null)
        if (version !== requestVersion.current) return
        if (res.status === 401 || res.status === 403) {
          setForbidden(true)
          setItems([])
          return
        }
        if (!res.ok) {
          // Endpoint aún no desplegado: solo en dev mostramos datos de ejemplo.
          if (process.env.NODE_ENV !== "production" && res.status === 404) {
            const demo = buildDemoResponse(Date.now())
            setDemoMode(true)
            setItems(demo.items)
            setActors(demo.actors)
            setEntities(demo.entities)
            setNextCursor(demo.nextCursor)
            setLoadedAt(Date.now())
            return
          }
          if (append) {
            toast.error("No se pudieron cargar más registros")
          } else {
            setItems([])
            setError(data?.error || "No se pudo cargar el registro de actividad")
          }
          return
        }
        setDemoMode(false)
        setLoadedAt(Date.now())
        const incoming = data?.items ?? []
        setItems(prev => {
          if (!append) return incoming
          // El cursor puede traslaparse si hubo actividad nueva entre cargas.
          const seen = new Set(prev.map(i => i.id))
          return [...prev, ...incoming.filter(i => !seen.has(i.id))]
        })
        // La lista de empleados se acumula: si el server la devuelve acotada
        // por los filtros, no perdemos las opciones ya vistas.
        setActors(prev => {
          const map = new Map(prev.map(a => [a.id, a]))
          for (const a of data?.actors ?? []) map.set(a.id, a)
          return [...map.values()]
        })
        // Igual que actores: las entidades se acumulan para no perder la
        // opción seleccionada cuando otros filtros acotan la lista.
        setEntities(prev => {
          const merged = new Set(prev)
          for (const e of data?.entities ?? []) merged.add(e)
          return [...merged].sort()
        })
        setNextCursor(data?.nextCursor ?? null)
      } catch {
        if (version !== requestVersion.current) return
        if (append) {
          toast.error("No se pudieron cargar más registros")
        } else {
          setItems([])
          setError("Error de conexión al cargar la actividad")
        }
      } finally {
        if (version === requestVersion.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [actorId, source, entity, from, to, debouncedQ]
  )

  // Cada cambio de filtro regenera `load` → recarga desde el primer cursor.
  useEffect(() => {
    const timer = setTimeout(() => void load(null, false), 0)
    return () => clearTimeout(timer)
  }, [load])

  const hasActiveFilters =
    actorId !== "" || source !== "" || entity !== "" || debouncedQ !== "" || from !== "" || to !== ""

  const clearFilters = () => {
    setActorId("")
    setSource("")
    setEntity("")
    setSearch("")
    setDebouncedQ("")
    setFrom("")
    setTo("")
  }

  // Mismos filtros activos que el feed, sin paginación: el servidor arma el
  // archivo con el tope de filas del export (Content-Disposition: attachment).
  const exportParams = new URLSearchParams()
  if (actorId) exportParams.set("actorId", actorId)
  if (source) exportParams.set("source", source)
  if (entity) exportParams.set("entity", entity)
  if (from) exportParams.set("from", from)
  if (to) exportParams.set("to", to)
  if (debouncedQ) exportParams.set("q", debouncedQ)
  const exportUrl = `/api/activity/export?${exportParams}`

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center">
          Solo administradores pueden ver el registro de actividad
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-7 w-7" />
            Registro de actividad
          </h1>
          <p className="text-muted-foreground">
            Quién hizo qué en todo el sistema: ediciones, operaciones y taller
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            className={demoMode ? "pointer-events-none opacity-50" : undefined}
          >
            <a href={exportUrl} download aria-disabled={demoMode} tabIndex={demoMode ? -1 : undefined}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </a>
          </Button>
          <Button onClick={() => void load(null, false)} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Barra de filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
            <div className="sm:col-span-2 lg:flex-1 lg:min-w-[220px]">
              <Label htmlFor="activity-q" className="text-xs">Buscar</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="activity-q"
                  placeholder="Acción, folio, producto, cliente..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="lg:w-48">
              <Label className="text-xs">Empleado</Label>
              <Select value={actorId || "all"} onValueChange={v => setActorId(v === "all" ? "" : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {/* Si el filtro actual ya no viene en la lista (lista acotada
                      por otros filtros), conservamos la opción visible. */}
                  {actorId && !actors.some(a => a.id === actorId) && (
                    <SelectItem value={actorId}>Empleado seleccionado</SelectItem>
                  )}
                  {actors.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="lg:w-44">
              <Label className="text-xs">Fuente</Label>
              <Select
                value={source || "all"}
                onValueChange={v => setSource(v === "all" ? "" : (v as ActivitySource))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="audit">{sourceMeta.audit.filterLabel}</SelectItem>
                  <SelectItem value="operation">{sourceMeta.operation.filterLabel}</SelectItem>
                  <SelectItem value="repair">{sourceMeta.repair.filterLabel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="lg:w-44">
              <Label className="text-xs">Entidad</Label>
              <Select value={entity || "all"} onValueChange={v => setEntity(v === "all" ? "" : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {/* Conserva la opción elegida si ya no viene en la lista. */}
                  {entity && !entities.includes(entity) && (
                    <SelectItem value={entity}>{ENTITY_LABELS[entity] ?? entity}</SelectItem>
                  )}
                  {entities.map(e => (
                    <SelectItem key={e} value={e}>{ENTITY_LABELS[e] ?? e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="lg:w-40">
              <Label htmlFor="activity-from" className="text-xs">Desde</Label>
              <Input
                id="activity-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={e => setFrom(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="lg:w-40">
              <Label htmlFor="activity-to" className="text-xs">Hasta</Label>
              <Input
                id="activity-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={e => setTo(e.target.value)}
                className="mt-1"
              />
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="lg:mb-0.5">
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {demoMode && (
        <p className="text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          Vista previa con datos de ejemplo: el endpoint /api/activity todavía no responde en este entorno.
        </p>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Actividad reciente</CardTitle>
          <CardDescription>
            Ediciones con detalle de cambios, operaciones de negocio y eventos del taller, ordenadas de lo más nuevo a lo más viejo
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={() => void load(null, false)} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Sin actividad registrada en el periodo
            </p>
          ) : (
            <>
              <ol className="relative ml-3 sm:ml-4 space-y-6 border-l border-border">
                {items.map(item => {
                  const meta = sourceMeta[item.source] ?? fallbackSourceMeta
                  return (
                    <li key={item.id} className="relative pl-7">
                      <span
                        aria-hidden
                        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background ${meta.dotClass}`}
                      />
                      <div className="flex items-start gap-3">
                        <Avatar className="h-8 w-8 shrink-0 border">
                          <AvatarFallback className="text-xs font-semibold">
                            {actorInitials(item.actorName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold">{item.actorName}</span>
                            {item.actorRole && item.actorRole !== "ADMIN" && (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {ACTOR_ROLE_LABELS[item.actorRole] ?? item.actorRole}
                              </Badge>
                            )}
                            <Badge className={meta.badgeClass}>{item.label}</Badge>
                            {item.entityLabel && (
                              <Badge variant="secondary" className="max-w-full truncate font-normal">
                                {item.entityLabel}
                              </Badge>
                            )}
                            <time
                              className="ml-auto text-xs text-muted-foreground whitespace-nowrap"
                              dateTime={item.createdAt}
                              title={formatDate(item.createdAt)}
                            >
                              {formatWhen(item.createdAt, loadedAt)}
                            </time>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                          {item.changes && item.changes.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.changes.map((change, i) => (
                                <span
                                  key={`${change.field}-${i}`}
                                  className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
                                >
                                  <span className="font-medium">{change.field}:</span>
                                  <span className="text-rose-600 dark:text-rose-400 line-through decoration-rose-500/60">
                                    {formatChangeValue(change.before)}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    {formatChangeValue(change.after)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
              {nextCursor && (
                <div className="flex justify-center pt-6">
                  <Button
                    variant="outline"
                    onClick={() => void load(nextCursor, true)}
                    disabled={loadingMore}
                  >
                    {loadingMore && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Cargar más
                  </Button>
                </div>
              )}
              {!nextCursor && !demoMode && items.length >= PAGE_SIZE && (
                <p className="pt-6 text-center text-xs text-muted-foreground">
                  Fin del registro en este periodo
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
