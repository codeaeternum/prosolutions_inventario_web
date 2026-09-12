"use client"

import { useSyncExternalStore } from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import {
  isValidSlug,
  normalizeSlug,
  RESERVED_SLUGS as PUBLIC_RESERVED_SLUGS,
  SLUG_RE as PUBLIC_SLUG_RE,
} from "@/lib/slug-rules"

const normalizeSlugInput = normalizeSlug
const isValidSlugInput = isValidSlug

export { normalizeSlugInput, isValidSlugInput }


/**
 * Mensaje de error para mostrar bajo el campo, o null si está vacío/válido.
 * El slug es opcional en todos los formularios que usan este helper.
 */
export function slugFieldError(raw: string): string | null {
  const slug = normalizeSlugInput(raw)
  if (!slug) return null
  if (slug.length < 3) return "Mínimo 3 caracteres"
  if (!PUBLIC_SLUG_RE.test(slug)) {
    return "Solo minúsculas, números y guiones internos (sin guiones al inicio o al final)"
  }
  if (PUBLIC_RESERVED_SLUGS.has(slug)) return "Ese nombre está reservado por la aplicación"
  return null
}

/** Host visible en el prefijo: el dominio actual, con reficio.app de fallback SSR. */
export function usePublicHost(): string {
  // El host no cambia sin recargar la página: suscripción vacía.
  return useSyncExternalStore(
    () => () => {},
    () => window.location.host,
    () => "reficio.app"
  )
}

/**
 * Campo de slug público con prefijo visual `<host>/` y validación en vivo
 * (borde e ícono verde/rojo). Controlado: el padre conserva `value` (crudo,
 * sin normalizar — el servidor normaliza al persistir).
 */
export function SlugField({
  id,
  label,
  value,
  onChange,
  placeholder = "mi-negocio",
  hint,
  disabled,
  required,
  minLength = 3,
}: {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  disabled?: boolean
  required?: boolean
  minLength?: number
}) {
  const host = usePublicHost()
  const slug = normalizeSlugInput(value)
  const error = slugFieldError(value)
  const valid = slug.length >= minLength && !error

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div
        className={cn(
          "flex items-center rounded-md border bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          error ? "border-destructive" : valid && "border-success"
        )}
      >
        <span className="select-none whitespace-nowrap pl-3 text-sm text-muted-foreground">
          {host}/
        </span>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          maxLength={50}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="border-0 pl-1 lowercase shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {slug.length > 0 && (
          <span className="pr-3">
            {valid ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
          </span>
        )}
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
