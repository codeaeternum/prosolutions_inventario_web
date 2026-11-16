import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SemaforoBadge, type SemaforoOrder } from "@/components/admin/taller/semaforo"

/**
 * SemaforoBadge — punto de color + leyenda de antigüedad en las tarjetas del
 * taller. El contrato visual es el mapeo estado→color: rojo (vencida / SLA
 * superado), ámbar (promesa ≤24 h o último 20 % del SLA), verde (a tiempo),
 * y nada en etapas terminales o sin SLA propio. Los offsets se construyen
 * relativos a Date.now() para no depender de la fecha del runner.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const order = (over: Partial<SemaforoOrder> = {}): SemaforoOrder => ({
  status: "IN_REPAIR",
  promisedAt: null,
  createdAt: new Date(Date.now() - 10 * DAY).toISOString(),
  updatedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
  ...over,
})

/** Punto de color interior (aria-hidden): la clase bg-* es el color visible. */
const dotClass = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[aria-hidden]")?.className ?? ""

describe("SemaforoBadge", () => {
  it("etapas terminales y laboratorio externo no llevan semáforo", () => {
    for (const status of ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED", "EXTERNAL_LAB"] as const) {
      const { container } = render(<SemaforoBadge order={order({ status })} />)
      expect(container, `status ${status}`).toBeEmptyDOMElement()
    }
  })

  it("WARRANTY tampoco (etapa activa sin SLA propio)", () => {
    const { container } = render(<SemaforoBadge order={order({ status: "WARRANTY" })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("promesa vencida hoy → rojo con 'venció hoy'", () => {
    const { container } = render(
      <SemaforoBadge order={order({ promisedAt: new Date(Date.now() - 2 * HOUR).toISOString() })} />,
    )
    expect(screen.getByText("venció hoy")).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-rose-500")
  })

  it("promesa vencida hace días → rojo con 'Nd retraso'", () => {
    render(
      <SemaforoBadge order={order({ promisedAt: new Date(Date.now() - 3 * DAY).toISOString() })} />,
    )
    expect(screen.getByText("3d retraso")).toBeInTheDocument()
  })

  it("promesa dentro de las próximas 24 h → ámbar 'vence hoy/mañana'", () => {
    const { container } = render(
      <SemaforoBadge order={order({ promisedAt: new Date(Date.now() + 12 * HOUR).toISOString() })} />,
    )
    expect(screen.getByText(/^vence (hoy|mañana)$/)).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-amber-500")
  })

  it("promesa lejana → verde 'a tiempo' con la fecha prometida en el title", () => {
    const promised = new Date(Date.now() + 5 * DAY)
    const { container } = render(<SemaforoBadge order={order({ promisedAt: promised.toISOString() })} />)
    expect(screen.getByText("a tiempo")).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-emerald-500")
    expect((container.firstChild as HTMLElement).getAttribute("title")).toContain("Entrega prometida")
  })

  it("sin promesa y dentro del SLA → verde con leyenda 'antigüedad · etapa'", () => {
    const { container } = render(
      <SemaforoBadge order={order({ updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() })} />,
    )
    expect(screen.getByText("hoy · En reparación")).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-emerald-500")
    expect((container.firstChild as HTMLElement).getAttribute("title")).toBe("Sin fecha de entrega prometida")
  })

  it("sin promesa en el último 20 % del SLA → ámbar", () => {
    // IN_REPAIR tiene SLA 48 h: 40 h transcurridas ≈ 83 %.
    const { container } = render(
      <SemaforoBadge order={order({ updatedAt: new Date(Date.now() - 40 * HOUR).toISOString() })} />,
    )
    expect(screen.getByText("1d · En reparación")).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-amber-500")
  })

  it("sin promesa y SLA superado → rojo", () => {
    const { container } = render(
      <SemaforoBadge order={order({ updatedAt: new Date(Date.now() - 60 * HOUR).toISOString() })} />,
    )
    expect(screen.getByText("2d · En reparación")).toBeInTheDocument()
    expect(dotClass(container)).toContain("bg-rose-500")
  })

  it("slaHours prop personaliza el umbral y aparece en el title", () => {
    // SLA cortado a 10 h: 12 h transcurridas ya son rojo.
    const { container } = render(
      <SemaforoBadge
        order={order({ updatedAt: new Date(Date.now() - 12 * HOUR).toISOString() })}
        slaHours={{ IN_REPAIR: 10 }}
      />,
    )
    expect(dotClass(container)).toContain("bg-rose-500")
    expect((container.firstChild as HTMLElement).getAttribute("title")).toBe(
      "Sin fecha de entrega prometida · SLA de etapa: 10 h",
    )
  })
})
