// Business.category es libre; etiqueta amigable para los valores conocidos.
// Módulo sin dependencias de servidor: lo comparten /mercado (Server
// Component), las tarjetas y los popups del mapa (Client Component). Mantener
// este archivo libre de imports a prisma/servidor — de lo contrario el
// bundler arrastra Node al bundle del navegador.
const CATEGORY_LABELS: Record<string, string> = {
  "electronics-repair": "Reparación de electrónica",
}

export function directoryCategoryLabel(value: string): string {
  const known = CATEGORY_LABELS[value]
  if (known) return known
  const humanized = value.replace(/[-_]+/g, " ").trim()
  if (!humanized) return "Negocio"
  return humanized.charAt(0).toUpperCase() + humanized.slice(1)
}
