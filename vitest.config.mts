import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// .mts = ESM real (sin el warning de configLoader "native"): __dirname no
// existe en ESM, la ruta se deriva de import.meta.url.
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) }

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          // Todos los *.integration.test.ts comparten la misma base de datos
          // (hardening). En paralelo, dos archivos chocan en transacciones
          // serializables hasta agotar los reintentos de operation() — el
          // proyecto corre archivo por archivo para que el resultado sea
          // determinista.
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: { alias },
})
