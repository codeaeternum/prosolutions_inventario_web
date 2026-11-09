import { AsistenciaKiosco } from "@/components/admin/asistencia-kiosco"

export const dynamic = "force-dynamic"

/**
 * /admin/asistencia-kiosco — checador de mostrador para tableta compartida.
 * El layout ya exige staff (ADMIN/EMPLOYEE); aquí cada persona marca su
 * entrada/salida con PIN rápido sin tocar la sesión del operador.
 */
export default function AsistenciaKioscoPage() {
  return (
    <div className="pb-20 lg:pb-0">
      <AsistenciaKiosco />
    </div>
  )
}
