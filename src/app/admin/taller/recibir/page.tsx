"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Gamepad2, Grid3x3, Hash, Headphones, KeyRound, Laptop, LockOpen, Monitor, Package, Printer, RotateCcw, ShieldCheck, Smartphone, Tablet, Tv, UserRound, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BusinessName } from "@/components/admin/business-name"
import { IntakeStepper } from "@/components/admin/taller/intake-stepper"
import { PatternPad } from "@/components/admin/taller/pattern-pad"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { repairFolio } from "@/lib/workshop-labels"

type Branch = { id: string; name: string }
type Person = { id: string; name: string }
type CustomerHit = { id: string; name: string; phone: string | null; email: string | null; businessName: string | null }
type AccessType = "NONE" | "PATTERN" | "PIN" | "PASSWORD"
type CreatedOrder = { id: string; number: number; customerName: string }
type LookupField = "customerName" | "customerPhone"

const STEPS = ["Cliente", "Equipo", "Acceso y estado", "Resumen"]
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const PHONE_PATTERN = /^[+\d\s()-]+$/

const EQUIPMENT_TYPES: { value: string; icon: LucideIcon }[] = [
  { value: "Celular", icon: Smartphone }, { value: "Tablet", icon: Tablet },
  { value: "Laptop", icon: Laptop }, { value: "Computadora", icon: Monitor },
  { value: "Consola", icon: Gamepad2 }, { value: "Televisión", icon: Tv },
  { value: "Audio", icon: Headphones }, { value: "Otro", icon: Package },
]
const BRANDS = ["Samsung", "Apple", "Xiaomi", "Motorola", "LG", "Sony", "HP", "Lenovo", "Dell", "Huawei", "Nintendo", "Otra"]
const ACCESS_OPTIONS: { value: AccessType; label: string; icon: LucideIcon }[] = [
  { value: "NONE", label: "Sin bloqueo", icon: LockOpen },
  { value: "PATTERN", label: "Patrón", icon: Grid3x3 },
  { value: "PIN", label: "PIN", icon: Hash },
  { value: "PASSWORD", label: "Contraseña", icon: KeyRound },
]
const ACCESSORY_OPTIONS = ["Cargador", "Cable", "Funda", "Mica", "SIM", "MicroSD", "Caja", "Control remoto", "Otro"]

const emptyForm = {
  customerName: "", customerPhone: "", intakeBranchId: "", assignedToId: "",
  equipmentType: "", equipmentTypeOther: "", brand: "", model: "", equipmentColor: "", serialNumber: "",
  accessType: "NONE" as AccessType, pattern: [] as number[], accessValue: "",
  accessories: [] as string[], accessoryOther: "",
  intakeCondition: "", reportedIssue: "", promisedAt: "",
}

const chipClass = (selected: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${selected ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:border-primary/50 hover:text-foreground"}`

function CustomerSuggestions({ hits, onPick }: { hits: CustomerHit[]; onPick: (hit: CustomerHit) => void }) {
  if (!hits.length) return null
  return (
    <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover shadow-md">
      {hits.map(hit => (
        <li key={hit.id}>
          <button type="button" onClick={() => onPick(hit)} className="w-full px-3 py-2 text-left text-sm transition hover:bg-accent">
            <span className="block font-medium">{hit.name}</span>
            <span className="block text-xs text-muted-foreground">{[hit.phone, hit.businessName || hit.email].filter(Boolean).join(" · ") || "Sin teléfono registrado"}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function SummaryGroup({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: [string, string | undefined][] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon size={15} className="text-primary" />{title}</h3>
      <dl className="space-y-2 text-sm">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{value || "Sin registrar"}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function ReceiveEquipmentPage() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [stepError, setStepError] = useState("")
  const [branches, setBranches] = useState<Branch[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [created, setCreated] = useState<CreatedOrder | null>(null)
  const [lookupField, setLookupField] = useState<LookupField>("customerName")
  const [lookupTerm, setLookupTerm] = useState("")
  const [searchedTerm, setSearchedTerm] = useState("")
  const [suggestions, setSuggestions] = useState<CustomerHit[]>([])
  const [searching, setSearching] = useState(false)
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerHit | null>(null)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const searchVersion = useRef(0)

  const update = (changes: Partial<typeof emptyForm>) => { setDirty(true); setForm(previous => ({ ...previous, ...changes })) }

  useEffect(() => {
    let cancelled = false
    fetch("/api/workshop?page=1")
      .then(response => response.json())
      .then(data => { if (!cancelled) { setBranches(data.branches ?? []); setStaff(data.staff ?? []); setMetaLoaded(true) } })
      .catch(() => { if (!cancelled) { setMetaLoaded(true); toast.error("No se pudieron cargar sucursales y técnicos. Recarga la página.") } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!dirty || created) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [dirty, created])

  useEffect(() => {
    const term = lookupTerm.trim()
    if (term.length < 3) {
      searchVersion.current += 1
      const timer = setTimeout(() => { setSuggestions([]); setSearchedTerm(""); setSearching(false) }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      const version = ++searchVersion.current
      setSearching(true)
      try {
        const params = new URLSearchParams({ search: term, limit: "5" })
        const response = await fetch(`/api/clientes?${params}`)
        const data = await response.json().catch(() => ({}))
        if (version !== searchVersion.current) return
        setSuggestions(response.ok ? data.clientes ?? [] : [])
        setSearchedTerm(term)
      } catch {
        if (version === searchVersion.current) { setSuggestions([]); setSearchedTerm(term) }
      } finally {
        if (version === searchVersion.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [lookupTerm])

  const pickCustomer = (hit: CustomerHit) => {
    searchVersion.current += 1
    update({ customerName: hit.name, ...(hit.phone ? { customerPhone: hit.phone } : {}) })
    setMatchedCustomer(hit)
    setSuggestions([])
    setLookupTerm("")
    setSearchedTerm("")
  }

  const trackLookup = (field: LookupField, value: string) => {
    setLookupField(field)
    setLookupTerm(value)
    setMatchedCustomer(null)
  }

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!form.customerName.trim()) return "Escribe el nombre del cliente."
      const phone = form.customerPhone.trim()
      if (phone.length < 7 || !PHONE_PATTERN.test(phone)) return "Revisa el teléfono: solo dígitos, +, espacios y guiones (mínimo 7 caracteres)."
      if (!form.intakeBranchId) return "Selecciona la sucursal de recepción."
    }
    if (index === 1) {
      if (!form.equipmentType) return "Selecciona el tipo de equipo."
      if (form.equipmentType === "Otro" && !form.equipmentTypeOther.trim()) return "Describe qué tipo de equipo es."
    }
    if (index === 2) {
      if (form.accessType === "PATTERN" && form.pattern.length < 4) return "Dibuja el patrón con al menos 4 puntos, o elige otro tipo de bloqueo."
      if ((form.accessType === "PIN" || form.accessType === "PASSWORD") && !form.accessValue.trim()) return "Escribe el PIN o la contraseña, o cambia el tipo de bloqueo."
      if (form.accessories.includes("Otro") && !form.accessoryOther.trim()) return "Describe el accesorio en el campo Otro."
      if (!form.reportedIssue.trim()) return "Describe la falla que reporta el cliente."
    }
    return null
  }

  const goNext = () => {
    const error = validateStep(step)
    if (error) { setStepError(error); toast.error(error); return }
    setStepError("")
    setStep(current => current + 1)
  }
  const goBack = () => { setStepError(""); setStep(current => current - 1) }

  const accessoryText = form.accessories.map(item => item === "Otro" ? `Otro: ${form.accessoryOther.trim()}` : item).join(" · ")
  const equipmentLabel = form.equipmentType === "Otro" ? form.equipmentTypeOther.trim() : form.equipmentType

  function buildPayload() {
    const accessValue = form.accessType === "PATTERN" ? form.pattern.join("-") : form.accessType === "NONE" ? "" : form.accessValue.trim()
    return Object.fromEntries(Object.entries({
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      intakeBranchId: form.intakeBranchId,
      assignedToId: form.assignedToId,
      equipmentType: equipmentLabel,
      brand: form.brand.trim(),
      model: form.model.trim(),
      equipmentColor: form.equipmentColor.trim(),
      serialNumber: form.serialNumber.trim(),
      deviceAccessType: form.accessType,
      deviceAccessValue: accessValue,
      accessories: accessoryText,
      intakeCondition: form.intakeCondition.trim(),
      reportedIssue: form.reportedIssue.trim(),
      promisedAt: form.promisedAt && !Number.isNaN(Date.parse(form.promisedAt)) ? new Date(form.promisedAt).toISOString() : "",
    }).filter(([, value]) => value !== ""))
  }

  async function createOrder() {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      const payload = buildPayload()
      operationKey.current = getClientOperationKey(operationKey.current, { url: "/api/workshop", ...payload })
      const response = await fetch("/api/workshop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: operationKey.current.key }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se pudo crear la orden. Reintenta sin cambiar los datos.")
      operationKey.current = null
      setCreated(data.order)
      toast.success(`Orden ${repairFolio(data.order.number)} registrada`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Error de conexión. Reintenta sin cambiar los datos.")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const reset = () => {
    setForm(emptyForm)
    setStep(0)
    setStepError("")
    setCreated(null)
    setDirty(false)
    setSuggestions([])
    setMatchedCustomer(null)
    setLookupTerm("")
    setSearchedTerm("")
    operationKey.current = null
  }

  const showNewCustomerNote = searchedTerm.length >= 3 && suggestions.length === 0 && !matchedCustomer && lookupTerm.trim().length >= 3
  const accessOption = ACCESS_OPTIONS.find(option => option.value === form.accessType)
  const accessLabel = accessOption?.label ?? "Sin bloqueo"
  const branchName = branches.find(branch => branch.id === form.intakeBranchId)?.name ?? ""
  const staffName = form.assignedToId ? staff.find(person => person.id === form.assignedToId)?.name ?? "" : "Asignar después"
  const promisedLabel = form.promisedAt ? new Date(form.promisedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : ""

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary"><BusinessName fallback="ProSolutions" /> · Taller</p>
          <h1 className="mt-1 text-3xl font-bold">Recibir equipo</h1>
          <p className="mt-2 text-muted-foreground">Registra la recepción en cuatro pasos: cliente, equipo, acceso y confirmación.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/taller"><ArrowLeft className="mr-2 h-4 w-4" />Volver a órdenes</Link>
        </Button>
      </div>

      {created ? (
        <section className="rounded-xl border bg-card p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="mt-3 text-2xl font-bold">Orden {repairFolio(created.number)} creada</h2>
          <p className="mt-2 text-muted-foreground">El equipo de {created.customerName} quedó registrado como recibido. Entrega el ticket al cliente.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <a href={`/admin/tickets/reparacion/${created.id}`} target="_blank" rel="noreferrer"><Printer className="mr-2 h-4 w-4" />Imprimir ticket de recepción</a>
            </Button>
            <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Registrar otro equipo</Button>
            <Button variant="outline" asChild><Link href="/admin/taller">Ir a órdenes</Link></Button>
          </div>
        </section>
      ) : (
        <>
          <IntakeStepper steps={STEPS} current={step} />
          <section className="rounded-xl border bg-card p-5 sm:p-6">
            <fieldset disabled={saving} className="disabled:opacity-80">
              <h2 className="mb-5 font-semibold">{STEPS[step]}</h2>

              {step === 0 && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="relative block space-y-2 text-sm">Nombre del cliente *
                    <Input value={form.customerName} onChange={event => { update({ customerName: event.target.value }); trackLookup("customerName", event.target.value) }} maxLength={100} autoComplete="off" placeholder="Nombre y apellido" />
                    {lookupField === "customerName" && <CustomerSuggestions hits={suggestions} onPick={pickCustomer} />}
                  </label>
                  <label className="relative block space-y-2 text-sm">Teléfono de contacto *
                    <Input type="tel" value={form.customerPhone} onChange={event => { update({ customerPhone: event.target.value }); trackLookup("customerPhone", event.target.value) }} minLength={7} maxLength={30} autoComplete="off" placeholder="Ej. 55 1234 5678" />
                    {lookupField === "customerPhone" && <CustomerSuggestions hits={suggestions} onPick={pickCustomer} />}
                  </label>
                  {(searching || matchedCustomer || showNewCustomerNote) && (
                    <div className="sm:col-span-2" aria-live="polite">
                      {searching && <p className="text-xs text-muted-foreground">Buscando clientes…</p>}
                      {!searching && matchedCustomer && <p className="text-xs font-medium text-primary">Cliente existente — datos autocompletados.</p>}
                      {!searching && showNewCustomerNote && <p className="text-xs text-muted-foreground">Cliente nuevo — se registrará al crear la orden.</p>}
                    </div>
                  )}
                  <label className="block space-y-2 text-sm">Sucursal de recepción *
                    <select className={inputClass} value={form.intakeBranchId} onChange={event => update({ intakeBranchId: event.target.value })}>
                      <option value="" disabled>Selecciona la sucursal de recepción</option>
                      {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-2 text-sm">Responsable técnico
                    <select className={inputClass} value={form.assignedToId} onChange={event => update({ assignedToId: event.target.value })}>
                      <option value="">Asignar después</option>
                      {staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>
                  </label>
                  {metaLoaded && branches.length === 0 && (
                    <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 sm:col-span-2">
                      No hay sucursales del taller registradas. Crea una desde la pantalla de órdenes antes de recibir equipos.
                    </p>
                  )}
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm">Tipo de equipo *</p>
                    <div className="flex flex-wrap gap-2">
                      {EQUIPMENT_TYPES.map(({ value, icon: Icon }) => (
                        <button key={value} type="button" aria-pressed={form.equipmentType === value} onClick={() => update({ equipmentType: value })} className={chipClass(form.equipmentType === value)}>
                          <Icon size={15} />{value}
                        </button>
                      ))}
                    </div>
                    {form.equipmentType === "Otro" && (
                      <Input value={form.equipmentTypeOther} onChange={event => update({ equipmentTypeOther: event.target.value })} maxLength={100} placeholder="¿Qué equipo es? Ej. smartwatch, bocina, drone…" autoFocus className="mt-2 max-w-sm" />
                    )}
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block space-y-2 text-sm">Marca
                      <Input list="equipment-brands" value={form.brand} onChange={event => update({ brand: event.target.value })} maxLength={100} placeholder="Samsung, Apple, Xiaomi…" />
                      <datalist id="equipment-brands">{BRANDS.map(brand => <option key={brand} value={brand} />)}</datalist>
                    </label>
                    <label className="block space-y-2 text-sm">Modelo
                      <Input value={form.model} onChange={event => update({ model: event.target.value })} maxLength={100} placeholder="Ej. Galaxy A54, iPhone 13…" />
                    </label>
                    <label className="block space-y-2 text-sm">Color
                      <Input value={form.equipmentColor} onChange={event => update({ equipmentColor: event.target.value })} maxLength={60} placeholder="Ej. negro, azul marino…" />
                    </label>
                    <label className="block space-y-2 text-sm">Serie o IMEI
                      <Input value={form.serialNumber} onChange={event => update({ serialNumber: event.target.value })} maxLength={100} placeholder="15 dígitos para celulares" />
                    </label>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-sm">Bloqueo del equipo</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de bloqueo">
                      {ACCESS_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <button key={value} type="button" role="radio" aria-checked={form.accessType === value} onClick={() => update({ accessType: value })} className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition ${form.accessType === value ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}>
                          <Icon size={18} />{label}
                        </button>
                      ))}
                    </div>
                    {form.accessType === "PATTERN" && (
                      <div className="mt-3 rounded-lg border bg-muted/30 p-4">
                        <PatternPad value={form.pattern} onChange={pattern => update({ pattern })} />
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} />Este dato solo es visible para el personal del taller.</p>
                      </div>
                    )}
                    {(form.accessType === "PIN" || form.accessType === "PASSWORD") && (
                      <div className="mt-3 max-w-sm space-y-2">
                        <label className="block space-y-2 text-sm">{form.accessType === "PIN" ? "PIN de desbloqueo" : "Contraseña del equipo"}
                          <Input value={form.accessValue} onChange={event => update({ accessValue: event.target.value })} maxLength={100} autoComplete="off" placeholder={form.accessType === "PIN" ? "Ej. 2468" : "Escríbela tal como la dio el cliente"} />
                        </label>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} />Este dato solo es visible para el personal del taller.</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm">Accesorios recibidos</p>
                    <div className="flex flex-wrap gap-2">
                      {ACCESSORY_OPTIONS.map(item => (
                        <button key={item} type="button" aria-pressed={form.accessories.includes(item)} onClick={() => update({ accessories: form.accessories.includes(item) ? form.accessories.filter(accessory => accessory !== item) : [...form.accessories, item] })} className={chipClass(form.accessories.includes(item))}>
                          {item}
                        </button>
                      ))}
                    </div>
                    {form.accessories.includes("Otro") && (
                      <Input value={form.accessoryOther} onChange={event => update({ accessoryOther: event.target.value })} maxLength={120} placeholder="¿Qué otro accesorio? Ej. mochila, base de carga…" className="mt-2 max-w-sm" />
                    )}
                  </div>
                  <div className="grid gap-5">
                    <label className="block space-y-2 text-sm">Estado físico al recibir
                      <textarea value={form.intakeCondition} onChange={event => update({ intakeCondition: event.target.value })} maxLength={500} rows={3} className={inputClass} placeholder="Golpes, humedad, piezas faltantes…" />
                    </label>
                    <label className="block space-y-2 text-sm">Falla que reporta el cliente *
                      <textarea value={form.reportedIssue} onChange={event => update({ reportedIssue: event.target.value })} maxLength={500} rows={3} className={inputClass} placeholder="Describe lo que ocurre y desde cuándo." />
                    </label>
                    <label className="block max-w-xs space-y-2 text-sm">Fecha promesa de entrega
                      <Input type="datetime-local" value={form.promisedAt} onChange={event => update({ promisedAt: event.target.value })} />
                    </label>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground">Revisa que la información esté completa antes de crear la orden.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SummaryGroup title="Cliente" icon={UserRound} items={[
                      ["Nombre", form.customerName.trim()],
                      ["Teléfono", form.customerPhone.trim()],
                      ["Sucursal de recepción", branchName],
                      ["Responsable técnico", staffName],
                    ]} />
                    <SummaryGroup title="Equipo" icon={Package} items={[
                      ["Tipo", equipmentLabel],
                      ["Marca", form.brand.trim()],
                      ["Modelo", form.model.trim()],
                      ["Color", form.equipmentColor.trim()],
                      ["Serie o IMEI", form.serialNumber.trim()],
                    ]} />
                    <SummaryGroup title="Acceso" icon={accessOption?.icon ?? LockOpen} items={[
                      ["Bloqueo del equipo", accessLabel],
                      ["Accesorios recibidos", accessoryText],
                    ]} />
                    <SummaryGroup title="Estado" icon={ShieldCheck} items={[
                      ["Falla reportada", form.reportedIssue.trim()],
                      ["Estado físico", form.intakeCondition.trim()],
                      ["Fecha promesa", promisedLabel],
                    ]} />
                  </div>
                </div>
              )}

              {stepError && <p role="alert" className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{stepError}</p>}

              <div className="mt-6 flex items-center justify-between border-t pt-5">
                {step > 0
                  ? <Button type="button" variant="outline" onClick={goBack}><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button>
                  : <span />}
                {step < STEPS.length - 1
                  ? <Button type="button" onClick={goNext}>Siguiente<ArrowRight className="ml-2 h-4 w-4" /></Button>
                  : <Button type="button" onClick={() => void createOrder()} disabled={saving}>{saving ? "Creando…" : "Crear orden"}</Button>}
              </div>
            </fieldset>
          </section>
        </>
      )}
    </div>
  )
}
