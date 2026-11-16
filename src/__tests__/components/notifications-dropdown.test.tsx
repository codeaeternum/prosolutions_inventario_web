import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Notification } from "@/hooks/use-notifications"
import { NotificationsDropdown } from "@/components/notifications-dropdown"

/**
 * NotificationsDropdown — campana del shell admin. El hook useNotifications
 * (SSE + sesión + localStorage + audio) queda mockeado; se conserva el
 * notificationHref real del módulo para que el test cubra también el mapeo
 * tipo→destino que usa el clic. next/navigation se mockea por useRouter.
 */

const routerPush = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}))

const hookState = vi.hoisted(() => ({
  notifications: [] as Notification[],
  isConnected: true,
  unreadCount: 0,
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  clearNotifications: vi.fn(),
}))

vi.mock("@/hooks/use-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-notifications")>()
  return {
    ...actual,
    useNotifications: () => hookState,
  }
})

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: "n1",
  type: "low_stock",
  title: "Stock bajo",
  message: "Quedan 2 piezas de SKU-1",
  timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
  read: false,
  ...over,
})

describe("NotificationsDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookState.notifications = []
    hookState.isConnected = true
    hookState.unreadCount = 0
  })

  it("botón accesible: aria-haspopup=menu y aria-expanded refleja el estado", async () => {
    const user = userEvent.setup()
    render(<NotificationsDropdown />)
    const trigger = screen.getByRole("button", { name: /^notificaciones$/i })

    expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("muestra el conteo de no leídas en el badge y en el aria-label", () => {
    hookState.unreadCount = 3
    hookState.notifications = [notification()]
    render(<NotificationsDropdown />)
    const trigger = screen.getByRole("button", { name: /notificaciones \(3 sin leer\)/i })
    expect(trigger).toHaveTextContent("3")
  })

  it("más de 9 no leídas → el badge muestra '9+'", () => {
    hookState.unreadCount = 12
    render(<NotificationsDropdown />)
    expect(screen.getByText("9+")).toBeInTheDocument()
  })

  it("clic en una notificación con destino: la marca leída, navega y cierra", async () => {
    const user = userEvent.setup()
    const n = notification({ id: "n-low", type: "low_stock" })
    hookState.notifications = [n]
    render(<NotificationsDropdown />)

    await user.click(screen.getByRole("button", { name: /notificaciones/i }))
    await user.click(screen.getByText("Stock bajo"))

    expect(hookState.markAsRead).toHaveBeenCalledWith("n-low")
    // Destino real del mapeo notificationHref (low_stock → inventario).
    expect(routerPush).toHaveBeenCalledWith("/admin/inventario")
    expect(screen.queryByText("Stock bajo")).not.toBeInTheDocument()
  })

  it("clic en notificación sin destino: solo la marca leída, sin navegar", async () => {
    const user = userEvent.setup()
    // user_registered no tiene mapeo en notificationHref → null.
    hookState.notifications = [notification({ id: "n-user", type: "user_registered" })]
    render(<NotificationsDropdown />)

    await user.click(screen.getByRole("button", { name: /notificaciones/i }))
    await user.click(screen.getByText("Stock bajo"))

    expect(hookState.markAsRead).toHaveBeenCalledWith("n-user")
    expect(routerPush).not.toHaveBeenCalled()
  })

  it("ordena la lectura completa y la limpieza desde el header", async () => {
    const user = userEvent.setup()
    hookState.notifications = [notification()]
    render(<NotificationsDropdown />)
    await user.click(screen.getByRole("button", { name: /notificaciones/i }))

    await user.click(screen.getByRole("button", { name: /marcar todas las notificaciones como leídas/i }))
    expect(hookState.markAllAsRead).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: /limpiar todas las notificaciones/i }))
    expect(hookState.clearNotifications).toHaveBeenCalledTimes(1)
  })

  it("Escape y el backdrop cierran el panel", async () => {
    const user = userEvent.setup()
    hookState.notifications = [notification()]
    render(<NotificationsDropdown />)
    const trigger = screen.getByRole("button", { name: /notificaciones/i })

    await user.click(trigger)
    expect(screen.getByText("Stock bajo")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByText("Stock bajo")).not.toBeInTheDocument()

    await user.click(trigger)
    // Backdrop fixed inset-0: un clic fuera apaga el panel.
    const backdrop = document.querySelector(".fixed.inset-0") as HTMLElement
    await user.click(backdrop)
    expect(screen.queryByText("Stock bajo")).not.toBeInTheDocument()
  })

  it("lista vacía → estado vacío accesible; desconectado → indicador rojo", async () => {
    const user = userEvent.setup()
    hookState.isConnected = false
    render(<NotificationsDropdown />)
    await user.click(screen.getByRole("button", { name: /notificaciones/i }))

    expect(screen.getByText("No hay notificaciones")).toBeInTheDocument()
    expect(screen.getByText("○ Desconectado")).toBeInTheDocument()
    expect(screen.getByText("Desconectado")).toBeInTheDocument() // sr-only en el botón
  })
})
