import { defineConfig, devices } from "@playwright/test"

/**
 * Cobertura E2E mínima de aislamiento entre tenants (regresiones de fugas
 * cross-tenant vía localStorage). Corre contra un servidor ya levantado:
 *
 *   npm run dev          # en otra terminal (o cualquier deploy accesible)
 *   npm run test:e2e
 *
 * Para apuntar a otro ambiente:
 *   E2E_BASE_URL=https://reficio.app npm run test:e2e
 *
 * Las pruebas de esta suite no requieren backend/BD: ejercitan el código de
 * cliente (localStorage) que causaba las fugas. Los specs que sí necesitan
 * sesión real quedan documentados con test.skip dentro del spec.
 */
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
  ],
})
