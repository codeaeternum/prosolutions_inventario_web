# ProSolutions Inventario - Registra la tarea programada "ProSolutions-RestoreDrill"
# Ejecutar UNA VEZ en el N5 con PowerShell ELEVADO (Administrador):
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-restore-drill-task.ps1
#
# Es idempotente: si la tarea ya existe la borra y la vuelve a crear.
# La salida completa del simulacro queda en <BackupRoot>\restore-drill-task.log
# (schtasks no guarda stdout de las tareas).
#
# Mismas notas de cuenta que register-backup-task.ps1:
#   - Por defecto la tarea corre como el USUARIO ACTUAL con -LogonType S4U
#     (sin guardar contrasena; corre aunque la sesion este bloqueada).
#   - Docker Desktop en Windows corre en modo usuario: para que `docker`
#     funcione a la hora programada, Docker Desktop debe estar ARRIBA.
#     Sesion de usuario iniciada en el N5 (auto-logon o bloqueada, no cerrada).
#   - -UseSystem registra la tarea como SYSTEM; el pipe docker_engine es
#     accesible para SYSTEM, pero IGUAL hace falta Docker Desktop corriendo.
#
# OJO: PS 5.1 lee .ps1 como ANSI salvo BOM - solo ASCII en strings/comentarios.

param(
    [string]$TaskName = "ProSolutions-RestoreDrill",
    [string]$At = "04:15",
    # Dia de la corrida semanal (el backup diario es a las 03:30; el drill
    # restaura el .pgdump de esa misma madrugada, por eso cae despues)
    [System.DayOfWeek]$DayOfWeek = "Sunday",
    [switch]$UseSystem,
    [string]$BackupRoot = "D:\Backups\prosolutions"
)

$ErrorActionPreference = "Stop"

$drillScript = Join-Path $PSScriptRoot "verify-backup-restore.ps1"
if (-not (Test-Path -LiteralPath $drillScript)) {
    Write-Host "No se encuentra $drillScript" -ForegroundColor Red
    exit 1
}
$projectRoot = Split-Path -Parent $PSScriptRoot

# Registrar una tarea con RunLevel Highest requiere PowerShell elevado
$principalId = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$principalId).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Ejecuta este script en un PowerShell elevado (clic derecho -> Ejecutar como administrador)." -ForegroundColor Red
    exit 1
}

# *> redirige TODOS los streams (en PS 5.1 Write-Host cae al stream
# Information y tambien queda capturado). Se usa -Command porque -File no
# interpreta redirecciones.
# La carpeta del log debe existir ANTES de la primera corrida (si aun no ha
# corrido ningun backup, BackupRoot puede no estar creada).
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$logFile = Join-Path $BackupRoot "restore-drill-task.log"
$actionArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"& '$drillScript' -BackupRoot '$BackupRoot' *> '$logFile'`""
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At ([datetime]$At)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if ($UseSystem) {
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $runAsDesc = "SYSTEM"
} else {
    # WindowsIdentity.Name siempre devuelve el nombre canonico
    # (EQUIPO\usuario o AzureAD\...); $env:USERDOMAIN puede venir vacio sobre
    # SSH y el UserId "\usuario" falla al registrar.
    $runAsUser = $principalId.Name
    $principal = New-ScheduledTaskPrincipal -UserId $runAsUser -LogonType S4U -RunLevel Highest
    $runAsDesc = "$runAsUser (S4U)"
}

# Idempotente: quitar la version anterior si existe
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Ya existia la tarea '$TaskName'; se reemplaza." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description "Simulacro semanal de restauracion ProSolutions: restaura el ultimo .pgdump de $BackupRoot\db en un postgres efimero y cuenta filas de tablas criticas (ver scripts\verify-backup-restore.ps1)" | Out-Null

Write-Host ""
Write-Host "Tarea '$TaskName' registrada:" -ForegroundColor Green
Write-Host "  - Horario: $DayOfWeek a las $At (StartWhenAvailable: recupera ejecuciones perdidas)"
Write-Host "  - Cuenta:  $runAsDesc"
Write-Host "  - Accion:  powershell.exe $actionArgs"
Write-Host "  - Log:     $logFile"
Write-Host ""
Write-Host "Prueba manual sin esperar al $DayOfWeek :" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`"; Start-Sleep 5; Get-ScheduledTaskInfo `"$TaskName`""
Write-Host "  o directo: powershell -ExecutionPolicy Bypass -File `"$drillScript`""
Write-Host ""
Write-Host "Recuerda: Docker Desktop debe estar corriendo a esa hora (sesion de usuario iniciada)." -ForegroundColor Yellow
