import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Evita que una migración nueva agregue un `model` en `prisma/schema.prisma`
 * sin registrarlo en `REQUIRED_TABLES` de `scripts/docker-preflight.mjs`.
 */
describe("docker-preflight REQUIRED_TABLES", () => {
  it("incluye todas las tablas definidas en prisma/schema.prisma (respetando @@map)", () => {
    const root = process.cwd()
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")
    const preflight = readFileSync(path.join(root, "scripts/docker-preflight.mjs"), "utf8")

    const tableBlockMatch = /REQUIRED_TABLES\s*=\s*\[([\s\S]*?)\]/.exec(preflight)
    expect(tableBlockMatch).not.toBeNull()
    const declaredTables = new Set(
      [...(tableBlockMatch?.[1].matchAll(/"([^"]+)"/g) ?? [])].map(m => m[1]),
    )

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
