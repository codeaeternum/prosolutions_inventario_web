// Perfiles por tipo de equipo para el asistente de recepción del taller:
// adaptan la etiqueta de serie/IMEI, los accesorios sugeridos, los métodos de
// bloqueo aplicables, las pistas de revisión y si el color es un dato útil.

export type DeviceAccessType = "NONE" | "PATTERN" | "PIN" | "PASSWORD"

export interface DeviceProfile {
  /** Etiqueta del campo de identificación del equipo. */
  serialLabel: string
  serialPlaceholder: string
  /** Chips de accesorios sugeridos; el asistente siempre agrega "Otro". */
  accessorySuggestions: string[]
  /** Tipos de bloqueo que aplican al tipo de equipo. */
  accessTypes: DeviceAccessType[]
  /** Pistas de recepción mostradas como texto secundario. */
  extraHints: string[]
  /** Si el color del equipo es un dato relevante para el tipo. */
  colorRelevant: boolean
}

const IMEI = { serialLabel: "IMEI", serialPlaceholder: "IMEI de 15 dígitos" } as const
const SERIAL = { serialLabel: "Número de serie", serialPlaceholder: "Serie del fabricante" } as const

const ALL_ACCESS: DeviceAccessType[] = ["NONE", "PATTERN", "PIN", "PASSWORD"]
const PIN_AND_PASSWORD: DeviceAccessType[] = ["NONE", "PIN", "PASSWORD"]
const PASSWORD_ONLY: DeviceAccessType[] = ["NONE", "PASSWORD"]

export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  Celular: {
    ...IMEI,
    accessorySuggestions: ["Cargador", "Funda", "SIM", "MicroSD", "Caja"],
    accessTypes: ALL_ACCESS,
    extraHints: ["Verifica que encienda y anota el porcentaje de batería.", "El IMEI aparece al marcar *#06# o en la bandeja del SIM."],
    colorRelevant: true,
  },
  Tablet: {
    ...IMEI,
    accessorySuggestions: ["Cargador", "Funda", "SIM", "Caja"],
    accessTypes: ALL_ACCESS,
    extraHints: ["Verifica que encienda y que el táctil responda en toda la pantalla."],
    colorRelevant: true,
  },
  Laptop: {
    ...SERIAL,
    accessorySuggestions: ["Cargador", "Mochila", "Mouse"],
    accessTypes: PIN_AND_PASSWORD,
    extraHints: ["Verifica que encienda antes de recibirlo."],
    colorRelevant: true,
  },
  Computadora: {
    ...SERIAL,
    accessorySuggestions: ["Teclado", "Mouse", "Monitor", "Cables"],
    accessTypes: PIN_AND_PASSWORD,
    extraHints: ["Anota qué periféricos deja el cliente junto con el equipo."],
    colorRelevant: true,
  },
  Consola: {
    ...SERIAL,
    accessorySuggestions: ["Control", "Cable HDMI", "Cable de poder", "Juegos"],
    accessTypes: PASSWORD_ONLY,
    extraHints: ["Prueba que encienda y, si aplica, que lea discos."],
    colorRelevant: true,
  },
  Smartwatch: {
    ...IMEI,
    accessorySuggestions: ["Base de carga", "Correa extra", "Caja"],
    accessTypes: ALL_ACCESS,
    extraHints: ["Verifica que cargue y que la pantalla responda."],
    colorRelevant: true,
  },
  Pantalla: {
    ...SERIAL,
    accessorySuggestions: ["Cable de poder", "Cable HDMI", "Control remoto"],
    accessTypes: PASSWORD_ONLY,
    extraHints: ["Enciende la pantalla para revisar líneas o pixeles dañados."],
    colorRelevant: true,
  },
  Impresora: {
    ...SERIAL,
    accessorySuggestions: ["Cable de poder", "Cable USB", "Cartuchos o tinta"],
    accessTypes: PASSWORD_ONLY,
    extraHints: ["Si es posible, imprime una página de prueba antes de recibirla."],
    colorRelevant: false,
  },
  // Perfil genérico: también cubre tipos personalizados del catálogo de configuración.
  Otro: {
    serialLabel: "Serie o IMEI",
    serialPlaceholder: "Número de serie o IMEI",
    accessorySuggestions: ["Cargador", "Cable", "Funda", "Mica", "Caja", "Control remoto"],
    accessTypes: ALL_ACCESS,
    extraHints: [],
    colorRelevant: true,
  },
}

export const DEFAULT_DEVICE_PROFILE: DeviceProfile = DEVICE_PROFILES.Otro

/** Devuelve el perfil del tipo de equipo; los tipos desconocidos usan el genérico. */
export function deviceProfileFor(equipmentType: string): DeviceProfile {
  return DEVICE_PROFILES[equipmentType] ?? DEFAULT_DEVICE_PROFILE
}

/** Pistas ligadas a la condición física reportada (se muestran al elegir el chip). */
export const CONDITION_HINTS: Record<string, string> = {
  MOJADO: "No lo enciendas ni lo conectes al cargador: la humedad puede dañar más componentes.",
  APAGADO: "Pregunta si el equipo encendía con normalidad antes de la falla.",
}
