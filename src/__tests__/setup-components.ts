/**
 * Setup del proyecto vitest "components" (environment jsdom).
 *
 * Provee:
 *  - matchers de @testing-library/jest-dom (toBeInTheDocument, toHaveAccessibleName…).
 *  - cleanup() tras cada test — con `globals: false` el auto-cleanup de
 *    @testing-library/react no se registra solo.
 *  - Stubs mínimos de APIs del navegador que jsdom no implementa y que usan
 *    los componentes del repo (radix/shadcn, next-themes, paneles con
 *    scroll/virtualización e imágenes diferidas).
 */
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
})

// jsdom no implementa ResizeObserver (radix-ui, charts, menús flotantes).
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// jsdom no implementa IntersectionObserver (lazy loading / in-view).
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0]
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

// jsdom no implementa matchMedia (next-themes, hooks responsivos).
function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }
}

if (typeof window !== "undefined") {
  if (!window.ResizeObserver) {
    window.ResizeObserver = ResizeObserverStub
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver =
      IntersectionObserverStub as unknown as typeof IntersectionObserver
  }
  if (!window.matchMedia) {
    window.matchMedia = matchMediaStub
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  // Radix (Select/Slider/Dialog por pointer) llama a estas APIs de captura.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
}
