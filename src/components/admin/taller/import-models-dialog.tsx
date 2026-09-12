"use client"

import { useRef, useState } from "react"
import { AlertTriangle, Database, Download, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type CsvRow = { brand: string; model: string; code?: string; type?: string }
type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }

const PREVIEW_ROWS = 10

// Encabezados aceptados (español o inglés); se normalizan quitando acentos.
const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  marca: "brand",
  brand: "brand",
  modelo: "model",
  model: "model",
  codigo: "code",
  code: "code",
  tipo: "type",
  type: "type",
}

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

// Parser CSV simple con manejo de comillas y comillas escapadas ("").
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field); field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1
      row.push(field); field = ""
      rows.push(row); row = []
    } else {
      field += ch
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function downloadTemplate() {
  const csv = [
    "marca,modelo,codigo,tipo",
    "Samsung,Galaxy A54,SM-A546E,smartphone",
    "Apple,iPhone 13,A2485,smartphone",
    "Motorola,Moto G84,XT2347,smartphone",
  ].join("\r\n")
  // BOM para que Excel lo abra como UTF-8.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "plantilla_modelos_equipo.csv"
  anchor.click()
  URL.revokeObjectURL(url)
}

export function DeviceModelsImportDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<CsvRow[]>([])
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [bundledLoading, setBundledLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const busy = importing || bundledLoading

  function resetFile() {
    setFileName("")
    setRows([])
    setMissingColumns([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) { resetFile(); setResult(null) }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setResult(null)
    try {
      const text = await file.text()
      const grid = parseCsv(text).filter(cells => cells.some(cell => cell.trim() !== ""))
      if (grid.length === 0) {
        resetFile()
        toast.error("El archivo está vacío o no tiene el formato esperado.")
        return
      }
      const headerCells = grid[0].map(normalizeHeader)
      const hasHeader = headerCells.some(cell => cell in HEADER_ALIASES)
      const columnIndex: Partial<Record<keyof CsvRow, number>> = {}
      let dataRows: string[][]
      if (hasHeader) {
        dataRows = grid.slice(1)
        headerCells.forEach((cell, index) => {
          const key = HEADER_ALIASES[cell]
          if (key && columnIndex[key] === undefined) columnIndex[key] = index
        })
        const missing = (["brand", "model"] as const).filter(key => columnIndex[key] === undefined)
        setMissingColumns(missing.map(key => (key === "brand" ? "marca" : "modelo")))
      } else {
        // Sin encabezado: orden fijo marca,modelo,codigo,tipo.
        dataRows = grid
        columnIndex.brand = 0
        columnIndex.model = 1
        columnIndex.code = 2
        columnIndex.type = 3
        setMissingColumns([])
      }
      const cell = (cells: string[], key: keyof CsvRow) => {
        const index = columnIndex[key]
        return (index === undefined ? "" : (cells[index] ?? "")).trim()
      }
      const parsed = dataRows.map(cells => ({
        brand: cell(cells, "brand"),
        model: cell(cells, "model"),
        code: cell(cells, "code") || undefined,
        type: cell(cells, "type") || undefined,
      }))
      setRows(parsed)
      setFileName(file.name)
      if (parsed.length === 0) toast.error("El archivo no tiene filas de datos.")
    } catch {
      resetFile()
      toast.error("No se pudo leer el archivo CSV.")
    }
  }

  async function postImport(payload: Record<string, unknown>) {
    const response = await fetch("/api/device-models/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || "No se pudo completar la importación")
    return data as ImportResult
  }

  function showResult(data: ImportResult) {
    setResult(data)
    toast.success(`${data.created} creados · ${data.updated} actualizados · ${data.skipped} omitidos`)
    onImported?.()
  }

  async function importRows() {
    if (busy || rows.length === 0 || missingColumns.length > 0) return
    setImporting(true)
    setResult(null)
    try {
      showResult(await postImport({ mode: "upsert", rows }))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo completar la importación")
    } finally {
      setImporting(false)
    }
  }

  async function importBundled() {
    if (busy) return
    setBundledLoading(true)
    setResult(null)
    try {
      showResult(await postImport({ mode: "bundled" }))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo cargar la base incluida")
    } finally {
      setBundledLoading(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />Importar CSV
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="space-y-4">
          <DialogHeader>
            <DialogTitle>Importar modelos de equipo</DialogTitle>
            <DialogDescription>
              Sube un CSV con columnas <span className="font-mono text-xs">marca,modelo,codigo,tipo</span> (código y
              tipo opcionales). Si marca + modelo ya existen, se actualiza el registro.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-3.5 w-3.5" />Descargar plantilla
            </Button>
            <p className="text-xs text-muted-foreground">
              Ejemplo: <span className="font-mono">Samsung,Galaxy A54,SM-A546E,smartphone</span>
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={event => { void handleFile(event) }}
            disabled={busy}
            className="block w-full cursor-pointer text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
          />

          {missingColumns.length > 0 && (
            <p className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Faltan columnas requeridas: {missingColumns.join(", ")}. Revisa el encabezado del archivo.
            </p>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{fileName}</span> — {rows.length}{" "}
                {rows.length === 1 ? "fila detectada" : "filas detectadas"}
                {rows.length > PREVIEW_ROWS ? ` (se muestran ${PREVIEW_ROWS})` : ""}
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="hidden sm:table-cell">Código</TableHead>
                      <TableHead className="hidden sm:table-cell">Tipo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                      <TableRow key={index} className={row.brand && row.model ? "" : "bg-destructive/5"}>
                        <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>{row.brand || <span className="text-destructive">vacía</span>}</TableCell>
                        <TableCell>{row.model || <span className="text-destructive">vacío</span>}</TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{row.code || "—"}</TableCell>
                        <TableCell className="hidden text-xs sm:table-cell">{row.type || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm" role="status">
              <p className="font-medium">
                {result.created} creados · {result.updated} actualizados · {result.skipped} omitidos
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                  {result.errors.map((error, index) => (
                    <li key={index}>Fila {error.row}: {error.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t pt-4">
            <Button type="button" onClick={() => { void importRows() }} disabled={busy || rows.length === 0 || missingColumns.length > 0}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Importar {rows.length > 0 ? `${rows.length} ` : ""}modelos
            </Button>
            <Button type="button" variant="secondary" onClick={() => { void importBundled() }} disabled={busy}>
              {bundledLoading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Database className="mr-2 h-4 w-4" />}
              Cargar base de datos incluida
            </Button>
            <p className="text-xs text-muted-foreground">
              La base incluida agrega o actualiza ~8,500 modelos del catálogo precargado del servidor.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
