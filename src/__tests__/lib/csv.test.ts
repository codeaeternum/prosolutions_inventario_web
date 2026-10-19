import { describe, expect, it } from "vitest"
import { csvCell } from "@/lib/csv"

/**
 * csvCell (lib/csv): la celda compartida de /api/export y /api/activity/export.
 * Además del escape CSV clásico (comillas duplicadas), neutraliza las celdas
 * que Excel/Sheets ejecutarían como fórmula al abrir el archivo.
 */
describe("csvCell", () => {
  it.each(["=SUM(1,2)", "+cmd /c calc", "-2*3", "@import", "\t=1+1", "\r=HYPERLINK()"])(
    "neutraliza fórmulas prefijando ' a %j",
    (input) => {
      expect(csvCell(input)).toBe(`"'${input}"`)
    },
  )

  it("escapa comillas internas duplicándolas y envuelve la celda", () => {
    expect(csvCell('Nota con "comillas"')).toBe('"Nota con ""comillas"""')
    expect(csvCell("texto, con coma")).toBe('"texto, con coma"')
  })

  it("no toca valores normales ni números positivos", () => {
    expect(csvCell("Empleado")).toBe('"Empleado"')
    expect(csvCell(42)).toBe('"42"')
  })

  it("un número negativo se prefija igual (empieza con -)", () => {
    expect(csvCell(-7)).toBe('"' + "'" + '-7"')
  })

  it("null/undefined quedan como celda vacía", () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it("el prefijo de neutralización también se escapa como texto normal", () => {
    // Una vez prefijado con ', el interior sigue con sus comillas duplicadas.
    expect(csvCell('="x"')).toBe('"\'=""x"""')
  })
})
