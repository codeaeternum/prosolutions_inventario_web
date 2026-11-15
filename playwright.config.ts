import { defineConfig, devices } from "@playwright/test"

/**
 * Suite E2E de regresión (aislamiento entre tenants + smoke público +
 * auth/carrito + smoke admin con sesión).
 *
 * Corre contra un servidor YA levantado — nunca arranca `next dev` solo:
 *
 *   npm run dev                          # en otra terminal (o cualquier deploy)
 *   npm run test:e2e
 *
 * Suite pública contra producción (solo lectura — GET, render,
 * client-side, localStorage; los specs con sesión se auto-skipean):
 *
 *   E2E_BASE_URL=https://reficio.app npm run test:e2e
 *
 * Si quieres que Playwright arranque el dev server local (opt-in, porque
 * puede no haber BD local):
 *
 *   E2E_START_DEV=1 npm run test:e2e
 *
 * Specs con sesión admin (ambiente con usuario ADMIN sembrado):
 *
 *   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:e2e
 *
 * Specs que escriben en el servidor (ventas, reservas): además requieren
 * E2E_ALLOW_WRITES=1 y un ambiente DESECHABLE. Nunca contra reficio.app.
 */

// Specs públicos: solo lectura contra cualquier deploy. Los corren ambos
// proyectos (desktop + Pixel 7 como responsive smoke barato).
const PUBLIC_SPECS = [
  "public-pages.spec.ts",
  "auth-flow.spec.ts",
  "cart-flow.spec.ts",
  "tenant-isolation.spec.ts",
]

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  timeout: 60_000,
  expect: {
    // Hidratación React + efectos que leen/escriben localStorage: margen amplio.
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testMatch: PUBLIC_SPECS,
    },
  ],
  // webServer es OPT-IN: con E2E_START_DEV=1 arranca `npm run dev` (y reusa
  // uno ya levantado en :3000). Sin la flag no se intenta levantar nada —
  // los specs fallarán rápido si el baseURL no responde.
  ...(process.env.E2E_START_DEV === "1"
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
})
