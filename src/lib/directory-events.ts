import { prisma } from "@/lib/prisma"

/**
 * Telemetría del directorio público (/mercado + /api/directory).
 *
 * DirectoryEvent es GLOBAL (sin tenant): registra qué busca la gente, a qué
 * vitrinas entra y cuántas solicitudes se generan — la materia prima del
 * panel de inteligencia de mercado en /platform.
 *
 * Regla de oro: la telemetría NUNCA rompe la request que la origina. Un
 * fallo aquí se loguea y se traga — perder un evento es mejor que perder
 * una búsqueda o un click del usuario.
 *
 * Solo server-side: el helper de cliente vive en directory-track.ts, que no
 * puede importar nada de este archivo (prisma incluido).
 */

export type DirectoryEventKind = "search" | "click" | "request"

export interface DirectoryEventData {
  /** Negocio destino del click/solicitud; null en búsquedas. */
  businessId?: string | null
  /** Término buscado o categoría filtrada (search); se sanea y trunca. */
  query?: string | null
}

/**
 * Graba un evento del directorio. Nunca lanza: cualquier error de base se
 * reporta por consola y la promesa resuelve igual (seguro para fire-and-
 * forget con `void recordDirectoryEvent(...)`).
 */
export async function recordDirectoryEvent(
  kind: DirectoryEventKind,
  data: DirectoryEventData = {},
): Promise<void> {
  try {
    const query = data.query?.trim().slice(0, 80) || null
    await prisma.directoryEvent.create({
      data: {
        kind,
        businessId: data.businessId ?? null,
        query,
      },
    })
  } catch (error) {
    console.error(`[directory] No se pudo registrar evento "${kind}":`, error)
  }
}
