"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { OverviewPanel } from "@/components/platform/overview-panel"
import { DirectoryPanel } from "@/components/platform/directory-panel"
import { BusinessStatusButton } from "@/components/platform/business-status-button"
import { EmptyState } from "@/components/admin/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { directoryCategoryLabel } from "@/lib/directory-categories"
import { cn, formatDate, formatDay, formatPrice } from "@/lib/utils"
import {
  Building2,
  ExternalLink,
  Eye,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react"

interface PlatformBusiness {
  id: string
  name: string
  slug: string
  category: string
  isActive: boolean
  showInDirectory?: boolean
  createdAt: string
  counts: {
    users: number
    products: number
    repairOrders: number
    sales: number
    branches: number
  }
  salesTotal: number
  lastActivityAt: string | null
}

type BusinessFilter = "all" | "active" | "suspended" | "directory"
type BusinessKindOption = "FULL" | "REPAIR" | "PARTS" | "PARTNER"

const INITIAL_NEW_BUSINESS = {
  businessName: "",
  slug: "",
  businessKind: "FULL" as BusinessKindOption,
  adminName: "",
  email: "",
  phone: "",
  password: "",
}

function PlatformBusinessesSection() {
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([])
  const [directorySlugs, setDirectorySlugs] = useState<ReadonlySet<string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<BusinessFilter>("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newBusiness, setNewBusiness] = useState(INITIAL_NEW_BUSINESS)

  const fetchBusinesses = useCallback(async () => {
    setError(null)
    try {
      const [bizRes, dirRes] = await Promise.all([
        fetch("/api/platform/businesses"),
        fetch("/api/directory").catch(() => null),
      ])
      const data = await bizRes.json().catch(() => null)
      if (!bizRes.ok) {
        throw new Error(data?.error || "Error al cargar las empresas")
      }
      setBusinesses(data?.businesses ?? [])

      if (dirRes && dirRes.ok) {
        const dirData = await dirRes.json().catch(() => null)
        if (Array.isArray(dirData?.businesses)) {
          setDirectorySlugs(
            new Set(
              dirData.businesses
                .map((b: { slug?: string }) => b.slug)
                .filter((slug: unknown): slug is string => typeof slug === "string")
            )
          )
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar las empresas")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(fetchBusinesses)
  }, [fetchBusinesses])

  const markStatus = (id: string, isActive: boolean) => {
    setBusinesses((prev) =>
      prev.map((b) => (b.id === id ? { ...b, isActive } : b))
    )
  }

  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch("/api/platform/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: newBusiness.businessName.trim(),
          slug: newBusiness.slug.trim() || undefined,
          businessKind: newBusiness.businessKind,
          adminName: newBusiness.adminName.trim(),
          email: newBusiness.email.trim(),
          phone: newBusiness.phone.trim() || undefined,
          password: newBusiness.password,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error || "Error al crear el negocio")
        return
      }
      toast.success("Negocio y cuenta de administrador creados")
      setNewBusiness(INITIAL_NEW_BUSINESS)
      setCreateOpen(false)
      void fetchBusinesses()
    } catch {
      toast.error("Error al crear el negocio")
    } finally {
      setCreating(false)
    }
  }

  const isInDirectory = useCallback(
    (business: PlatformBusiness): boolean => {
      if (!business.isActive) return false
      if (typeof business.showInDirectory === "boolean") {
        return business.showInDirectory
      }
      if (directorySlugs !== null) {
        return directorySlugs.has(business.slug)
      }
      return true
    },
    [directorySlugs]
  )

  const counts = useMemo(() => {
    let active = 0
    let suspended = 0
    let inDirectory = 0
    for (const business of businesses) {
      if (business.isActive) active += 1
      else suspended += 1
      if (isInDirectory(business)) inDirectory += 1
    }
    return {
      all: businesses.length,
      active,
      suspended,
      directory: inDirectory,
    }
  }, [businesses, isInDirectory])

  const filterChips: { id: BusinessFilter; label: string; count: number }[] = [
    { id: "all", label: "Todos", count: counts.all },
    { id: "active", label: "Activos", count: counts.active },
    { id: "suspended", label: "Suspendidos", count: counts.suspended },
    { id: "directory", label: "En directorio", count: counts.directory },
  ]

  const normalizedSearch = search.trim().toLowerCase()
  const hasActiveFilters = normalizedSearch !== "" || statusFilter !== "all"

  const filteredBusinesses = useMemo(() => {
    return businesses.filter((business) => {
      if (statusFilter === "active" && !business.isActive) return false
      if (statusFilter === "suspended" && business.isActive) return false
      if (statusFilter === "directory" && !isInDirectory(business)) return false

      if (!normalizedSearch) return true

      const categoryLabel = directoryCategoryLabel(business.category).toLowerCase()
      return (
        business.name.toLowerCase().includes(normalizedSearch) ||
        business.slug.toLowerCase().includes(normalizedSearch) ||
        business.category.toLowerCase().includes(normalizedSearch) ||
        categoryLabel.includes(normalizedSearch)
      )
    })
  }, [businesses, statusFilter, normalizedSearch, isInDirectory])

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-64"
        role="status"
        aria-label="Cargando negocios registrados"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Cargando negocios…</span>
      </div>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby="platform-businesses-heading">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 id="platform-businesses-heading" className="text-3xl font-bold tracking-tight">
            Empresas
          </h2>
          <p className="text-muted-foreground">
            {counts.all} registrada{counts.all === 1 ? "" : "s"}
            {" · "}
            {counts.active} activa{counts.active === 1 ? "" : "s"}
            {counts.suspended > 0 &&
              ` · ${counts.suspended} suspendida${counts.suspended === 1 ? "" : "s"}`}
            {" · "}
            {counts.directory} en directorio
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Actualizar lista de negocios registrados"
            onClick={() => {
              setLoading(true)
              void fetchBusinesses()
            }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link
              href="/platform/health"
              aria-label="Abrir panel de salud global de la plataforma"
            >
              <HeartPulse className="mr-1.5 h-4 w-4" />
              Salud global
            </Link>
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              // No cerrar a media creación: el submit quedaría huérfano.
              if (!creating) setCreateOpen(next)
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Nuevo negocio
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Registrar nuevo negocio en Reficio</DialogTitle>
                <DialogDescription>
                  Crea el negocio, su sucursal Principal y la cuenta de administrador lista para operar.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateBusiness} className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="new-business-name">Nombre del negocio*</Label>
                  <Input
                    id="new-business-name"
                    name="businessName"
                    placeholder="Taller Central"
                    required
                    minLength={2}
                    maxLength={80}
                    value={newBusiness.businessName}
                    onChange={(e) =>
                      setNewBusiness((prev) => ({ ...prev, businessName: e.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-business-slug">Slug público (opcional)</Label>
                    <Input
                      id="new-business-slug"
                      name="slug"
                      placeholder="taller-central"
                      maxLength={80}
                      value={newBusiness.slug}
                      onChange={(e) =>
                        setNewBusiness((prev) => ({ ...prev, slug: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-business-kind">Giro del negocio</Label>
                    <Select
                      value={newBusiness.businessKind}
                      onValueChange={(value) =>
                        setNewBusiness((prev) => ({
                          ...prev,
                          businessKind: value as BusinessKindOption,
                        }))
                      }
                    >
                      <SelectTrigger id="new-business-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FULL">Taller + Refacciones</SelectItem>
                        <SelectItem value="REPAIR">Solo Taller</SelectItem>
                        <SelectItem value="PARTS">Solo Refacciones</SelectItem>
                        <SelectItem value="PARTNER">Captador Aliado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-business-admin-name">Nombre del administrador*</Label>
                  <Input
                    id="new-business-admin-name"
                    name="adminName"
                    placeholder="Juan Pérez"
                    required
                    maxLength={80}
                    value={newBusiness.adminName}
                    onChange={(e) =>
                      setNewBusiness((prev) => ({ ...prev, adminName: e.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-business-email">Correo del administrador*</Label>
                    <Input
                      id="new-business-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="juan@taller.com"
                      required
                      value={newBusiness.email}
                      onChange={(e) =>
                        setNewBusiness((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-business-phone">Teléfono (opcional)</Label>
                    <Input
                      id="new-business-phone"
                      name="phone"
                      type="tel"
                      placeholder="55 1234 5678"
                      maxLength={30}
                      value={newBusiness.phone}
                      onChange={(e) =>
                        setNewBusiness((prev) => ({ ...prev, phone: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-business-password">Contraseña inicial*</Label>
                  <Input
                    id="new-business-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    required
                    minLength={8}
                    maxLength={100}
                    value={newBusiness.password}
                    onChange={(e) =>
                      setNewBusiness((prev) => ({ ...prev, password: e.target.value }))
                    }
                  />
                </div>
                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={creating}
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Crear negocio
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!error && businesses.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, slug o categoría..."
              aria-label="Buscar negocios por nombre, slug o categoría"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda de negocios"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Filtros rápidos de negocios"
            className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1"
          >
            {filterChips.map((chip) => {
              const active = statusFilter === chip.id
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatusFilter(chip.id)}
                  aria-pressed={active}
                  aria-label={`Filtrar negocios: ${chip.label} (${chip.count})`}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span>{chip.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[11px] tabular-nums",
                      active
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-foreground/80"
                    )}
                  >
                    {chip.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border p-6 space-y-3">
          <p>{error}</p>
          <Button
            variant="outline"
            aria-label="Reintentar carga de negocios registrados"
            onClick={() => {
              setLoading(true)
              void fetchBusinesses()
            }}
          >
            Reintentar
          </Button>
        </div>
      )}

      {!error && businesses.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No hay empresas"
          description="Todavía no se registra ninguna empresa en esta instancia."
          action={{
            label: "Registrar el primer negocio",
            icon: Plus,
            onClick: () => setCreateOpen(true),
          }}
        />
      ) : !error && filteredBusinesses.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <p className="font-medium">No se encontraron negocios con ese criterio</p>
          <p className="text-sm text-muted-foreground">
            Prueba con otro término de búsqueda o cambia el filtro activo.
          </p>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Restablecer búsqueda y filtros de negocios"
              onClick={() => {
                setSearch("")
                setStatusFilter("all")
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
      ) : (
        !error && (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead className="text-right">Productos</TableHead>
                  <TableHead className="text-right">Órdenes</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBusinesses.map((business) => (
                  <TableRow
                    key={business.id}
                    className={business.isActive ? "" : "opacity-70"}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{business.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {directoryCategoryLabel(business.category)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {business.isActive ? (
                        <Link
                          href={`/${business.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Abrir vitrina pública de ${business.name} (/${business.slug}) en nueva pestaña`}
                          className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-xs"
                        >
                          /{business.slug}
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          title="Vitrina inactiva"
                        >
                          /{business.slug}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={business.isActive ? "success" : "destructive"}>
                          {business.isActive ? "Activa" : "Suspendida"}
                        </Badge>
                        {isInDirectory(business) && (
                          <Badge variant="secondary" className="text-xs">
                            En directorio
                          </Badge>
                        )}
                        {business.counts.products === 0 &&
                          business.counts.repairOrders === 0 &&
                          business.counts.sales === 0 && (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground"
                              title="Sin operación registrada: se puede eliminar desde la ficha"
                            >
                              Vacía
                            </Badge>
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {business.counts.users}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {business.counts.products}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {business.counts.repairOrders}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end">
                        <span className="tabular-nums font-medium">
                          {formatPrice(business.salesTotal)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {business.counts.sales} venta
                          {business.counts.sales === 1 ? "" : "s"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {business.lastActivityAt
                        ? formatDate(business.lastActivityAt)
                        : "Sin actividad"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDay(business.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {business.isActive && (
                          <Button variant="ghost" size="icon" asChild>
                            <Link
                              href={`/${business.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Abrir vitrina pública de ${business.name} en nueva pestaña`}
                              title="Abrir vitrina pública"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={`/platform/${business.id}`}
                            aria-label={`Ver detalle de ${business.name}`}
                            title="Ver detalle"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <BusinessStatusButton
                          business={business}
                          size="sm"
                          onChanged={(isActive) => markStatus(business.id, isActive)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </section>
  )
}

export default function PlatformPage() {
  return (
    <div className="space-y-12">
      {/* h1 único de la página: las secciones usan h2. */}
      <h1 className="sr-only">Consola de plataforma</h1>
      <OverviewPanel />
      <PlatformBusinessesSection />
      <DirectoryPanel />
    </div>
  )
}
