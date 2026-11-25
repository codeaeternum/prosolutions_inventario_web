import { Handshake, Package, Wrench, type LucideIcon } from "lucide-react"

export const sectionNavLinks = [
  { href: "#producto", label: "Producto" },
  { href: "#comparativa", label: "Comparativa" },
  { href: "#vitrina", label: "Vitrina" },
  { href: "#precio", label: "Precio" },
  { href: "#faq", label: "FAQ" },
]

export const comparison = [
  { before: "El patrón del equipo se quedó en un papel… que nadie encuentra.", after: "Patrón o PIN capturado al recibir el equipo y guardado cifrado." },
  { before: "Llamadas y mensajes de “¿ya quedó?” a cada rato.", after: "Tu cliente consulta su folio por enlace, sin interrumpir el trabajo." },
  { before: "Las existencias están en Excel o en la memoria de alguien.", after: "Inventario por sucursal con movimientos auditados." },
  { before: "Anticipos en el cuaderno y cobros que no aparecen.", after: "Cada peso registrado en caja, con su folio." },
  { before: "“El cliente dijo que sí”, pero no quedó por escrito.", after: "Autorización de la cotización por enlace, registrada con firma." },
]

export const featurePillars = [
  { title: "Recepción y órdenes", lead: "Que no se pierda cómo llegó ni qué le hiciste.", items: ["Patrón y PIN cifrados; fotos como evidencia al recibir.", "Tablero de órdenes con 13 estados: arrastra cada equipo al siguiente paso.", "Historial del trabajo y seguimiento de garantías."] },
  { title: "Inventario y ventas", lead: "La pieza correcta, en el local correcto.", items: ["Existencias por sucursal, traspasos y conteos físicos.", "Punto de venta con pagos divididos: efectivo, tarjeta o transferencia.", "Apartados para que cada pieza tenga dueño y seguimiento."] },
  { title: "Dinero bajo control", lead: "Lo que entra y lo que sale, sin adivinar.", items: ["Anticipos y cobros ligados a su folio.", "Crédito con estado de cuenta compartido por enlace.", "Gastos autorizados por el administrador y corte diario de caja."] },
  { title: "Clientes sin fricción", lead: "Menos vueltas al mostrador, más claridad.", items: ["Cotización por enlace con firma y rastreo por QR.", "Aviso por Telegram cuando el equipo queda listo.", "Tus clientes pueden subir fotos de su equipo por enlace."] },
]

export const extras = [
  "Tu equipo recibe equipos y vende desde Telegram; recibe el resumen diario a las 8 p. m. y alertas si un empleado cambia precios.",
  "Proveedores y compras.",
  "Encargos con radar de talleres aliados para buscar piezas.",
  "Importación desde Excel.",
  "Checador de empleados con PIN en una tableta.",
]

export const lifecycle = [
  { title: "Recepción", description: "Equipo, patrón, evidencia y folio." },
  { title: "Diagnóstico", description: "Registra la falla y lo que necesita." },
  { title: "Presupuesto", description: "Cotiza trabajo y refacciones." },
  { title: "Autorización", description: "El cliente firma desde el enlace." },
  { title: "Reparación", description: "Documenta avances y piezas usadas." },
  { title: "Listo", description: "Avisa que ya puede recogerlo." },
  { title: "Entregado", description: "Cobra el saldo y entrega con folio." },
]

export const gettingStarted = [
  { title: "Crea tu negocio", description: "Registra tus datos y completa la verificación de correo o teléfono que te solicite el registro. No necesitas tarjeta." },
  { title: "Carga lo que ya tienes", description: "¿Vienes de Excel? Sube tu archivo tal cual. Revisa las columnas al importar y configura tu sucursal, servicios y precios." },
  { title: "Abre el mostrador", description: "Personaliza tu vitrina, comparte tu enlace y registra tu primera venta o equipo con su folio." },
]

export const faqs = [
  { question: "¿Es gratis de verdad?", answer: "Sí. El uso cuesta $0 durante el piloto y no necesitas tarjeta para crear tu negocio." },
  { question: "¿Qué pasa después del piloto?", answer: "Cuando existan planes comerciales se publicarán aquí antes de cualquier cambio. Por ahora no hay una duración ni límites comerciales anunciados." },
  { question: "¿Hay que instalar algo?", answer: "No. Abres Reficio en el navegador de tu celular, tableta o computadora. También puedes agregarlo a tu pantalla de inicio como una aplicación (PWA). Necesitas conexión a internet para trabajar." },
  { question: "¿Sirve si solo vendo refacciones?", answer: "Sí. Puedes usar inventario, punto de venta, apartados y tu vitrina sin recibir equipos para reparación." },
  { question: "¿Mis clientes necesitan cuenta para rastrear?", answer: "No. Consultan desde el enlace o QR con su folio y los últimos cuatro dígitos del teléfono registrado en la orden." },
  { question: "¿Puedo manejar varias sucursales?", answer: "Sí. Puedes separar las existencias y la caja de cada sucursal, hacer traspasos y revisar sus movimientos." },
  { question: "¿Puedo poner mi logo y mis precios?", answer: "Sí. Personaliza tu vitrina con el logo de tu negocio y publica tus servicios y refacciones con tus propios precios. También puedes usar tu marca en tickets y etiquetas." },
]

// Los 3 tipos de negocio que soporta BusinessKind (REPAIR, PARTNER, PARTS);
// el modo completo (FULL) se menciona como nota al pie de la sección.
export interface LandingAudience {
  icon: LucideIcon
  title: string
  desc: string
  tags: string[]
}

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
