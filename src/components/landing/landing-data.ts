import {
  ArrowLeftRight,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileCheck,
  Handshake,
  KeyRound,
  Link2,
  Lock,
  Package,
  PackageSearch,
  Printer,
  QrCode,
  Receipt,
  Rocket,
  Search,
  Send,
  Settings2,
  Store,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react"

export interface LandingPain {
  icon: LucideIcon
  title: string
  desc: string
}

export interface LandingFeature {
  icon: LucideIcon
  title: string
  desc: string
  tags?: string[]
  wide: boolean
}

export interface LandingStep {
  icon: LucideIcon
  title: string
  desc: string
}

export interface LandingAudience {
  icon: LucideIcon
  title: string
  desc: string
  tags: string[]
}

export interface LandingNavLink {
  href: string
  label: string
}

export const pipeline: string[] = [
  "Recepción",
  "Diagnóstico",
  "Presupuesto",
  "Autorización",
  "Reparación",
  "Listo",
  "Entregado",
]

export const pains: LandingPain[] = [
  {
    icon: KeyRound,
    title: "“¿Y el patrón del equipo?”",
    desc: "Olvidar el PIN o el patrón cuesta piezas, tiempo y discusiones. Reficio lo captura al recibir — oculto hasta que el técnico lo necesita.",
  },
  {
    icon: PackageSearch,
    title: "Stock que “desaparece”",
    desc: "Si no sabes cuántas pantallas te quedan ni en qué sucursal están, no sabes cuánto estás perdiendo. Inventario por local, siempre exacto.",
  },
  {
    icon: Wallet,
    title: "Cobros que no entran a caja",
    desc: "Anticipos en un cuaderno, saldos en la memoria, fiados sin folio. Aquí cada peso queda registrado en caja y ligado a su orden.",
  },
]

// Bento de módulos: los "wide" caen en las posiciones 1, 6 y 11 para que el
// grid de 3 columnas quede en filas completas (2+1 | 1+1+1 | 2+1 | 1+1+1 | 2+1).
export const features: LandingFeature[] = [
  {
    icon: Lock,
    title: "Recepción blindada",
    desc: "Captura patrón, PIN, accesorios y evidencia fotográfica del estado físico al ingresar el equipo. Nadie discute cómo llegó ni cómo se desbloquea.",
    tags: ["Patrón y PIN", "Evidencia", "Accesorios"],
    wide: true,
  },
  {
    icon: ClipboardList,
    title: "Pipeline de órdenes (OT)",
    desc: "Cada reparación avanza por un pipeline visual de recepción a entrega, con técnico asignado e historial completo.",
    wide: false,
  },
  {
    icon: ArrowLeftRight,
    title: "Inventario por sucursal",
    desc: "Stock separado por local, traspasos auditados entre sucursales y alertas de mínimos para que nunca falte la refacción.",
    wide: false,
  },
  {
    icon: Store,
    title: "Punto de venta y caja",
    desc: "Ventas con folio, pagos divididos (efectivo, tarjeta, transferencia, crédito), una caja por local y corte diario sin mezclar efectivo.",
    wide: false,
  },
  {
    icon: CreditCard,
    title: "Crédito y fiado con folios",
    desc: "Límite por cliente, saldo vivo y abonos auditados. Vender a crédito deja de ser un volado.",
    wide: false,
  },
  {
    icon: Link2,
    title: "Cotizaciones que se autorizan solas",
    desc: "Envía el presupuesto por link y el cliente autoriza o rechaza desde su celular. Sin llamadas, sin malentendidos.",
    wide: true,
  },
  {
    icon: QrCode,
    title: "Rastreo público por folio",
    desc: "QR de mostrador y rastreo en línea: tu cliente consulta el estado de su equipo cuando quiera — cero mensajes de “¿ya quedó?”.",
    wide: false,
  },
  {
    icon: CalendarCheck,
    title: "Reservas con depósito y QR",
    desc: "Tus clientes apartan refacciones desde tu vitrina: reserva temporal o con anticipo, con QR para recoger en mostrador.",
    wide: false,
  },
  {
    icon: Users,
    title: "Mercado entre talleres",
    desc: "Tus talleres aliados compran refacciones de tu stock con precio de taller. Tú decides qué productos ven.",
    wide: false,
  },
  {
    icon: BarChart3,
    title: "Reportes del negocio",
    desc: "Ventas, piezas más movidas y desempeño por sucursal en gráficas claras, exportables para tus números de fin de mes.",
    wide: false,
  },
  {
    icon: Send,
    title: "Avisos por Telegram",
    desc: "El bot avisa a tu equipo sin abrir el panel: nueva orden, cotización autorizada, reserva por recoger. Todo el taller se entera al momento.",
    wide: true,
  },
  {
    icon: Printer,
    title: "Tickets y etiquetas con tu marca",
    desc: "Tickets de venta, etiquetas de equipos y comprobantes imprimibles con tu logo — tu nombre en cada papel que sale del mostrador.",
    wide: false,
  },
]

export const workflow: LandingStep[] = [
  {
    icon: Search,
    title: "Diagnostica",
    desc: "Registra la falla, adjunta evidencia y presupuesta con precio real.",
  },
  {
    icon: FileCheck,
    title: "El cliente autoriza",
    desc: "Recibe la cotización por link y aprueba el trabajo desde su celular.",
  },
  {
    icon: ArrowLeftRight,
    title: "Descuenta del stock",
    desc: "Las refacciones usadas salen del inventario del local correcto.",
  },
  {
    icon: Receipt,
    title: "Cobra y documenta",
    desc: "Ticket imprimible, caja por sucursal y cierre con folio auditable.",
  },
]

export const vitrinaPoints: string[] = [
  "Vitrina pública con tu logo, catálogo de servicios y refacciones",
  "Rastreo de reparaciones por folio para tus clientes",
  "QR de mostrador para que cualquiera llegue a tu vitrina",
  "Mercado B2B: tus talleres aliados compran a tu stock",
]

// Los 3 tipos de negocio que soporta BusinessKind (REPAIR, PARTNER, PARTS);
// el modo completo (FULL) se menciona como nota al pie de la sección.
export const audiences: LandingAudience[] = [
  {
    icon: Wrench,
    title: "Taller de reparación",
    desc: "Recibe equipos con patrón y evidencia, cotiza por link, descuenta refacciones del stock y cobra en caja. El flujo completo de la orden de servicio.",
    tags: ["Órdenes y pipeline", "Refacciones", "Caja y crédito"],
  },
  {
    icon: Handshake,
    title: "Captador / punto de recepción",
    desc: "Recibes equipos en tu mostrador y los mandas a tu taller asociado — el modelo de las cadenas. Cada pieza con folio y estatus visible para tu cliente.",
    tags: ["Recepción propia", "Taller asociado", "Rastreo por folio"],
  },
  {
    icon: Package,
    title: "Tienda de refacciones",
    desc: "Sin mesa de reparación: vende por mostrador con punto de venta, aparta piezas con reservas y surte a talleres aliados en el mercado B2B.",
    tags: ["Punto de venta", "Reservas", "Mercado B2B"],
  },
]

export const steps: LandingStep[] = [
  {
    icon: UserPlus,
    title: "Crea tu cuenta",
    desc: "Registra el nombre de tu negocio y aparta tu dirección reficio.app/tu-negocio. Sin tarjeta ni instalaciones.",
  },
  {
    icon: Settings2,
    title: "Configura lo básico",
    desc: "Define tu sucursal, tus servicios con precio y tus primeras refacciones. Tu vitrina se publica sola.",
  },
  {
    icon: Rocket,
    title: "Recibe tu primera orden",
    desc: "Imprime el QR de mostrador, comparte tu link y registra el primer equipo con patrón, anticipo y folio.",
  },
]

export const navLinks: LandingNavLink[] = [
  { href: "#funciones", label: "Funciones" },
  { href: "#para-quien", label: "Para quién" },
  { href: "#flujo", label: "Cómo funciona" },
  { href: "#vitrina", label: "Tu vitrina" },
  { href: "#precio", label: "Precio" },
]
