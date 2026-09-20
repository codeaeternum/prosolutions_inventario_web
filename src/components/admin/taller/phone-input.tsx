"use client"

import { useEffect, useState, type ReactNode, type Ref } from "react"
import { Input } from "@/components/ui/input"

// Mismo estilo de inputClass del asistente, con ancho fijo compacto para la lada.
const dialSelectClass = "w-28 shrink-0 rounded-lg border bg-background px-3 py-2 text-sm"

type DialCode = { code: string; flag: string; name: string }

// Lista histórica completa: parsePhone la usa para reconocer ladas de teléfonos
// ya guardados en la base, aunque ya no se ofrezcan todas en el picker.
export const KNOWN_DIAL_CODES: DialCode[] = [
  { code: "+52", flag: "🇲🇽", name: "México" },
  { code: "+1", flag: "🇺🇸", name: "EE.UU. / Canadá" },
  { code: "+502", flag: "🇬🇹", name: "Guatemala" },
  { code: "+503", flag: "🇸🇻", name: "El Salvador" },
  { code: "+504", flag: "🇭🇳", name: "Honduras" },
  { code: "+505", flag: "🇳🇮", name: "Nicaragua" },
  { code: "+506", flag: "🇨🇷", name: "Costa Rica" },
  { code: "+507", flag: "🇵🇦", name: "Panamá" },
  { code: "+53", flag: "🇨🇺", name: "Cuba" },
  { code: "+1809", flag: "🇩🇴", name: "Rep. Dominicana" },
  { code: "+57", flag: "🇨🇴", name: "Colombia" },
  { code: "+58", flag: "🇻🇪", name: "Venezuela" },
  { code: "+593", flag: "🇪🇨", name: "Ecuador" },
  { code: "+51", flag: "🇵🇪", name: "Perú" },
  { code: "+591", flag: "🇧🇴", name: "Bolivia" },
  { code: "+56", flag: "🇨🇱", name: "Chile" },
  { code: "+54", flag: "🇦🇷", name: "Argentina" },
  { code: "+595", flag: "🇵🇾", name: "Paraguay" },
  { code: "+598", flag: "🇺🇾", name: "Uruguay" },
  { code: "+55", flag: "🇧🇷", name: "Brasil" },
  { code: "+34", flag: "🇪🇸", name: "España" },
]

// Opciones visibles del picker: solo las ladas más usadas del negocio.
// EE.UU. y Canadá comparten "+1": el `value` distingue la bandera
// ("+1:US" / "+1:CA") pero ambas emiten onDialCode("+1"). La opción
// "🌐 Otro" (OTHER_DIAL_VALUE) abre un input libre para teclear el código.
export const DIAL_CODE_OPTIONS: { value: string; dial: string; flag: string; name: string }[] = [
  { value: "+52", dial: "+52", flag: "🇲🇽", name: "México" },
  { value: "+1:US", dial: "+1", flag: "🇺🇸", name: "EE.UU." },
  { value: "+1:CA", dial: "+1", flag: "🇨🇦", name: "Canadá" },
]

// Value del <select> para la opción libre; el código real viaja en dialCode.
export const OTHER_DIAL_VALUE = "__other__"

// Ladas que el picker puede mostrar directamente; cualquier otra cae en "Otro".
const PICKER_DIALS = new Set(DIAL_CODE_OPTIONS.map(option => option.dial))

// De mayor a menor longitud para que "+1809" gane sobre "+1" al detectar el código.
const KNOWN_DIAL_CODES_BY_LENGTH = [...KNOWN_DIAL_CODES].sort((a, b) => b.code.length - a.code.length)

/** Separa un teléfono en código de país conocido y número local (solo dígitos). */
export function parsePhone(value: string): { dial: string | null; local: string } {
  const trimmed = value.trim()
  for (const { code } of KNOWN_DIAL_CODES_BY_LENGTH) {
    if (trimmed.startsWith(code)) return { dial: code, local: trimmed.slice(code.length).replace(/\D/g, "") }
  }
  // Lada fuera del catálogo (opción "Otro"): conserva el prefijo "+XX" como lada
  // en lugar de mezclar sus dígitos con el número local. Solo aplica cuando hay
  // un separador (o el código está solo); "+446671…" pegado se trata como local.
  const custom = trimmed.match(/^\+(\d{1,4})(?=\D|$)/)
  if (custom) return { dial: `+${custom[1]}`, local: trimmed.slice(custom[0].length).replace(/\D/g, "") }
  return { dial: null, local: trimmed.replace(/\D/g, "") }
}

type PhoneInputProps = {
  /** Valor completo que se envía al servidor, ej. "+52 6671234567". */
  value: string
  /** Recibe el valor combinado `${dialCode} ${número}` (o "" si queda vacío). */
  onChange: (value: string) => void
  dialCode: string
  onDialCode: (dial: string) => void
  label?: string
  required?: boolean
  /** Ref del contenedor: permite detectar clics fuera del campo y sus sugerencias. */
  containerRef?: Ref<HTMLDivElement>
  children?: ReactNode
}

export function PhoneInput({ value, onChange, dialCode, onDialCode, label, required, containerRef, children }: PhoneInputProps) {
  const parsed = parsePhone(value)

  // "+1" es compartido por EE.UU. y Canadá: el teléfono guarda solo "+1", así
  // que la bandera elegida se recuerda localmente (EE.UU. por defecto).
  const [nanpOption, setNanpOption] = useState<"US" | "CA">("US")

  // Si el valor ya trae un código de país (p. ej. al autocompletar un cliente),
  // se adopta como código activo. Diferido con timer para no setear en efecto.
  const parsedDial = parsed.dial
  useEffect(() => {
    if (!parsedDial || parsedDial === dialCode) return
    const timer = setTimeout(() => onDialCode(parsedDial), 0)
    return () => clearTimeout(timer)
  }, [parsedDial, dialCode, onDialCode])

  // Una lada fuera del picker (guardada en BD o tecleada en "Otro") se muestra
  // con la opción genérica "Otro" y el input libre para ver/editar el código.
  const isCustomDial = !PICKER_DIALS.has(dialCode)
  const selectValue = isCustomDial ? OTHER_DIAL_VALUE : dialCode === "+1" ? `+1:${nanpOption}` : dialCode

  return (
    <div ref={containerRef} className="relative space-y-2 text-sm">
      {label ? <p>{label}{required ? " *" : ""}</p> : null}
      <div className="flex items-center gap-2">
        <select
          aria-label="Código de país"
          className={dialSelectClass}
          value={selectValue}
          onChange={event => {
            const picked = event.target.value
            if (picked === OTHER_DIAL_VALUE) {
              // Entra al modo libre dejando "+" como base para teclear el código.
              if (!isCustomDial) onDialCode("+")
              return
            }
            const option = DIAL_CODE_OPTIONS.find(item => item.value === picked)
            if (!option) return
            if (option.value === "+1:US" || option.value === "+1:CA") setNanpOption(option.value === "+1:CA" ? "CA" : "US")
            onDialCode(option.dial)
          }}
        >
          {DIAL_CODE_OPTIONS.map(option => (
            <option key={option.value} value={option.value} title={option.name}>{option.flag} {option.dial}</option>
          ))}
          <option value={OTHER_DIAL_VALUE}>🌐 {isCustomDial && dialCode.length > 1 ? `Otro (${dialCode})` : "Otro"}</option>
        </select>
        {isCustomDial && (
          <Input
            aria-label="Código de país (otro)"
            inputMode="tel"
            autoComplete="off"
            maxLength={6}
            placeholder="+XX"
            className="w-[4.5rem] shrink-0"
            value={dialCode}
            onChange={event => {
              const digits = event.target.value.replace(/\D/g, "")
              onDialCode(digits ? `+${digits}` : "+")
            }}
          />
        )}
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          required={required}
          minLength={7}
          maxLength={15}
          placeholder="667 123 4567"
          className="flex-1"
          value={parsed.local}
          onChange={event => {
            const digits = event.target.value.replace(/\D/g, "")
            onChange(digits ? `${dialCode} ${digits}` : "")
          }}
        />
      </div>
      {children}
    </div>
  )
}
