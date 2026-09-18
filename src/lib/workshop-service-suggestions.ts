/**
 * Catálogo sugerido de servicios de taller para negocios nuevos.
 *
 * Se siembra en el alta (signup) y se puede cargar después desde
 * POST /api/workshop-services/seed-suggested. El dedup es por nombre
 * (case-insensitive), así que cada nombre debe ser único — por eso los
 * servicios repetidos por tipo de equipo lo llevan en el nombre.
 *
 * priceCents siempre null: "según dispositivo" (se cotiza al recibir).
 * equipmentType usa el vocabulario en español de DEFAULT_EQUIPMENT_TYPES.
 */
export interface SuggestedService {
  name: string
  equipmentType: string | null
}

export const SUGGESTED_SERVICES: SuggestedService[] = [
  { name: "Diagnóstico general", equipmentType: null },
  { name: "Cambio de pantalla de celular", equipmentType: "Celular" },
  { name: "Cambio de batería", equipmentType: "Celular" },
  { name: "Cambio de puerto de carga", equipmentType: "Celular" },
  { name: "Cambio de mica / cristal templado", equipmentType: "Celular" },
  { name: "Limpieza por humedad / desoxidación", equipmentType: "Celular" },
  { name: "Reinstalación de software", equipmentType: "Celular" },
  { name: "Respaldo y rescate de datos", equipmentType: null },
  { name: "Cambio de cámara, bocina o micrófono", equipmentType: "Celular" },
  { name: "Liberación de equipo", equipmentType: "Celular" },
  { name: "Cambio de pantalla de tablet", equipmentType: "Tablet" },
  { name: "Cambio de pantalla de laptop", equipmentType: "Laptop" },
  { name: "Cambio de teclado de laptop", equipmentType: "Laptop" },
  { name: "Mantenimiento de computadora: limpieza y pasta térmica", equipmentType: "Computadora" },
  { name: "Mantenimiento de consola: limpieza y pasta térmica", equipmentType: "Consola" },
  { name: "Limpieza de cabezales", equipmentType: "Impresora" },
  { name: "Configuración inicial y transferencia de datos", equipmentType: null },
]
