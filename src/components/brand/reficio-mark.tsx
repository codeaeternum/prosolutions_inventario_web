import { cn } from "@/lib/utils"

// Isotipo Reficio: tuerca hexagonal con agujero circular + la diagonal
// que dibuja la "R". Usa currentColor para heredar el color del contexto
// (tile primario, texto violeta, mono 1-bit en impresión).
export function ReficioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("h-6 w-6", className)}>
      <g transform="rotate(15 50 50)">
        <path
          d="M 94 50 L 72 12.1 L 28 12.1 L 6 50 L 28 87.9 L 72 87.9 Z
             M 50 50 m -22 0 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0"
          fill="currentColor"
          fillRule="evenodd"
        />
      </g>
      <rect
        x="43.5"
        y="10"
        width="13"
        height="80"
        fill="currentColor"
        transform="rotate(-45 50 50)"
      />
    </svg>
  )
}
