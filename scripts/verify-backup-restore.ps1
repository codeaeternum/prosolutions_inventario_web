# ProSolutions Inventario - Simulacro de restauracion (restore drill)
# Pensado para correr NO interactivo desde Task Scheduler (semanal) o a mano.
# Uso manual en el N5, desde cualquier carpeta:
#   powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup-restore.ps1
#
# Que hace:
#   1) Localiza el .pgdump mas reciente de <BackupRoot>\db (o el de -DumpFile)
#   2) Valida su TOC con pg_restore --list en un contenedor efimero
#   3) Lo restaura de cero en un contenedor postgres:16-alpine temporal
#      (NUNCA toca prosolutions-db ni datos reales)
#   4) Verifica que las tablas criticas existan y cuenta sus filas
#   5) Escribe <BackupRoot>\last-restore-drill.json y lo copia al volumen
#      prosolutions_payment_proofs como .restore-drill.json
#
# Un backup que no se puede restaurar no es un backup: este script prueba la
# cadena completa (archivo -> pg_restore -> tablas) y deja evidencia auditable.
# OJO: PS 5.1 lee .ps1 como ANSI salvo BOM - solo ASCII en strings/comentarios.

param(
    [string]$BackupRoot = "D:\Backups\prosolutions",
    # Vacio = el .pgdump mas reciente de <BackupRoot>\db
    [string]$DumpFile = "",
    [string]$PgImage = "postgres:16-alpine",
    [string]$TarImage = "alpine",
    [string]$StatusVolume = "prosolutions_payment_proofs",
    [int]$ReadyTimeoutSec = 60
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$statusFile = Join-Path $BackupRoot "last-restore-drill.json"
$containerName = "prosolutions-restore-drill"
$drillDb = "restore_drill"
$drillUser = "drill"
$drillPass = "drill-pass"

# Tablas Prisma que deben existir y responder COUNT(*) tras restaurar.
# OJO: el modelo Branch se mapea a la tabla "WorkshopBranch" (@@map del schema).
$tables = @(
    "Business", "WorkshopBranch", "User", "Product", "ProductModel",
    "Sale", "RepairOrder", "Payment", "InventoryMovement", "AuditEvent"
)

$status = [ordered]@{
    startedAt  = (Get-Date).ToString("o")
    host       = $env:COMPUTERNAME
    backupRoot = $BackupRoot
    dumpFile   = $null
    dumpBytes  = 0
    tocEntries = 0
    container  = $containerName
    ok         = $false
    tables     = [ordered]@{}
    error      = $null
    durationSec = 0
    finishedAt = $null
}
$script:hadFailure = $false
$script:containerStarted = $false

function Write-Log([string]$msg) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

function Remove-DrillContainer {
    # EAP=Stop convierte el stderr nativo en error terminante; el rm de un
    # contenedor inexistente no debe tumbar el script -> Continue temporal.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & docker rm -f $containerName 2>&1 | Out-Null
    $ErrorActionPreference = $prev
}

try {
    $t0 = Get-Date
    Write-Log "=== Simulacro de restauracion ProSolutions ==="

    # ---------- 1) Localizar el dump ----------
    if ($DumpFile) {
        if (-not (Test-Path -LiteralPath $DumpFile)) { throw "DumpFile no existe: $DumpFile" }
        $dump = Get-Item -LiteralPath $DumpFile
    } else {
        $dbDir = Join-Path $BackupRoot "db"
        $dump = Get-ChildItem -LiteralPath $dbDir -Filter "*.pgdump" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $dump) { throw "No hay archivos .pgdump en $dbDir" }
    }
    $status.dumpFile = $dump.FullName
    $status.dumpBytes = $dump.Length
    Write-Log "Dump a probar: $($dump.FullName) ($([math]::Round($dump.Length / 1KB)) KB)"

    # ---------- 2) Validar TOC (pg_restore --list en contenedor efimero) ----------
    $dbDirDocker = ((Split-Path -Parent $dump.FullName) -replace "\\", "/")
    $dbLeaf = $dump.Name
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $tocLines = & docker run --rm -v "${dbDirDocker}:/backup:ro" $PgImage pg_restore --list "/backup/$dbLeaf" 2>&1
    $tocExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($tocExit -ne 0) { throw "pg_restore --list fallo (exit ${tocExit}): $tocLines" }
    $tocCount = ($tocLines | Where-Object { $_ -and -not $_.StartsWith(";") }).Count
    if ($tocCount -lt 10) { throw "TOC incompleto ($tocCount entradas)" }
    $status.tocEntries = $tocCount
    Write-Log "TOC valido: $tocCount entradas"

    # ---------- 3) Contenedor efimero postgres ----------
    Remove-DrillContainer
    Write-Log "Levantando contenedor efimero $containerName ($PgImage)"
    & docker run -d --name $containerName `
        -e "POSTGRES_USER=$drillUser" `
        -e "POSTGRES_PASSWORD=$drillPass" `
        -e "POSTGRES_DB=$drillDb" `
        -v "${dbDirDocker}:/backup:ro" `
        $PgImage | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker run devolvio exit $LASTEXITCODE" }
    $script:containerStarted = $true

    # ---------- 4) Esperar a que postgres acepte conexiones ----------
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        & docker exec $containerName pg_isready -U $drillUser -d $drillDb | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "postgres efimero no respondio en $ReadyTimeoutSec s" }
    Write-Log "postgres efimero listo"

    # ---------- 5) Restaurar el dump ----------
    Write-Log "pg_restore -> $drillDb"
    # pg_restore avisa por stderr aun en exito; se captura con Continue y se
    # decide por exit code (EAP=Stop lo convertiria en falso fallo).
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $restoreOut = & docker exec $containerName pg_restore -U $drillUser -d $drillDb --no-owner --no-privileges "/backup/$dbLeaf" 2>&1
    $restoreExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($restoreExit -ne 0) { throw "pg_restore fallo (exit ${restoreExit}): $restoreOut" }
    Write-Log "pg_restore exit 0"

    # ---------- 6) Contar filas de tablas criticas ----------
    # La SQL viaja por stdin: las comillas de los identificadores PascalCase
    # de Prisma sobreviven intactas (por argv anidado Windows->docker se
    # pierden y psql pliega a minusculas -> "relation does not exist").
    $selParts = $tables | ForEach-Object { "SELECT '$_' AS t, COUNT(*) FROM `"$_`"" }
    $sql = ($selParts -join " UNION ALL ") + " ORDER BY t"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    # ON_ERROR_STOP: psql por stdin sigue tras un error SQL y sale 0 salvo
    # que se pida -v ON_ERROR_STOP=1; sin el flag un conteo roto pasaria.
    $countOut = $sql | & docker exec -i $containerName psql -U $drillUser -d $drillDb -v ON_ERROR_STOP=1 -t -A 2>&1
    $countExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($countExit -ne 0) { throw "conteo de tablas fallo (exit ${countExit}): $countOut" }
    $totalRows = 0
    $seen = @{}
    foreach ($line in ($countOut | Out-String) -split "\r?\n") {
        $line = $line.Trim()
        if ($line -eq "") { continue }
        $parts = $line -split "\|", 2
        if ($parts.Count -ne 2) { throw "salida de psql inesperada: $line" }
        $n = 0
        if (-not [int]::TryParse($parts[1].Trim(), [ref]$n)) { throw "COUNT(*) no numerico en: $line" }
        $status.tables[$parts[0].Trim()] = $n
        $seen[$parts[0].Trim()] = $true
        $totalRows += $n
    }
    foreach ($t in $tables) {
        if (-not $seen.ContainsKey($t)) { throw "tabla ${t} ausente en el conteo" }
    }
    Write-Log "Filas verificadas: total $totalRows en $($tables.Count) tablas"
    if ($status.tables["Business"] -lt 1) { throw "Business sin filas: la restauracion no trajo datos" }
    if ($totalRows -lt 100) { throw "Muy pocas filas ($totalRows): restauracion sospechosa" }

    $status.ok = $true
    Write-Log "=== Simulacro OK: el dump restaura y trae datos reales ==="
} catch {
    $script:hadFailure = $true
    $status.error = "$_"
    Write-Log "SIMULACRO FALLO: $_"
} finally {
    if ($script:containerStarted) { Remove-DrillContainer }
    $status.finishedAt = (Get-Date).ToString("o")
    if ($t0) { $status.durationSec = [int]((Get-Date) - $t0).TotalSeconds }
    try {
        New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
        $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusFile -Encoding UTF8
        Write-Log "Estado escrito en $statusFile"
    } catch {
        Write-Log "No se pudo escribir ${statusFile}: $_"
        $script:hadFailure = $true
    }
    # Copia best-effort al volumen (misma via que el backup diario): la app
    # podria exponerlo despues; el archivo canonico queda en $BackupRoot.
    if (Test-Path -LiteralPath $statusFile) {
        try {
            $statusDirDocker = ($BackupRoot -replace "\\", "/")
            & docker run --rm `
                -v "${StatusVolume}:/data" `
                -v "${statusDirDocker}:/backup:ro" `
                $TarImage sh -c "cp /backup/last-restore-drill.json /data/.restore-drill.json"
            if ($LASTEXITCODE -ne 0) { throw "docker run cp devolvio exit $LASTEXITCODE" }
            Write-Log "Estado copiado a ${StatusVolume}:/.restore-drill.json"
        } catch {
            Write-Log "Copia del estado al volumen FALLO (no afecta el simulacro): $_"
        }
    }
}

if ($script:hadFailure) { exit 1 }
exit 0
