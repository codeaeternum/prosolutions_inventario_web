"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowRight, Check, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  positionTooltip,
  TOUR_STORAGE_KEY,
  SPOTLIGHT_PADDING,
  type TourResult,
  type TooltipPosition,
} from "@/lib/guided-tour"

/**
 * Spotlight tour del primer login del staff (ADMIN/EMPLOYEE en /admin).
 *
 * Overlay semi-transparente con un "hueco" sobre el elemento real de la UI
 * (el hueco es un div con box-shadow gigante: 0 0 0 9999px) y un tooltip
 * anclado calculado por `positionTooltip` de @/lib/guided-tour. Si el paso
 * no tiene objetivo — o el elemento no existe/está oculto (p. ej. el
 * selector de sucursal sin sucursales) — el tooltip cae centrado.
 *
 * Se muestra UNA sola vez por navegador (localStorage `reficio:tour:v1` =
 * "done" | "skipped"); completarlo, omitirlo, «No volver a mostrar» y
 * Escape son todos caminos terminales. AdminShell no lo monta durante
 * impersonaciones ("Actuando como…").
 *
 * Mientras está abierto, su role="dialog" hace que anyDialogOpen() de la
 * paleta ⌘K apague los atajos globales: las teclas le pertenecen al tour.
 *
 * Es un diálogo MODAL de verdad (el overlay bloquea toda la página y el
 * foco no puede salir del tooltip), así que vive sobre Radix Dialog:
 * focus trap, Escape → "skipped", aria-hidden del resto del documento y
 * restauración del foco al cerrar salen gratis de la primitiva.
 */

// Retraso para no competir con la carga inicial del dashboard.
const TOUR_DELAY_MS = 600

// Selectores de los elementos reales de la UI (aria-labels/títulos ya
// existentes en header/sidebar; no hizo falta tocar esos componentes).
const SELECTOR_SEARCH = 'button[aria-label^="Abrir buscador"]'
const SELECTOR_BRANCH = 'button[title="Sucursal activa"]'
const SELECTOR_SELL = 'a[href="/admin/ventas"]'

interface TourStep {
  id: string
  // Selector CSS del elemento a resaltar; sin objetivo → tooltip centrado.
  selector?: string
  title: string
  body: ReactNode
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

// hasTaller = el negocio muestra el módulo Taller (mismo gate del sidebar:
// todo excepto businessKind "PARTS"). Solo cambia los ejemplos de atajos.
function buildSteps(hasTaller: boolean): TourStep[] {
  return [
    {
      id: "search",
      selector: SELECTOR_SEARCH,
      title: "Busca todo con ⌘K",
      body: (
        <>
          Órdenes, productos, clientes y ventas desde un solo buscador. Ábrelo
          con <Kbd>⌘K</Kbd> (o <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>) y empieza a
          escribir.
        </>
      ),
    },
    {
      id: "branch",
      selector: SELECTOR_BRANCH,
      title: "Tu sucursal activa",
      body: (
        <>
          El inventario, las ventas y el taller se filtran por esta sucursal.
          Cámbiala aquí cuando trabajes en otra sede.
        </>
      ),
    },
    {
      id: "sell",
      selector: SELECTOR_SELL,
      title: "Vende en un toque",
      body: (
        <>
          El mostrador cobra, aplica descuentos y genera el ticket. También
          puedes escanear el QR de un apartado del cliente.
        </>
      ),
    },
    {
      id: "keyboard",
      title: "Todo por teclado",
      body: hasTaller ? (
        <>
          Pulsa <Kbd>?</Kbd> para ver todos los atajos, o <Kbd>g</Kbd> + letra
          para saltar directo: <Kbd>g</Kbd> <Kbd>v</Kbd> Vender,{" "}
          <Kbd>g</Kbd> <Kbd>t</Kbd> Taller, <Kbd>g</Kbd> <Kbd>i</Kbd>{" "}
          Inventario. <Kbd>n</Kbd> lanza la acción «nueva» de cada página.
        </>
      ) : (
        <>
          Pulsa <Kbd>?</Kbd> para ver todos los atajos, o <Kbd>g</Kbd> + letra
          para saltar directo: <Kbd>g</Kbd> <Kbd>v</Kbd> Vender,{" "}
          <Kbd>g</Kbd> <Kbd>i</Kbd> Inventario, <Kbd>g</Kbd> <Kbd>c</Kbd> Caja.{" "}
          <Kbd>n</Kbd> lanza la acción «nueva» de cada página.
        </>
      ),
    },
  ]
}

// Primer elemento VISIBLE que coincide con el selector: el header y el
// sidebar renderizan variantes desktop/móvil del mismo control y una de
// ellas siempre está en display:none (rect 0×0).
function findTourTarget(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return el
  }
  return null
}

function persistTourResult(result: TourResult) {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, result)
  } catch {
    // Sin storage (modo privado): el tour simplemente no recuerda.
  }
}

export function GuidedTour({ hasTaller = true }: { hasTaller?: boolean }) {
  const steps = useMemo(() => buildSteps(hasTaller), [hasTaller])
  // null = tour cerrado/oculto; número = paso activo.
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [tipPos, setTipPos] = useState<TooltipPosition | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const open = stepIndex !== null
  const step = open ? steps[stepIndex] : null
  const isLast = open && stepIndex === steps.length - 1

  const finish = useCallback((result: TourResult) => {
    persistTourResult(result)
    setStepIndex(null)
    // La restauración del foco la hace Radix (onCloseAutoFocus por defecto
    // vuelve al elemento que tenía el foco antes de abrir el diálogo).
  }, [])

  // Auto-apertura: una sola vez por navegador, tras la carga inicial.
  useEffect(() => {
    let seen: string | null = null
    try {
      seen = localStorage.getItem(TOUR_STORAGE_KEY)
    } catch {
      return
    }
    if (seen) return
    const timer = setTimeout(() => setStepIndex(0), TOUR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  // Rect del objetivo del paso activo; se recalcula con resize y con
  // cualquier scroll (capture: también scrolls de contenedores internos).
  useEffect(() => {
    if (!open || !step) return
    const update = () => {
      const el = step.selector ? findTourTarget(step.selector) : null
      setTargetRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [open, stepIndex, step])

  // Posición del tooltip tras cada render del paso: el tooltip arranca
  // visibility:hidden, se mide y se coloca antes de mostrarse.
  useEffect(() => {
    if (!open) return
    const tip = dialogRef.current
    if (!tip) return
    const rect = tip.getBoundingClientRect()
    setTipPos(
      positionTooltip(
        targetRect,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [open, stepIndex, targetRect])

  // El foco vive dentro del diálogo: al cambiar de paso vuelve al contenedor
  // (tabIndex=-1) para que el lector de pantalla anuncie el nuevo título.
  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus()
  }, [open, stepIndex])

  if (!open || !step) return null

  const next = () => {
    if (isLast) {
      finish("done")
    } else {
      setStepIndex(stepIndex + 1)
    }
  }

  const pad = SPOTLIGHT_PADDING

  return (
    <DialogPrimitive.Root
      open={open}
      // Escape (DismissableLayer) es el único cierre iniciado por Radix:
      // cuenta como "skipped" para no volver a molestar.
      onOpenChange={(nextOpen) => { if (!nextOpen) finish("skipped") }}
    >
      <DialogPrimitive.Portal>
        {/* Backdrop con "hueco": el anillo sobre el objetivo proyecta la
            sombra que oscurece todo lo demás. Los clics en la página no la
            alcanzan: modal deshabilita pointer-events fuera del contenido
            y los que caen aquí se previenen abajo (outside interactions). */}
        {targetRect ? (
          <div
            aria-hidden="true"
            className="fixed z-[105] rounded-lg ring-2 ring-primary/70 motion-safe:transition-all motion-safe:duration-300"
            style={{
              top: targetRect.top - pad,
              left: targetRect.left - pad,
              width: targetRect.width + pad * 2,
              height: targetRect.height + pad * 2,
              boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
            }}
          />
        ) : (
          <div aria-hidden="true" className="fixed inset-0 z-[105] bg-black/55" />
        )}

        {/* Tooltip del paso: position absoluta manual (spotlight), por eso
            no va centrada como un Dialog normal. */}
        <DialogPrimitive.Content
          ref={dialogRef}
          tabIndex={-1}
          // El autofocus inicial lo maneja el effect de arriba (contenedor,
          // no primer botón) para que se anuncie el título del paso.
          onOpenAutoFocus={(event) => event.preventDefault()}
          // Clic fuera del tooltip no cierra el tour (antes el overlay
          // simplemente tragaba los clics); solo lo cierran sus botones.
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "fixed z-[105] w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl outline-none",
            "motion-safe:transition-[top,left] motion-safe:duration-300"
          )}
          style={{
            top: tipPos?.top ?? 0,
            left: tipPos?.left ?? 0,
            visibility: tipPos ? "visible" : "hidden",
          }}
        >
          {/* Flecha hacia el objetivo (solo cuando hay ancla real) */}
          {tipPos && tipPos.placement !== "center" && tipPos.arrowLeft !== null && (
            <span
              aria-hidden="true"
              className={cn(
                "absolute h-2.5 w-2.5 rotate-45 bg-popover",
                tipPos.placement === "bottom"
                  ? "-top-[5px] border-t border-l"
                  : "-bottom-[5px] border-b border-r"
              )}
              style={{ left: tipPos.arrowLeft - 5 }}
            />
          )}

          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {/* Title/Description autogeneran los ids de aria-labelledby /
                  aria-describedby del Content — no pasar id propio. */}
              <DialogPrimitive.Title className="text-sm font-semibold leading-tight">
                {step.title}
              </DialogPrimitive.Title>
            </div>
            <button
              type="button"
              onClick={() => finish("skipped")}
              aria-label="Cerrar la guía"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <DialogPrimitive.Description className="mt-2 text-sm leading-snug text-muted-foreground">
            {step.body}
          </DialogPrimitive.Description>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => finish("skipped")}
              aria-label="No volver a mostrar esta guía"
              className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              No volver a mostrar
            </button>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => finish("skipped")}
                aria-label="Omitir la guía"
              >
                Omitir
              </Button>
              <Button
                size="sm"
                onClick={next}
                aria-label={
                  isLast
                    ? "Terminar la guía"
                    : `Ir al paso ${stepIndex + 2} de ${steps.length}`
                }
              >
                {isLast ? "Listo" : "Siguiente"}
                {isLast ? (
                  <Check className="ml-1.5 h-4 w-4" />
                ) : (
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Progreso: puntos visuales + anuncio "paso X de N" para lectores. */}
          <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full motion-safe:transition-all",
                  i === stepIndex ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
          <p role="status" className="sr-only">
            Paso {stepIndex + 1} de {steps.length}: {step.title}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
