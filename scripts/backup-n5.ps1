# ProSolutions Inventario - Backup diario en el N5 (DB + volúmenes Docker)
# Pensado para correr NO interactivo desde Task Scheduler (ver scripts\register-backup-task.ps1).
# Uso manual en el N5, desde cualquier carpeta:
#   powershell -ExecutionPolicy Bypass -File .\scripts\backup-n5.ps1
#
# Qué hace:
#   1) pg_dump -Fc dentro de prosolutions-db  -> <BackupRoot>\db\YYYYMMDD-HHmm.pgdump
#   2) tar.gz de cada volumen de datos        -> <BackupRoot>\<tipo>\<tipo>-YYYYMMDD-HHmm.tar.gz
#   3) Retención: borra artefactos con más de -RetentionDays días (por tipo)
#   4) Escribe <BackupRoot>\last-backup-status.json con el resultado de cada paso
#
# Credenciales: NUNCA en este archivo. Usuario/nombre de BD se toman de
# DATABASE_URL en .env.docker (o de -DbUser/-DbName/-DatabaseUrl).
# pg_dump corre dentro del contenedor: la auth local (socket) de postgres:*-alpine
# es trust; aun así se pasa PGPASSWORD por si el pg_hba cambió.
# Los volúmenes se montan SIEMPRE en solo-lectura (:ro); el script nunca escribe en ellos.

param(
    # Carpeta raíz donde caen los backups (en el N5: D:\Backups\prosolutions)
    [string]$BackupRoot = "D:\Backups\prosolutions",
    # .env.docker del repo; por defecto el que está junto a este script (raíz del proyecto)
    [string]$EnvFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env.docker"),
    # Alternativa/override: pasar la URL o user/db explícitos (p. ej. desde Task Scheduler)
    [string]$DatabaseUrl = "",
    [string]$DbUser = "",
    [string]$DbName = "",
    [string]$DbContainer = "prosolutions-db",
    # Imagen ligera usada para tar de volúmenes (se descarga sola la 1ª vez)
    [string]$TarImage = "alpine",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"

function Write-Log([string]$msg) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
}

# Lee una variable de un archivo .env (sin cargar nada al proceso, sin imprimir valores)
function Get-DotEnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#") -or $t -notmatch "=") { continue }
        $k, $v = $t -split "=", 2
        if ($k.Trim() -eq $Name) {
            return $v.Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# Quoting mínimo estilo Windows para Process.Arguments (PS 5.1 no tiene ArgumentList)
function Quote-Arg([string]$s) {
    if ($s -match '[\s"]') {
        return '"' + ($s -replace '"', '\"') + '"'
    }
    return $s
}

# Ejecuta `docker <args>` y vuelca su stdout BINARIO a un archivo.
# Ojo: `docker exec ... > file` en PowerShell 5.1 reescribe a UTF-16 y corrompe
# el pg_dump custom-format; por eso se copia el stream crudo.
function Invoke-DockerStdoutToFile([string[]]$DockerArgs, [string]$OutFile) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "docker"
    $psi.Arguments = (($DockerArgs | ForEach-Object { Quote-Arg $_ }) -join " ")
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()   # async para no bloquear si stderr se llena
    $fs = [System.IO.File]::Create($OutFile)
    try {
        $p.StandardOutput.BaseStream.CopyTo($fs)
    } finally {
        $fs.Dispose()
    }
    $p.WaitForExit()
    $stderr = $errTask.Result
    if ($p.ExitCode -ne 0) {
        throw "docker $($DockerArgs[0]) falló (exit $($p.ExitCode)): $($stderr.Trim())"
    }
}

# ---------- Estado global / status JSON ----------
$statusFile = Join-Path $BackupRoot "last-backup-status.json"
$status = [ordered]@{
    startedAt  = (Get-Date).ToString("o")
    host       = $env:COMPUTERNAME
    backupRoot = $BackupRoot
    ok         = $false
    db         = @{ file = $null; bytes = 0; ok = $false; error = $null }
    uploads    = @{ file = $null; bytes = 0; ok = $false; error = $null }
    proofs     = @{ file = $null; bytes = 0; ok = $false; error = $null }
    evidence   = @{ file = $null; bytes = 0; ok = $false; error = $null }
    finishedAt = $null
}
$script:hadFailure = $false

# Volúmenes a respaldar: clave en el JSON, volumen Docker y subcarpeta destino.
# uploads/payment_proofs los usa app+bot; repair_evidence existe en
# docker-compose.portainer.yml (evidencias de reparación) y también se respalda.
$volumeJobs = @(
    @{ key = "uploads";  volume = "prosolutions_uploads";         dir = "uploads";        prefix = "uploads" },
    @{ key = "proofs";   volume = "prosolutions_payment_proofs";  dir = "payment-proofs"; prefix = "payment-proofs" },
    @{ key = "evidence"; volume = "prosolutions_repair_evidence"; dir = "repair-evidence"; prefix = "repair-evidence" }
)

try {
    Write-Log "=== ProSolutions backup -> $BackupRoot ==="

    # ---------- Resolver credenciales (sin hardcodear) ----------
    if (-not $DatabaseUrl) { $DatabaseUrl = Get-DotEnvValue -Path $EnvFile -Name "DATABASE_URL" }
    if ($DatabaseUrl -and $DatabaseUrl -match '^postgres(ql)?://([^:/?#]+):([^@/?#]*)@[^/:?#]+(?::\d+)?/([^?/#]+)') {
        if (-not $DbUser) { $DbUser = [uri]::UnescapeDataString($Matches[2]) }
        $DbPass = [uri]::UnescapeDataString($Matches[3])
        if (-not $DbName) { $DbName = $Matches[4] }
    } else {
        $DbPass = ""
        if (-not $DbUser) { $DbUser = Get-DotEnvValue -Path $EnvFile -Name "POSTGRES_USER" }
        if (-not $DbName) { $DbName = Get-DotEnvValue -Path $EnvFile -Name "POSTGRES_DB" }
    }
    if (-not $DbUser -or -not $DbName) {
        throw "No se pudo obtener usuario/BD: define DATABASE_URL en $EnvFile o pasa -DbUser/-DbName."
    }
    Write-Log "BD destino: $DbName (usuario $DbUser, contenedor $DbContainer)"

    # ---------- Carpetas destino ----------
    New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot "db") | Out-Null
    foreach ($j in $volumeJobs) {
        New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot $j.dir) | Out-Null
    }

    # ---------- 1) Dump de PostgreSQL ----------
    $dbFile = Join-Path $BackupRoot ("db\{0}.pgdump" -f $timestamp)
    try {
        $dumpArgs = @("exec")
        if ($DbPass) { $dumpArgs += @("-e", "PGPASSWORD=$DbPass") }
        $dumpArgs += @($DbContainer, "pg_dump", "-U", $DbUser, "-Fc", $DbName)
        Write-Log "pg_dump -Fc $DbName -> $dbFile"
        Invoke-DockerStdoutToFile -DockerArgs $dumpArgs -OutFile $dbFile
        $bytes = (Get-Item -LiteralPath $dbFile).Length
        if ($bytes -lt 100) { throw "dump sospechosamente pequeño ($bytes bytes); se descarta" }
        $status.db = @{ file = $dbFile; bytes = $bytes; ok = $true; error = $null }
        Write-Log ("DB OK ({0:N1} MB)" -f ($bytes / 1MB))
    } catch {
        $script:hadFailure = $true
        $status.db.error = "$_"
        if (Test-Path -LiteralPath $dbFile) { Remove-Item -LiteralPath $dbFile -Force -ErrorAction SilentlyContinue }
        Write-Log "DB FALLO: $_"
    }

    # ---------- 2) tar.gz de cada volumen (montaje solo-lectura) ----------
    foreach ($j in $volumeJobs) {
        $hostDir = Join-Path $BackupRoot $j.dir
        $hostDirDocker = ($hostDir -replace "\\", "/")   # Docker Desktop acepta D:/... directo
        $tarName = "{0}-{1}.tar.gz" -f $j.prefix, $timestamp
        $outFile = Join-Path $hostDir $tarName
        try {
            docker volume inspect $j.volume | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "el volumen $($j.volume) no existe en este host" }
            Write-Log "tar $($j.volume) -> $outFile"
            & docker run --rm `
                -v "$($j.volume):/data:ro" `
                -v "${hostDirDocker}:/backup" `
                $TarImage tar czf "/backup/$tarName" -C /data .
            if ($LASTEXITCODE -ne 0) { throw "docker run tar devolvió exit $LASTEXITCODE" }
            $bytes = (Get-Item -LiteralPath $outFile).Length
            $status[$j.key] = @{ file = $outFile; bytes = $bytes; ok = $true; error = $null }
            Write-Log ("{0} OK ({1:N1} MB)" -f $j.key, ($bytes / 1MB))
        } catch {
            $script:hadFailure = $true
            $status[$j.key].error = "$_"
            if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue }
            Write-Log "$($j.key) FALLO: $_"
        }
    }

    # ---------- 3) Retención: borrar artefactos más viejos que N días ----------
    try {
        $cutoff = (Get-Date).AddDays(-$RetentionDays)
        $removed = 0
        $dirs = @((Join-Path $BackupRoot "db")) + ($volumeJobs | ForEach-Object { Join-Path $BackupRoot $_.dir })
        foreach ($d in $dirs) {
            Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt $cutoff } |
                ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; $removed++ }
        }
        if ($removed -gt 0) { Write-Log "Retención: $removed archivo(s) de más de $RetentionDays días eliminados" }
        else { Write-Log "Retención: nada que purgar (> $RetentionDays días)" }
    } catch {
        $script:hadFailure = $true
        Write-Log "Retención FALLO: $_"
    }
} catch {
    $script:hadFailure = $true
    Write-Log "ERROR FATAL: $_"
} finally {
    $status.finishedAt = (Get-Date).ToString("o")
    $status.ok = (-not $script:hadFailure) -and $status.db.ok -and $status.uploads.ok -and $status.proofs.ok -and $status.evidence.ok
    try {
        New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
        $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusFile -Encoding UTF8
        Write-Log "Estado escrito en $statusFile"
    } catch {
        Write-Log "No se pudo escribir ${statusFile}: $_"
        $script:hadFailure = $true
    }
}

if ($script:hadFailure) {
    Write-Log "=== Backup terminó CON ERRORES ==="
    exit 1
}
Write-Log "=== Backup OK ==="
exit 0
