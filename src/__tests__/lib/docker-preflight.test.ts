import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Evita que una migración nueva agregue un `model` en `prisma/schema.prisma`
 * sin registrarlo en la lista única de tablas críticas
 * (`scripts/critical-tables.json`), y que el preflight de arranque del
 * contenedor (`scripts/docker-preflight.mjs`) la consuma tal cual — sin una
 * copia hardcodeada que pueda desviarse.
 */
describe("critical-tables compartida", () => {
  const root = process.cwd()
  const tablesJson = JSON.parse(
    readFileSync(path.join(root, "scripts/critical-tables.json"), "utf8"),
  ) as { tables?: unknown }

  it("critical-tables.json contiene una lista 'tables' de strings no vacíos", () => {
    expect(Array.isArray(tablesJson.tables)).toBe(true)
    const tables = tablesJson.tables as unknown[]
    expect(tables.length).toBeGreaterThanOrEqual(40)
    for (const t of tables) expect(typeof t).toBe("string")
    expect(new Set(tables).size).toBe(tables.length)
  })

  it("docker-preflight.mjs expone REQUIRED_TABLES = la lista del JSON (fuente única)", async () => {
    const mod = await import("../../../scripts/docker-preflight.mjs")
    expect(mod.REQUIRED_TABLES).toEqual(tablesJson.tables)
  })

  it("incluye todas las tablas definidas en prisma/schema.prisma (respetando @@map)", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")
    const declaredTables = new Set(tablesJson.tables as string[])

    const modelBlocks = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
    expect(modelBlocks.length).toBeGreaterThanOrEqual(40)

    const missing: string[] = []
    for (const [, modelName, body] of modelBlocks) {
      const mapped = /@@map\("([^"]+)"\)/.exec(body)?.[1]
      const tableName = mapped ?? modelName
      if (!declaredTables.has(tableName)) {
        missing.push(`${modelName} (tabla: ${tableName})`)
      }
    }

    expect(missing).toEqual([])
  })
})
