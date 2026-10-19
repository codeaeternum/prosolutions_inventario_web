# ProSolutions Inventario - Registra la tarea programada "ProSolutions-Backup"
# Ejecutar UNA VEZ en el N5 con PowerShell ELEVADO (Administrador):
#   powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1
#
# Es idempotente: si la tarea ya existe la borra y la vuelve a crear.
#
# IMPORTANTE sobre la cuenta:
#   - Por defecto la tarea corre como el USUARIO ACTUAL con -LogonType S4U
#     (sin guardar contraseña; corre aunque la sesión esté bloqueada).
#   - Docker Desktop en Windows corre en modo usuario: para que `docker`
#     funcione a las 03:30, Docker Desktop debe estar ARRIBA en esa hora.
#     En Settings del Docker Desktop deja marcado "Start Docker Desktop
#     when you sign in" y mantén sesión iniciada en el N5 (auto-logon o
#     sesión bloqueada, no cerrada).
#   - Si prefieres la cuenta SYSTEM: ejecuta con -UseSystem. El pipe
#     \\.\pipe\docker_engine es accesible para Administrators/SYSTEM, pero
#     IGUAL hace falta que Docker Desktop esté corriendo (lo arranca la
#     sesión de usuario). Útil solo si el N5 queda siempre con sesión viva.

param(
    [string]$TaskName = "ProSolutions-Backup",
    [string]$At = "03:30",
    [switch]$UseSystem,
    # Parámetros extra opcionales que se reenvían al backup (rutas distintas, etc.)
    [string]$BackupRoot = "D:\Backups\prosolutions"
)

$ErrorActionPreference = "Stop"

$backupScript = Join-Path $PSScriptRoot "backup-n5.ps1"
if (-not (Test-Path -LiteralPath $backupScript)) {
    Write-Host "No se encuentra $backupScript" -ForegroundColor Red
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

$actionArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`" -BackupRoot `"$BackupRoot`""
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]$At)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if ($UseSystem) {
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $runAsDesc = "SYSTEM"
} else {
    # $env:USERDOMAIN\$env:USERNAME no sirve: sobre SSH o sesiones remotas
    # USERDOMAIN puede venir vacío y el UserId "\usuario" falla al registrar
    # con "no mapping between account names and SIDs". WindowsIdentity siempre
    # devuelve el nombre canónico (EQUIPO\usuario o AzureAD\...).
    $runAsUser = $principalId.Name
    $principal = New-ScheduledTaskPrincipal -UserId $runAsUser -LogonType S4U -RunLevel Highest
    $runAsDesc = "$runAsUser (S4U)"
}

# Idempotente: quitar la versión anterior si existe
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Ya existía la tarea '$TaskName'; se reemplaza." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description "Backup diario ProSolutions: pg_dump de prosolutions-db + tar de volumenes a $BackupRoot (ver scripts\backup-n5.ps1)" | Out-Null

Write-Host ""
Write-Host "Tarea '$TaskName' registrada:" -ForegroundColor Green
Write-Host "  - Horario: diario a las $At (StartWhenAvailable: recupera ejecuciones perdidas)"
Write-Host "  - Cuenta:  $runAsDesc"
Write-Host "  - Acción:  powershell.exe $actionArgs"
Write-Host ""
Write-Host "Prueba manual sin esperar a las $At :" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName `"$TaskName`"; Start-Sleep 5; Get-ScheduledTaskInfo `"$TaskName`""
Write-Host "  o directo: powershell -ExecutionPolicy Bypass -File `"$backupScript`""
Write-Host ""
Write-Host "Recuerda: Docker Desktop debe estar corriendo a esa hora (sesión de usuario iniciada)." -ForegroundColor Yellow
