"use client"

import { useEffect, type ReactNode, type Ref } from "react"
import { Input } from "@/components/ui/input"

// Mismo estilo de inputClass del asistente, con ancho fijo compacto para la lada.
const dialSelectClass = "w-28 shrink-0 rounded-lg border bg-background px-3 py-2 text-sm"

type DialCode = { code: string; flag: string; name: string }

export const DIAL_CODES: DialCode[] = [
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

// De mayor a menor longitud para que "+1809" gane sobre "+1" al detectar el código.
const DIAL_CODES_BY_LENGTH = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length)

/** Separa un teléfono en código de país conocido y número local (solo dígitos). */
export function parsePhone(value: string): { dial: string | null; local: string } {
  const trimmed = value.trim()
  for (const { code } of DIAL_CODES_BY_LENGTH) {
    if (trimmed.startsWith(code)) return { dial: code, local: trimmed.slice(code.length).replace(/\D/g, "") }
  }
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

  // Si el valor ya trae un código de país (p. ej. al autocompletar un cliente),
  // se adopta como código activo. Diferido con timer para no setear en efecto.
  const parsedDial = parsed.dial
  useEffect(() => {
    if (!parsedDial || parsedDial === dialCode) return
    const timer = setTimeout(() => onDialCode(parsedDial), 0)
    return () => clearTimeout(timer)
  }, [parsedDial, dialCode, onDialCode])

  const options = DIAL_CODES.some(option => option.code === dialCode)
    ? DIAL_CODES
    : [{ code: dialCode, flag: "🏳️", name: dialCode }, ...DIAL_CODES]

  return (
    <div ref={containerRef} className="relative space-y-2 text-sm">
      {label ? <p>{label}{required ? " *" : ""}</p> : null}
      <div className="flex items-center gap-2">
        <select aria-label="Código de país" className={dialSelectClass} value={dialCode} onChange={event => onDialCode(event.target.value)}>
          {options.map(({ code, flag, name }) => (
            <option key={code} value={code} title={name}>{flag} {code}</option>
          ))}
        </select>
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
