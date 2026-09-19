"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type RevealProps = {
  children: ReactNode
  /** Clases extra para el wrapper (p. ej. col-span en grids). */
  className?: string
  /** Retraso en ms para escalonar elementos hermanos. */
  delay?: number
}

/**
 * Reveal on scroll sin dependencias: IntersectionObserver + transición CSS.
 *
 * - El contenido inicia oculto (opacity-0 / translate-y) y se revela una sola
 *   vez al entrar al viewport.
 * - prefers-reduced-motion: las clases motion-reduce:* lo dejan visible sin
 *   animación, aunque el observer no haya disparado.
 * - Sin IntersectionObserver (navegadores antiguos): se muestra de inmediato.
 * - Sin JS: el <noscript> en page.tsx fuerza [data-reveal] visible.
 */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      // Navegador sin IO: mostrar sin animación. Se pisa el estilo en línea
      // (no setState) para no provocar un render en cascada.
      el.style.opacity = "1"
      el.style.translate = "none"
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-reveal
      className={cn(
        "transition-all duration-500 ease-out",
        "motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5",
        className,
      )}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
