"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowLeftRight, ArrowRight, Banknote, CalendarClock, CheckCircle2, CircleDollarSign, CreditCard, Droplets, Gamepad2, Grid3x3, Hash, Headphones, KeyRound, Laptop, LockOpen, MapPin, MessageCircle, Monitor, Package, PowerOff, Printer, Puzzle, RotateCcw, Search, ShieldAlert, ShieldCheck, Smartphone, Tablet, Tv, UserRound, Watch, Wrench, X, Zap, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BusinessName } from "@/components/admin/business-name"
import { IntakeStepper } from "@/components/admin/taller/intake-stepper"
import { PatternPad } from "@/components/admin/taller/pattern-pad"
import { PhoneInput, parsePhone } from "@/components/admin/taller/phone-input"
import { SignaturePad } from "@/components/admin/taller/signature-pad"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { CONDITION_HINTS, deviceProfileFor } from "@/lib/device-profiles"
import { formatAccessPattern, titleCaseName } from "@/lib/utils"
import { DEFAULT_ORDER_PREFIX, formatFolio } from "@/lib/workshop-labels"
import { waMeHref } from "@/components/public/whatsapp-button"

type Branch = { id: string; name: string }
type Person = { id: string; name: string }
type CustomerHit = { id: string; name: string; phone: string | null; email: string | null; businessName: string | null }
type AccessType = "NONE" | "PATTERN" | "PIN" | "PASSWORD"
type FunctionalCondition = "ENCENDIDO" | "APAGADO" | "MOJADO" | "MANIPULADO" | "ROTO" | "INCOMPLETO"
type Aesthetics = "BUENO" | "REGULAR" | "MALO"
type AdvanceMethod = "CASH" | "CARD" | "TRANSFER"
type CreatedOrder = { id: string; number: number; customerName: string }
type LookupField = "customerName" | "customerPhone"
type WorkshopService = { id: string; name: string; description: string | null; priceCents: number | null; equipmentType: string | null }
type DeviceModel = { id: string; brand: string; model: string; code: string | null; type: string }

const STEPS = ["Cliente", "Equipo", "Acceso y estado", "Entrega y cobro", "Resumen"]
const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const PHONE_PATTERN = /^[+\d\s()-]+$/
const MAX_ADVANCE_AMOUNT = 999999
const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100)

const DEFAULT_EQUIPMENT_TYPES = ["Celular", "Tablet", "Laptop", "Computadora", "Consola", "Smartwatch", "Pantalla", "Impresora", "Otro"]
const DEFAULT_LOCATIONS = ["Recepción", "Mesa 1", "Mesa 2", "Anaquel A", "Anaquel B"]
const EQUIPMENT_ICONS: Record<string, LucideIcon> = {
  Celular: Smartphone, Tablet, Laptop, Computadora: Monitor, Consola: Gamepad2,
  Smartwatch: Watch, Pantalla: Monitor, Impresora: Printer, "Televisión": Tv, Audio: Headphones, Otro: Package,
}
const FUNCTIONAL_CONDITIONS: { value: FunctionalCondition; label: string; icon: LucideIcon }[] = [
  { value: "ENCENDIDO", label: "Encendido", icon: Zap },
  { value: "APAGADO", label: "Apagado", icon: PowerOff },
  { value: "MOJADO", label: "Mojado", icon: Droplets },
  { value: "MANIPULADO", label: "Manipulado", icon: Wrench },
  { value: "ROTO", label: "Roto", icon: ShieldAlert },
  { value: "INCOMPLETO", label: "Incompleto", icon: Puzzle },
]
const AESTHETIC_OPTIONS: { value: Aesthetics; label: string }[] = [
  { value: "BUENO", label: "Bueno" }, { value: "REGULAR", label: "Regular" }, { value: "MALO", label: "Malo" },
]
const ADVANCE_METHODS: { value: AdvanceMethod; label: string; icon: LucideIcon }[] = [
  { value: "CASH", label: "Efectivo", icon: Banknote },
  { value: "CARD", label: "Tarjeta", icon: CreditCard },
  { value: "TRANSFER", label: "Transferencia", icon: ArrowLeftRight },
]
// Piezas que el equipo NO trae (faltantes al recibirlo). Viajan por el mismo
// campo `accessories` de la orden pero se capturan en un grupo aparte para que
// el staff no las lea como accesorios recibidos.
const MISSING_ITEMS = ["Sin bandeja SIM", "Sin tapa trasera", "Sin pantalla", "Sin batería", "Sin cargador"]
const MISSING_SET = new Set(MISSING_ITEMS)
// serviceName se guarda como "A + B + …" en un campo de 500 caracteres:
// 4 servicios del catálogo (120 c/u) siempre caben.
const MAX_SERVICES = 4
const EQUIPMENT_COLORS: { label: string; hex: string }[] = [
  { label: "Negro", hex: "#1c1c1e" }, { label: "Blanco", hex: "#f5f5f4" }, { label: "Azul", hex: "#2563eb" },
  { label: "Rojo", hex: "#dc2626" }, { label: "Rosa", hex: "#ec4899" }, { label: "Dorado", hex: "#c9a227" },
  { label: "Plata", hex: "#c0c0c0" }, { label: "Gris", hex: "#6b7280" }, { label: "Verde", hex: "#16a34a" },
  { label: "Morado", hex: "#9333ea" }, { label: "Naranja", hex: "#ea580c" }, { label: "Amarillo", hex: "#eab308" },
]
const ACCESS_OPTIONS: { value: AccessType; label: string; icon: LucideIcon }[] = [
  { value: "NONE", label: "Sin bloqueo", icon: LockOpen },
  { value: "PATTERN", label: "Patrón", icon: Grid3x3 },
  { value: "PIN", label: "PIN", icon: Hash },
  { value: "PASSWORD", label: "Contraseña", icon: KeyRound },
]
const emptyForm = {
  customerName: "", customerPhone: "", customerPhoneDial: "+52", phoneAltVisible: false, customerPhoneAlt: "", customerPhoneAltDial: "+52",
  intakeBranchId: "", assignedToId: "",
  equipmentType: "", equipmentTypeOther: "", brand: "", model: "", equipmentColor: "", equipmentColorCustom: false, serialNumber: "",
  serviceName: "", servicePriceCents: null as number | null, otherService: "", budgetAmount: "", signatureData: "",
  services: [] as WorkshopService[],
  accessType: "NONE" as AccessType, pattern: [] as number[], accessValue: "",
  accessories: [] as string[], accessoryOther: "",
  functionalConditions: [] as FunctionalCondition[], aesthetics: "" as Aesthetics | "",
  intakeCondition: "", reportedIssue: "",
  promisedAt: "", scheduledAt: "", location: "",
  advanceEnabled: false, advanceAmount: "", advanceMethod: "CASH" as AdvanceMethod,
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

function SummaryGroup({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: [string, ReactNode][] }) {
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
  const [lookupDown, setLookupDown] = useState(false)
  const [matchedCustomer, setMatchedCustomer] = useState<CustomerHit | null>(null)
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>(DEFAULT_EQUIPMENT_TYPES)
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS)
  const [serviceQuery, setServiceQuery] = useState("")
  const [serviceResults, setServiceResults] = useState<WorkshopService[]>([])
  const [serviceSearching, setServiceSearching] = useState(false)
  const [serviceSearched, setServiceSearched] = useState("")
  const [serviceCatalogDown, setServiceCatalogDown] = useState(false)
  const [brandTerm, setBrandTerm] = useState("")
  const [brandHits, setBrandHits] = useState<DeviceModel[]>([])
  const [brandSearching, setBrandSearching] = useState(false)
  const [brandSearched, setBrandSearched] = useState("")
  const [brandCatalogDown, setBrandCatalogDown] = useState(false)
  const [modelTerm, setModelTerm] = useState("")
  const [modelHits, setModelHits] = useState<DeviceModel[]>([])
  const [modelSearching, setModelSearching] = useState(false)
  const [modelSearched, setModelSearched] = useState("")
  const [modelCatalogDown, setModelCatalogDown] = useState(false)
  const [pickedModel, setPickedModel] = useState<DeviceModel | null>(null)
  // Prefijo del folio impreso (ajuste `order_prefix` del negocio); OT por defecto.
  const [orderPrefix, setOrderPrefix] = useState(DEFAULT_ORDER_PREFIX)
  const operationKey = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const searchVersion = useRef(0)
  const serviceVersion = useRef(0)
  const brandVersion = useRef(0)
  const modelVersion = useRef(0)
  const serviceBoxRef = useRef<HTMLDivElement | null>(null)
  const nameBoxRef = useRef<HTMLLabelElement | null>(null)
  const phoneBoxRef = useRef<HTMLDivElement | null>(null)
  const brandBoxRef = useRef<HTMLLabelElement | null>(null)
  const modelBoxRef = useRef<HTMLLabelElement | null>(null)

  // Cualquier captura limpia el aviso de validación del paso: el usuario ya está corrigiendo.
  const update = (changes: Partial<typeof emptyForm>) => { setDirty(true); setStepError(""); setForm(previous => ({ ...previous, ...changes })) }

  // Al cambiar la lada se reescribe el teléfono con el nuevo código y el mismo número local.
  const setPhoneDial = (phoneField: "customerPhone" | "customerPhoneAlt") => (dial: string) => {
    setDirty(true)
    setStepError("")
    setForm(previous => {
      const local = parsePhone(previous[phoneField]).local
      const combined = local ? `${dial} ${local}` : ""
      return phoneField === "customerPhone"
        ? { ...previous, customerPhoneDial: dial, customerPhone: combined }
        : { ...previous, customerPhoneAltDial: dial, customerPhoneAlt: combined }
    })
  }

  // SignaturePad emite onChange tras cada render si el handler cambia; el handler
  // memoizado + el bail-out por valor evitan un ciclo de render infinito.
  const handleSignature = useCallback((dataUrl: string | null) => {
    const next = dataUrl ?? ""
    setDirty(true)
    setForm(previous => previous.signatureData === next ? previous : { ...previous, signatureData: next })
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/workshop?page=1")
      .then(response => response.json())
      .then(data => { if (!cancelled) { setBranches(data.branches ?? []); setStaff(data.staff ?? []); setMetaLoaded(true) } })
      .catch(() => { if (!cancelled) { setMetaLoaded(true); toast.error("No se pudieron cargar sucursales y técnicos. Recarga la página.") } })
    fetch("/api/workshop-config")
      .then(response => (response.ok ? response.json() : Promise.reject(new Error("sin configuración"))))
      .then(data => {
        if (cancelled) return
        const types = Array.isArray(data.equipmentTypes) && data.equipmentTypes.length ? data.equipmentTypes : DEFAULT_EQUIPMENT_TYPES
        setEquipmentTypes(types.includes("Otro") ? types : [...types, "Otro"])
        setLocations(Array.isArray(data.locations) && data.locations.length ? data.locations : DEFAULT_LOCATIONS)
      })
      .catch(() => { /* sin catálogo de configuración: se usan los valores por defecto */ })
    fetch("/api/settings")
      .then(response => (response.ok ? response.json() : Promise.reject(new Error("sin ajustes"))))
      .then(data => { if (!cancelled && typeof data.orderPrefix === "string" && data.orderPrefix.trim()) setOrderPrefix(data.orderPrefix) })
      .catch(() => { /* sin ajustes: folio con el prefijo por defecto */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const term = serviceQuery.trim()
    if (term.length < 2) {
      serviceVersion.current += 1
      const timer = setTimeout(() => { setServiceResults([]); setServiceSearched(""); setServiceSearching(false) }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      const version = ++serviceVersion.current
      setServiceSearching(true)
      try {
        const response = await fetch(`/api/workshop-services?q=${encodeURIComponent(term)}`)
        const data = await response.json().catch(() => ({}))
        if (version !== serviceVersion.current) return
        setServiceResults(response.ok ? data.services ?? [] : [])
        setServiceCatalogDown(!response.ok)
        setServiceSearched(term)
      } catch {
        if (version === serviceVersion.current) { setServiceResults([]); setServiceCatalogDown(true); setServiceSearched(term) }
      } finally {
        if (version === serviceVersion.current) setServiceSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [serviceQuery])

  // Cierra la lista de servicios al hacer clic fuera del buscador o con Escape.
  useEffect(() => {
    if (!serviceResults.length) return
    const close = () => { setServiceResults([]); setServiceSearched("") }
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (serviceBoxRef.current && !serviceBoxRef.current.contains(event.target as Node)) close()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [serviceResults.length])

  // Cierra las sugerencias de cliente al hacer clic fuera del campo activo o con Escape.
  useEffect(() => {
    if (!suggestions.length) return
    const close = () => { setSuggestions([]); setSearchedTerm("") }
    const closeOnOutsideClick = (event: PointerEvent) => {
      const box = (lookupField === "customerPhone" ? phoneBoxRef : nameBoxRef).current
      if (box && !box.contains(event.target as Node)) close()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [suggestions.length, lookupField])

  // Cierra las sugerencias de marca/modelo al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!brandHits.length) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (brandBoxRef.current && !brandBoxRef.current.contains(event.target as Node)) setBrandHits([])
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setBrandHits([]) }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [brandHits.length])

  useEffect(() => {
    if (!modelHits.length) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (modelBoxRef.current && !modelBoxRef.current.contains(event.target as Node)) setModelHits([])
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setModelHits([]) }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [modelHits.length])

  useEffect(() => {
    const term = brandTerm.trim()
    if (term.length < 1) {
      brandVersion.current += 1
      const timer = setTimeout(() => { setBrandHits([]); setBrandSearched(""); setBrandCatalogDown(false); setBrandSearching(false) }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      const version = ++brandVersion.current
      setBrandSearching(true)
      try {
        const response = await fetch(`/api/device-models?q=${encodeURIComponent(term)}`)
        const data = await response.json().catch(() => ({}))
        if (version !== brandVersion.current) return
        setBrandHits(response.ok ? data.models ?? [] : [])
        setBrandCatalogDown(!response.ok)
        setBrandSearched(term)
      } catch {
        if (version === brandVersion.current) { setBrandHits([]); setBrandCatalogDown(true); setBrandSearched(term) }
      } finally {
        if (version === brandVersion.current) setBrandSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [brandTerm])

  useEffect(() => {
    const term = modelTerm.trim()
    if (term.length < 1) {
      modelVersion.current += 1
      const timer = setTimeout(() => { setModelHits([]); setModelSearched(""); setModelCatalogDown(false); setModelSearching(false) }, 0)
      return () => clearTimeout(timer)
    }
    const brand = form.brand.trim()
    const timer = setTimeout(async () => {
      const version = ++modelVersion.current
      setModelSearching(true)
      try {
        const params = new URLSearchParams({ q: term })
        if (brand) params.set("brand", brand)
        const response = await fetch(`/api/device-models?${params}`)
        const data = await response.json().catch(() => ({}))
        if (version !== modelVersion.current) return
        setModelHits(response.ok ? data.models ?? [] : [])
        setModelCatalogDown(!response.ok)
        setModelSearched(term)
      } catch {
        if (version === modelVersion.current) { setModelHits([]); setModelCatalogDown(true); setModelSearched(term) }
      } finally {
        if (version === modelVersion.current) setModelSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [modelTerm, form.brand])

  // Aviso de recepción sin guardar: beforeunload cubre recargar/cerrar y el clic
  // en captura intercepta la navegación interna por <Link>/<a> (SPA).
  useEffect(() => {
    if (!dirty || created) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const href = anchor.getAttribute("href") ?? ""
      if (!href || href.startsWith("#")) return
      let url: URL
      try { url = new URL(href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || url.href === window.location.href) return
      if (!window.confirm("Hay una recepción sin guardar. ¿Salir y perder los datos?")) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    document.addEventListener("click", confirmInternalNavigation, true)
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload)
      document.removeEventListener("click", confirmInternalNavigation, true)
    }
  }, [dirty, created])

  useEffect(() => {
    // Por teléfono se busca solo con los dígitos locales: User.phone está
    // normalizado a 10 dígitos y la lada ("+52 667…") nunca empata como texto.
    const term = lookupField === "customerPhone" ? parsePhone(lookupTerm).local : lookupTerm.trim()
    if (term.length < 3) {
      searchVersion.current += 1
      const timer = setTimeout(() => { setSuggestions([]); setSearchedTerm(""); setLookupDown(false); setSearching(false) }, 0)
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
        setLookupDown(!response.ok)
        setSearchedTerm(term)
      } catch {
        if (version === searchVersion.current) { setSuggestions([]); setLookupDown(true); setSearchedTerm(term) }
      } finally {
        if (version === searchVersion.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [lookupTerm, lookupField])

  const pickCustomer = (hit: CustomerHit) => {
    searchVersion.current += 1
    const phone = hit.phone ? parsePhone(hit.phone) : null
    update({
      customerName: hit.name,
      ...(phone?.local ? { customerPhoneDial: phone.dial ?? "+52", customerPhone: `${phone.dial ?? "+52"} ${phone.local}` } : {}),
    })
    setMatchedCustomer(hit)
    setSuggestions([])
    setLookupTerm("")
    setSearchedTerm("")
    setLookupDown(false)
  }

  const trackLookup = (field: LookupField, value: string) => {
    if (field !== lookupField) {
      // Al cambiar de campo se invalidan las respuestas en vuelo y se limpia la
      // lista: las sugerencias del campo anterior no deben pintarse en el nuevo.
      searchVersion.current += 1
      setSuggestions([])
      setSearchedTerm("")
      setLookupDown(false)
    }
    setLookupField(field)
    setLookupTerm(value)
    setMatchedCustomer(null)
  }

  // Une los servicios elegidos en serviceName ("A + B") y, solo si TODOS traen
  // precio fijo, propone la suma como presupuesto estimado.
  const servicesPatch = (services: WorkshopService[]) => {
    const total = services.length > 0 && services.every(service => typeof service.priceCents === "number")
      ? services.reduce((sum, service) => sum + (service.priceCents ?? 0), 0)
      : null
    return {
      services,
      serviceName: services.map(service => service.name).join(" + "),
      servicePriceCents: total,
      // La suma solo autollenar el presupuesto con catálogo completo de precios;
      // si alguno es "según dispositivo" el campo queda editable como antes.
      ...(total !== null ? { budgetAmount: (total / 100).toFixed(2) } : {}),
    }
  }

  const pickService = (service: WorkshopService) => {
    serviceVersion.current += 1
    setDirty(true)
    setStepError("")
    setForm(previous =>
      previous.services.some(item => item.id === service.id) || previous.services.length >= MAX_SERVICES
        ? previous
        : { ...previous, ...servicesPatch([...previous.services, service]) },
    )
    setServiceQuery("")
    setServiceResults([])
    setServiceSearched("")
  }

  const removeService = (id: string) => {
    setDirty(true)
    setStepError("")
    setForm(previous => ({ ...previous, ...servicesPatch(previous.services.filter(item => item.id !== id)) }))
  }

  const pickBrand = (brand: string) => {
    brandVersion.current += 1
    update({ brand })
    setBrandTerm("")
    setBrandHits([])
  }

  const pickDeviceModel = (device: DeviceModel) => {
    modelVersion.current += 1
    brandVersion.current += 1
    // Se guarda el nombre del modelo; el código (SM-XXXX) queda como referencia visible.
    update({ brand: device.brand, model: device.model })
    setModelTerm("")
    setModelHits([])
    // La marca queda escrita por el modelo: restos de la búsqueda de marca no aplican.
    setBrandTerm("")
    setBrandHits([])
    setPickedModel(device)
  }

  const toggleCondition = (value: FunctionalCondition) => {
    update({ functionalConditions: form.functionalConditions.includes(value) ? form.functionalConditions.filter(condition => condition !== value) : [...form.functionalConditions, value] })
  }

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!form.customerName.trim()) return "Escribe el nombre del cliente."
      const phone = form.customerPhone.trim()
      if (parsePhone(phone).local.length < 7 || !PHONE_PATTERN.test(phone)) return "Revisa el teléfono: al menos 7 dígitos después de la lada."
      const phoneAlt = form.customerPhoneAlt.trim()
      if (phoneAlt && (parsePhone(phoneAlt).local.length < 7 || !PHONE_PATTERN.test(phoneAlt))) return "Revisa el teléfono alterno: al menos 7 dígitos después de la lada."
      if (!form.intakeBranchId) return "Selecciona la sucursal de recepción."
    }
    if (index === 1) {
      if (!form.equipmentType) return "Selecciona el tipo de equipo."
      if (form.equipmentType === "Otro" && !form.equipmentTypeOther.trim()) return "Describe qué tipo de equipo es."
      const budget = Number.parseFloat(form.budgetAmount)
      if (form.budgetAmount.trim() && (!Number.isFinite(budget) || budget < 0 || budget > 1000000)) return "Revisa el presupuesto estimado: debe ser un importe positivo."
    }
    if (index === 2) {
      if (form.accessType === "PATTERN" && form.pattern.length < 4) return "Dibuja el patrón con al menos 4 puntos, o elige otro tipo de bloqueo."
      if ((form.accessType === "PIN" || form.accessType === "PASSWORD") && !form.accessValue.trim()) return "Escribe el PIN o la contraseña, o cambia el tipo de bloqueo."
      if (form.accessories.includes("Otro") && !form.accessoryOther.trim()) return "Describe el accesorio en el campo Otro."
      // El servicio del catálogo es un dato aparte; la falla exige texto propio del cliente.
      if (!form.reportedIssue.trim()) return "Describe la falla que reporta el cliente."
      if (reportedIssueText.length > 500) return `La falla junto con Otro servicio suma ${reportedIssueText.length} caracteres y el límite es 500. Acorta alguno de los dos campos.`
    }
    if (index === 3) {
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      if (form.promisedAt) {
        const when = new Date(form.promisedAt)
        if (Number.isNaN(when.getTime())) return "Revisa la fecha promesa de entrega."
        if (when < startOfToday) return "La fecha promesa de entrega no puede ser anterior a hoy."
      }
      if (form.scheduledAt) {
        const when = new Date(form.scheduledAt)
        if (Number.isNaN(when.getTime())) return "Revisa la fecha programada de reparación."
        if (when < startOfToday) return "La fecha programada de reparación no puede ser anterior a hoy."
      }
      if (form.advanceEnabled) {
        const amount = Number.parseFloat(form.advanceAmount)
        if (!Number.isFinite(amount) || amount <= 0) return "Escribe el monto del anticipo."
        if (amount > MAX_ADVANCE_AMOUNT) return `El anticipo no puede superar ${money(MAX_ADVANCE_AMOUNT * 100)}.`
      }
    }
    return null
  }

  // Al cambiar de paso no quedan listas desplegadas ni búsquedas a medias.
  const closeDropdowns = () => {
    setSuggestions([])
    setSearchedTerm("")
    setServiceResults([])
    setServiceSearched("")
    setBrandHits([])
    setBrandSearched("")
    setBrandCatalogDown(false)
    setModelHits([])
    setModelSearched("")
    setModelCatalogDown(false)
  }

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" })

  const goNext = () => {
    const error = validateStep(step)
    if (error) { setStepError(error); toast.error(error); return }
    setStepError("")
    closeDropdowns()
    setStep(current => current + 1)
    scrollToTop()
  }
  const goBack = () => { setStepError(""); closeDropdowns(); setStep(current => current - 1); scrollToTop() }

  const accessoryText = form.accessories.map(item => item === "Otro" ? `Otro: ${form.accessoryOther.trim()}` : item).join(" · ")
  const equipmentLabel = form.equipmentType === "Otro" ? form.equipmentTypeOther.trim() : form.equipmentType
  // serviceName viaja en su propio campo del payload; no se repite dentro de la falla.
  const reportedIssueText = [form.otherService.trim(), form.reportedIssue.trim()].filter(Boolean).join(" · ")
  const advanceAmountNumber = Number.parseFloat(form.advanceAmount)
  const advanceCents = form.advanceEnabled && Number.isFinite(advanceAmountNumber) ? Math.round(advanceAmountNumber * 100) : 0
  const advanceMethodLabel = ADVANCE_METHODS.find(method => method.value === form.advanceMethod)?.label ?? ""
  const budgetNumber = Number.parseFloat(form.budgetAmount)
  const budgetCents = form.budgetAmount.trim() !== "" && Number.isFinite(budgetNumber) && budgetNumber >= 0 ? Math.round(budgetNumber * 100) : 0
  const budgetLabel = budgetCents > 0 ? money(budgetCents) : ""

  function buildPayload() {
    const accessValue = form.accessType === "PATTERN" ? form.pattern.join("-") : form.accessType === "NONE" ? "" : form.accessValue.trim()
    return Object.fromEntries(Object.entries({
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      customerPhoneAlt: form.customerPhoneAlt.trim(),
      intakeBranchId: form.intakeBranchId,
      assignedToId: form.assignedToId,
      equipmentType: equipmentLabel,
      brand: form.brand.trim(),
      model: form.model.trim(),
      equipmentColor: form.equipmentColor.trim(),
      serialNumber: form.serialNumber.trim(),
      serviceName: form.serviceName.trim(),
      deviceAccessType: form.accessType,
      deviceAccessValue: accessValue,
      accessories: accessoryText,
      intakeCondition: form.intakeCondition.trim(),
      reportedIssue: reportedIssueText,
      signatureData: form.signatureData,
      // El presupuesto de recepción viaja en su propio campo.
      quoteCents: budgetCents || undefined,
      functionalConditions: form.functionalConditions.length ? form.functionalConditions : "",
      aesthetics: form.aesthetics,
      location: form.location.trim(),
      promisedAt: form.promisedAt && !Number.isNaN(Date.parse(form.promisedAt)) ? new Date(form.promisedAt).toISOString() : "",
      scheduledAt: form.scheduledAt && !Number.isNaN(Date.parse(form.scheduledAt)) ? new Date(form.scheduledAt).toISOString() : "",
      advance: form.advanceEnabled && advanceCents > 0 ? { amountCents: advanceCents, method: form.advanceMethod } : "",
    }).filter(([, value]) => value !== "" && value !== undefined))
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
      toast.success(`Orden ${formatFolio(orderPrefix, data.order.number)} registrada`)
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
    setLookupDown(false)
    setServiceQuery("")
    setServiceResults([])
    setServiceSearched("")
    setServiceCatalogDown(false)
    setBrandTerm("")
    setBrandHits([])
    setModelTerm("")
    setModelHits([])
    setPickedModel(null)
    operationKey.current = null
    scrollToTop()
  }

  // Mismo término normalizado que viaja a /api/clientes (dígitos si es teléfono).
  const lookupTermSearched = lookupField === "customerPhone" ? parsePhone(lookupTerm).local : lookupTerm.trim()
  const lookupFailed = lookupDown && searchedTerm === lookupTermSearched && searchedTerm.length >= 3
  const showNewCustomerNote = !lookupDown && searchedTerm === lookupTermSearched && searchedTerm.length >= 3 && suggestions.length === 0 && !matchedCustomer
  const profile = deviceProfileFor(form.equipmentType)
  // Sugerencias del perfil + lo ya seleccionado aunque no aplique al tipo + "Otro" libre.
  // Los faltantes ("Sin …") se capturan en su propio grupo más abajo.
  const accessoryChips = [...new Set([...profile.accessorySuggestions, ...form.accessories, "Otro"])].filter(item => !MISSING_SET.has(item))
  // Resumen: lo recibido y lo faltante se muestran por separado aunque viajan juntos.
  const receivedAccessoryText = form.accessories.filter(item => !MISSING_SET.has(item)).map(item => item === "Otro" ? `Otro: ${form.accessoryOther.trim()}` : item).join(" · ")
  const missingAccessoryText = form.accessories.filter(item => MISSING_SET.has(item)).join(" · ")
  const allowedAccessOptions = ACCESS_OPTIONS.filter(option => profile.accessTypes.includes(option.value))
  const conditionHints = form.functionalConditions.map(condition => CONDITION_HINTS[condition]).filter((hint): hint is string => Boolean(hint))
  const accessOption = ACCESS_OPTIONS.find(option => option.value === form.accessType)
  const accessLabel = accessOption?.label ?? "Sin bloqueo"
  // El resumen muestra el valor de acceso al staff; el patrón se cuenta 1-9 como lo dibujó el cliente.
  const accessValueLabel = form.accessType === "PATTERN" ? "Patrón" : form.accessType === "PIN" ? "PIN" : "Contraseña"
  const accessValueSummary = form.accessType === "PATTERN" ? formatAccessPattern(form.pattern.join("-")) : form.accessValue.trim()
  const branchName = branches.find(branch => branch.id === form.intakeBranchId)?.name ?? ""
  const staffName = form.assignedToId ? staff.find(person => person.id === form.assignedToId)?.name ?? "" : "Asignar después"
  const promisedLabel = form.promisedAt ? new Date(form.promisedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : ""
  const scheduledLabel = form.scheduledAt && !Number.isNaN(Date.parse(form.scheduledAt)) ? new Date(form.scheduledAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : ""
  const aestheticsLabel = AESTHETIC_OPTIONS.find(option => option.value === form.aesthetics)?.label ?? ""
  const serviceSummary = [form.serviceName, form.otherService.trim()].filter(Boolean).join(" · ")
  const brandOptions = [...new Set(brandHits.map(hit => hit.brand))].slice(0, 8)
  // Los servicios cuyo equipmentType coincide con el equipo recibido van primero
  // en la lista y llevan una insignia "para {tipo}".
  const equipmentTypeKey = equipmentLabel.trim().toLowerCase()
  const serviceMatchesEquipment = (service: WorkshopService) => Boolean(equipmentTypeKey) && (service.equipmentType ?? "").trim().toLowerCase() === equipmentTypeKey
  const sortedServiceResults = [...serviceResults].sort((a, b) => Number(serviceMatchesEquipment(b)) - Number(serviceMatchesEquipment(a)))
  // Los ya elegidos no se ofrecen de nuevo en el desplegable.
  const visibleServiceResults = sortedServiceResults.filter(service => !form.services.some(item => item.id === service.id))
  // Enlace de WhatsApp para avisar al cliente que su equipo ya quedó registrado:
  // mismo armado que notifyWhatsApp de /api/workshop/[id] (folio + tracking).
  const trackingBase = typeof window === "undefined" ? "" : window.location.origin
  const createdFolio = created ? formatFolio(orderPrefix, created.number) : ""
  const createdPhone4 = form.customerPhone.replace(/\D/g, "").slice(-4)
  const createdWhatsApp = created && form.customerPhone.trim()
    ? waMeHref(form.customerPhone, `Hola ${form.customerName.trim()}, recibimos tu equipo con el folio ${createdFolio}. Sigue tu reparación aquí: ${trackingBase}/seguimiento?folio=${encodeURIComponent(createdFolio)}${createdPhone4 ? `&t=${createdPhone4}` : ""}`)
    : null
  const advanceLabel = advanceCents > 0 ? `${money(advanceCents)} · ${advanceMethodLabel}` : ""
  const toLocalInputValue = (date: Date) => { const copy = new Date(date); copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset()); return copy.toISOString().slice(0, 16) }
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const minDateTime = toLocalInputValue(startOfToday)
  const conditionChips = form.functionalConditions.length ? (
    <span className="flex flex-wrap gap-1.5">
      {form.functionalConditions.map(value => {
        const option = FUNCTIONAL_CONDITIONS.find(item => item.value === value)
        if (!option) return null
        const ConditionIcon = option.icon
        return <span key={value} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"><ConditionIcon size={12} />{option.label}</span>
      })}
    </span>
  ) : undefined

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary"><BusinessName fallback="ProSolutions" /> · Taller</p>
          <h1 className="mt-1 text-3xl font-bold">Recibir equipo</h1>
          <p className="mt-2 text-muted-foreground">Registra la recepción en cinco pasos: cliente, equipo, acceso, entrega y confirmación.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/taller"><ArrowLeft className="mr-2 h-4 w-4" />Volver a órdenes</Link>
        </Button>
      </div>

      {created ? (
        <section className="rounded-xl border bg-card p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="mt-3 text-2xl font-bold">Orden {createdFolio} creada</h2>
          <p className="mt-2 text-muted-foreground">El equipo de {created.customerName} quedó registrado como recibido. Entrega el ticket al cliente.</p>
          {advanceCents > 0 && (
            <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">Anticipo registrado: {money(advanceCents)} ({advanceMethodLabel}).</p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <a href={`/admin/tickets/reparacion/${created.id}`} target="_blank" rel="noreferrer"><Printer className="mr-2 h-4 w-4" />Imprimir ticket cliente</a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/admin/tickets/taller/${created.id}`} target="_blank" rel="noreferrer"><Wrench className="mr-2 h-4 w-4" />Imprimir hoja de taller</a>
            </Button>
            {createdWhatsApp && (
              <Button variant="outline" asChild>
                <a href={createdWhatsApp} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp al cliente</a>
              </Button>
            )}
            <Button variant="outline" asChild><Link href={`/admin/taller?orden=${created.id}`}>Abrir orden</Link></Button>
            <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Registrar otro equipo</Button>
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
                  <label ref={nameBoxRef} className="relative block space-y-2 text-sm">Nombre del cliente *
                    <Input value={form.customerName} onChange={event => { update({ customerName: event.target.value }); trackLookup("customerName", event.target.value) }} onBlur={event => { const titled = titleCaseName(event.target.value); if (titled !== event.target.value) update({ customerName: titled }) }} maxLength={100} autoComplete="off" placeholder="Nombre y apellido" />
                    {lookupField === "customerName" && <CustomerSuggestions hits={suggestions} onPick={pickCustomer} />}
                  </label>
                  <PhoneInput containerRef={phoneBoxRef} label="Teléfono de contacto" required value={form.customerPhone} dialCode={form.customerPhoneDial} onDialCode={setPhoneDial("customerPhone")} onChange={phone => { update({ customerPhone: phone }); trackLookup("customerPhone", phone) }}>
                    {lookupField === "customerPhone" && <CustomerSuggestions hits={suggestions} onPick={pickCustomer} />}
                  </PhoneInput>
                  {form.phoneAltVisible || form.customerPhoneAlt ? (
                    <div className="space-y-1.5">
                      <PhoneInput label="Otro contacto (opcional)" value={form.customerPhoneAlt} dialCode={form.customerPhoneAltDial} onDialCode={setPhoneDial("customerPhoneAlt")} onChange={phone => update({ customerPhoneAlt: phone })} />
                      <button type="button" onClick={() => update({ phoneAltVisible: false, customerPhoneAlt: "" })} className="text-xs text-muted-foreground transition hover:text-destructive">Quitar contacto alterno</button>
                    </div>
                  ) : (
                    <div className="self-end sm:col-span-2">
                      <button type="button" onClick={() => update({ phoneAltVisible: true })} className="text-xs font-medium text-primary transition hover:underline">Agregar otro contacto</button>
                    </div>
                  )}
                  {(searching || matchedCustomer || showNewCustomerNote || lookupFailed) && (
                    <div className="sm:col-span-2" aria-live="polite">
                      {searching && <p className="text-xs text-muted-foreground">Buscando clientes…</p>}
                      {!searching && matchedCustomer && <p className="text-xs font-medium text-primary">Cliente existente — datos autocompletados.</p>}
                      {!searching && lookupFailed && <p className="text-xs text-muted-foreground">No se pudo buscar clientes. Puedes continuar; la orden se vinculará por teléfono.</p>}
                      {!searching && !lookupFailed && showNewCustomerNote && <p className="text-xs text-muted-foreground">Cliente nuevo — se vinculará por teléfono.</p>}
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
                      {equipmentTypes.map(value => {
                        const Icon = EQUIPMENT_ICONS[value] ?? Package
                        return (
                          <button key={value} type="button" aria-pressed={form.equipmentType === value} onClick={() => {
                            if (value === form.equipmentType) return
                            const next = deviceProfileFor(value)
                            // Otro equipo = otro bloqueo: el patrón/PIN capturado no se hereda.
                            const resetAccess = { pattern: [] as number[], accessValue: "" }
                            update(next.accessTypes.includes(form.accessType) ? { equipmentType: value, ...resetAccess } : { equipmentType: value, accessType: "NONE", ...resetAccess })
                          }} className={chipClass(form.equipmentType === value)}>
                            <Icon size={15} />{value}
                          </button>
                        )
                      })}
                    </div>
                    {form.equipmentType === "Otro" && (
                      <Input value={form.equipmentTypeOther} onChange={event => update({ equipmentTypeOther: event.target.value })} maxLength={100} placeholder="¿Qué equipo es? Ej. smartwatch, bocina, drone…" autoFocus className="mt-2 max-w-sm" />
                    )}
                    {form.equipmentType && profile.extraHints.map(hint => (
                      <p key={hint} className="text-xs text-muted-foreground">{hint}</p>
                    ))}
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm">Servicios del catálogo</p>
                      {form.services.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {form.services.map(service => (
                            <p key={service.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                              <Wrench size={14} aria-hidden />
                              <span className="truncate">{service.name}</span>
                              <span className="text-xs font-normal text-primary/80">{typeof service.priceCents === "number" ? money(service.priceCents) : "Precio según dispositivo"}</span>
                              <button type="button" aria-label={`Quitar ${service.name}`} onClick={() => removeService(service.id)} className="rounded-full p-0.5 transition hover:bg-primary/15">
                                <X size={13} />
                              </button>
                            </p>
                          ))}
                          {form.services.length > 1 && form.servicePriceCents !== null && (
                            <span className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground">Total: {money(form.servicePriceCents)}</span>
                          )}
                        </div>
                      )}
                      {form.services.length < MAX_SERVICES ? (
                        <div className="relative" ref={serviceBoxRef}>
                          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input value={serviceQuery} onChange={event => setServiceQuery(event.target.value)} maxLength={80} autoComplete="off" placeholder={form.services.length ? "Agregar otro servicio…" : "Buscar: cambio de pantalla, batería…"} className="pl-9" />
                          {visibleServiceResults.length > 0 && (
                            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover shadow-md">
                              {visibleServiceResults.map(service => (
                                <li key={service.id}>
                                  <button type="button" onClick={() => pickService(service)} className="w-full px-3 py-2 text-left text-sm transition hover:bg-accent">
                                    <span className="flex items-center justify-between gap-3">
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-medium">{service.name}</span>
                                        {serviceMatchesEquipment(service) && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">para {equipmentLabel}</span>}
                                      </span>
                                      <span className="shrink-0 text-xs text-muted-foreground">{typeof service.priceCents === "number" ? money(service.priceCents) : "Precio según dispositivo"}</span>
                                    </span>
                                    {service.description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{service.description}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Máximo {MAX_SERVICES} servicios del catálogo por orden.</p>
                      )}
                      {serviceSearching && <p className="text-xs text-muted-foreground">Buscando servicios…</p>}
                      {!serviceSearching && serviceCatalogDown && serviceSearched === serviceQuery.trim() && serviceSearched.length >= 2 && <p className="text-xs text-muted-foreground">Catálogo no disponible; usa el campo Otro servicio.</p>}
                      {!serviceSearching && !serviceCatalogDown && serviceResults.length === 0 && serviceSearched === serviceQuery.trim() && serviceSearched.length >= 2 && <p className="text-xs text-muted-foreground">Sin coincidencias en el catálogo.</p>}
                    </div>
                    <label className="block space-y-2 text-sm">Otro servicio
                      <Input value={form.otherService} onChange={event => update({ otherService: event.target.value })} maxLength={120} placeholder="Servicio que no está en el catálogo" />
                    </label>
                    <label className="block space-y-2 text-sm">Presupuesto estimado (MXN)
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input type="number" inputMode="decimal" min="0" step="0.01" value={form.budgetAmount} onChange={event => update({ budgetAmount: event.target.value })} placeholder="Según diagnóstico" className="pl-7" />
                      </div>
                      <span className="block text-xs text-muted-foreground">Se propone al elegir un servicio con precio fijo; puedes ajustarlo o dejarlo vacío.</span>
                    </label>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label ref={brandBoxRef} className="relative block space-y-2 text-sm">Marca
                      <Input value={form.brand} onChange={event => { update({ brand: event.target.value }); setBrandTerm(event.target.value) }} maxLength={60} autoComplete="off" placeholder="Samsung, Apple, Xiaomi…" />
                      {brandOptions.length > 0 && (
                        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover shadow-md">
                          {brandOptions.map(option => (
                            <li key={option}>
                              <button type="button" onClick={() => pickBrand(option)} className="w-full px-3 py-2 text-left text-sm transition hover:bg-accent">{option}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {brandSearching && <span className="block text-xs text-muted-foreground">Buscando marcas…</span>}
                      {!brandSearching && brandCatalogDown && brandSearched === brandTerm.trim() && brandSearched.length >= 2 && <span className="block text-xs text-muted-foreground">Catálogo no disponible; escribe la marca a mano.</span>}
                      {!brandSearching && !brandCatalogDown && brandOptions.length === 0 && brandSearched === brandTerm.trim() && brandSearched.length >= 2 && <span className="block text-xs text-muted-foreground">Sin coincidencias — escríbela a mano o dala de alta en Taller → Catálogo.</span>}
                    </label>
                    <label ref={modelBoxRef} className="relative block space-y-2 text-sm">Modelo
                      <Input value={form.model} onChange={event => { update({ model: event.target.value }); setModelTerm(event.target.value); setPickedModel(null) }} maxLength={120} autoComplete="off" placeholder="Ej. Galaxy A54, iPhone 13…" />
                      {modelHits.length > 0 && (
                        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border bg-popover shadow-md">
                          {modelHits.map(device => (
                            <li key={device.id}>
                              <button type="button" onClick={() => pickDeviceModel(device)} className="w-full px-3 py-2 text-left text-sm transition hover:bg-accent">
                                <span className="block font-medium">{device.model}{device.code ? ` · ${device.code}` : ""}</span>
                                <span className="block text-xs text-muted-foreground">{device.brand}{device.type ? ` · ${device.type}` : ""}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {modelSearching && <span className="block text-xs text-muted-foreground">Buscando modelos…</span>}
                      {!modelSearching && modelCatalogDown && modelSearched === modelTerm.trim() && modelSearched.length >= 2 && <span className="block text-xs text-muted-foreground">Catálogo no disponible; escribe el modelo a mano.</span>}
                      {!modelSearching && !modelCatalogDown && modelHits.length === 0 && modelSearched === modelTerm.trim() && modelSearched.length >= 2 && <span className="block text-xs text-muted-foreground">Sin coincidencias{form.brand.trim() ? ` en ${form.brand.trim()}` : ""} — escríbelo a mano o dalo de alta en el catálogo.</span>}
                      {pickedModel?.code && pickedModel.model === form.model && <span className="block text-xs text-muted-foreground">Código de referencia: {pickedModel.code}</span>}
                    </label>
                    <label className="block space-y-2 text-sm">{profile.serialLabel}
                      <Input value={form.serialNumber} onChange={event => update({ serialNumber: event.target.value })} maxLength={100} placeholder={profile.serialPlaceholder} />
                    </label>
                    {profile.colorRelevant && (
                      <div className="space-y-2 sm:col-span-2">
                        <p className="text-sm">Color</p>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color del equipo">
                          {EQUIPMENT_COLORS.map(({ label, hex }) => (
                            <button key={label} type="button" role="radio" aria-checked={!form.equipmentColorCustom && form.equipmentColor === label} onClick={() => update({ equipmentColor: label, equipmentColorCustom: false })} className={chipClass(!form.equipmentColorCustom && form.equipmentColor === label)}>
                              <span aria-hidden className="h-3 w-3 rounded-full border border-black/25" style={{ backgroundColor: hex }} />{label}
                            </button>
                          ))}
                          <button type="button" role="radio" aria-checked={form.equipmentColorCustom} onClick={() => update({ equipmentColorCustom: true, equipmentColor: "" })} className={chipClass(form.equipmentColorCustom)}>Otro</button>
                        </div>
                        {form.equipmentColorCustom && (
                          <Input value={form.equipmentColor} onChange={event => update({ equipmentColor: event.target.value })} maxLength={60} autoFocus placeholder="Describe el color: azul marino, verde menta…" className="mt-2 max-w-sm" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <p className="text-sm">Bloqueo del equipo</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de bloqueo">
                      {allowedAccessOptions.map(({ value, label, icon: Icon }) => (
                        <button key={value} type="button" role="radio" aria-checked={form.accessType === value} onClick={() => { if (value !== form.accessType) update({ accessType: value, pattern: [], accessValue: "" }) }} className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition ${form.accessType === value ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}>
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
                      {accessoryChips.map(item => (
                        <button key={item} type="button" aria-pressed={form.accessories.includes(item)} onClick={() => update({ accessories: form.accessories.includes(item) ? form.accessories.filter(accessory => accessory !== item) : [...form.accessories, item] })} className={chipClass(form.accessories.includes(item))}>
                          {item}
                        </button>
                      ))}
                    </div>
                    {form.accessories.includes("Otro") && (
                      <Input value={form.accessoryOther} onChange={event => update({ accessoryOther: event.target.value })} maxLength={120} placeholder="¿Qué otro accesorio? Ej. mochila, base de carga…" className="mt-2 max-w-sm" />
                    )}
                    <div className="border-t border-dashed pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">No incluye / faltante</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {MISSING_ITEMS.map(item => (
                          <button key={item} type="button" aria-pressed={form.accessories.includes(item)} onClick={() => update({ accessories: form.accessories.includes(item) ? form.accessories.filter(accessory => accessory !== item) : [...form.accessories, item] })} className={chipClass(form.accessories.includes(item))}>
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-5">
                    <div className="space-y-2">
                      <p className="text-sm">Condiciones del equipo</p>
                      <div className="flex flex-wrap gap-2">
                        {FUNCTIONAL_CONDITIONS.map(({ value, label, icon: Icon }) => (
                          <button key={value} type="button" aria-pressed={form.functionalConditions.includes(value)} onClick={() => toggleCondition(value)} className={chipClass(form.functionalConditions.includes(value))}>
                            <Icon size={15} />{label}
                          </button>
                        ))}
                      </div>
                      {conditionHints.map(hint => (
                        <p key={hint} className="text-xs text-muted-foreground">{hint}</p>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm">Estética</p>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Estética del equipo">
                        {AESTHETIC_OPTIONS.map(({ value, label }) => (
                          <button key={value} type="button" role="radio" aria-checked={form.aesthetics === value} onClick={() => update({ aesthetics: form.aesthetics === value ? "" : value })} className={chipClass(form.aesthetics === value)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block space-y-2 text-sm">Otras observaciones del estado físico
                      <textarea value={form.intakeCondition} onChange={event => update({ intakeCondition: event.target.value })} maxLength={500} rows={3} className={inputClass} placeholder="Golpes, humedad, piezas faltantes…" />
                    </label>
                    <label className="block space-y-2 text-sm">Falla que reporta el cliente *
                      <textarea value={form.reportedIssue} onChange={event => update({ reportedIssue: event.target.value })} maxLength={500} rows={3} className={inputClass} placeholder="Describe lo que ocurre y desde cuándo." />
                    </label>
                  </div>
                  <div className="rounded-lg border p-4">
                    <SignaturePad label="Firma del cliente al entregar el equipo" onChange={handleSignature} />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block space-y-2 text-sm">Fecha promesa de entrega
                      <Input type="datetime-local" value={form.promisedAt} min={minDateTime} onChange={event => update({ promisedAt: event.target.value })} />
                    </label>
                    <label className="block space-y-2 text-sm">Fecha programada de reparación
                      <Input type="datetime-local" value={form.scheduledAt} min={minDateTime} onChange={event => update({ scheduledAt: event.target.value })} />
                      <span className="block text-xs text-muted-foreground">Cuándo trabajará el técnico en el equipo. Opcional.</span>
                    </label>
                    <label className="block space-y-2 text-sm sm:col-span-2">Locación física del equipo
                      <div className="relative max-w-sm">
                        <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input list="workshop-locations" value={form.location} onChange={event => update({ location: event.target.value })} maxLength={80} placeholder="Ej. Anaquel A, Mesa 2…" className="pl-9" />
                      </div>
                      <datalist id="workshop-locations">{locations.map(location => <option key={location} value={location} />)}</datalist>
                    </label>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="flex items-center gap-2 text-sm font-medium"><CircleDollarSign size={15} className="text-primary" />Anticipo del cliente</p>
                        <p className="text-xs text-muted-foreground">Activa si el cliente deja dinero a cuenta al entregar el equipo.</p>
                      </div>
                      <button type="button" role="switch" aria-checked={form.advanceEnabled} aria-label="El cliente deja anticipo" onClick={() => update({ advanceEnabled: !form.advanceEnabled })} className={`relative h-6 w-11 shrink-0 rounded-full transition ${form.advanceEnabled ? "bg-primary" : "bg-muted"}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${form.advanceEnabled ? "left-[1.375rem]" : "left-0.5"}`} />
                      </button>
                    </div>
                    {form.advanceEnabled && (
                      <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
                        <label className="block space-y-2 text-sm">Monto del anticipo *
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input type="number" inputMode="decimal" min="0" max={MAX_ADVANCE_AMOUNT} step="0.01" value={form.advanceAmount} onChange={event => update({ advanceAmount: event.target.value })} placeholder="0.00" className="pl-7" />
                          </div>
                          <span className="block text-xs text-muted-foreground">Hasta {money(MAX_ADVANCE_AMOUNT * 100)}.</span>
                        </label>
                        <div className="space-y-2">
                          <p className="text-sm">Método de cobro *</p>
                          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Método de cobro del anticipo">
                            {ADVANCE_METHODS.map(({ value, label, icon: Icon }) => (
                              <button key={value} type="button" role="radio" aria-checked={form.advanceMethod === value} onClick={() => update({ advanceMethod: value })} className={chipClass(form.advanceMethod === value)}>
                                <Icon size={15} />{label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {budgetCents > 0 && advanceCents > budgetCents && (
                          <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 sm:col-span-2">
                            El anticipo supera el presupuesto estimado ({budgetLabel}). Confirma el monto con el cliente.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground">Revisa que la información esté completa antes de crear la orden.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SummaryGroup title="Cliente" icon={UserRound} items={[
                      ["Nombre", form.customerName.trim()],
                      ["Teléfono", form.customerPhone.trim()],
                      ...(form.customerPhoneAlt.trim() ? [["Teléfono alterno", form.customerPhoneAlt.trim()] as [string, ReactNode]] : []),
                      ["Sucursal de recepción", branchName],
                      ["Responsable técnico", staffName],
                    ]} />
                    <SummaryGroup title="Equipo" icon={Package} items={[
                      ["Tipo", equipmentLabel],
                      ["Marca", form.brand.trim()],
                      ["Modelo", form.model.trim()],
                      ["Color", form.equipmentColor.trim()],
                      [profile.serialLabel, form.serialNumber.trim()],
                      ["Servicio", serviceSummary],
                    ]} />
                    <SummaryGroup title="Acceso" icon={accessOption?.icon ?? LockOpen} items={[
                      ["Bloqueo del equipo", accessLabel],
                      ...(form.accessType !== "NONE" ? [[accessValueLabel, accessValueSummary] as [string, ReactNode]] : []),
                      ["Accesorios recibidos", receivedAccessoryText],
                      ...(missingAccessoryText ? [["No incluye", missingAccessoryText] as [string, ReactNode]] : []),
                    ]} />
                    <SummaryGroup title="Estado" icon={ShieldCheck} items={[
                      ["Falla reportada", reportedIssueText],
                      ["Condiciones", conditionChips],
                      ["Estética", aestheticsLabel],
                      ["Otras observaciones", form.intakeCondition.trim()],
                    ]} />
                    <SummaryGroup title="Entrega y cobro" icon={CalendarClock} items={[
                      ["Fecha promesa", promisedLabel],
                      ["Reparación programada", scheduledLabel],
                      ["Locación", form.location.trim()],
                      ["Presupuesto estimado", budgetLabel],
                      ["Anticipo", advanceLabel],
                      ["Firma capturada", form.signatureData ? <img src={form.signatureData} alt="Firma capturada del cliente" className="h-16 rounded border bg-white object-contain" /> : ""],
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
