# Backup diario — ProSolutions en el N5

Backup automático nocturno de PostgreSQL y los volúmenes de archivos, corriendo en el propio N5 con Task Scheduler. Sin credenciales en el repo: usuario/BD salen de `DATABASE_URL` en `.env.docker`.

---

## Qué corre y cuándo

| Pieza | Detalle |
|---|---|
| **Script** | `scripts\backup-n5.ps1` |
| **Tarea programada** | `ProSolutions-Backup`, diaria a las **03:30** (`StartWhenAvailable`: si el PC estaba apagado, corre al encender) |
| **Registro** | `scripts\register-backup-task.ps1` (una sola vez, PowerShell elevado) |
| **Artefactos** | pg_dump custom-format + tar.gz por volumen, retención **14 días** |
| **Espejo offsite** | copia de cada corrida en `F:\prosolutions-backups` (segundo disco físico), misma retención |
| **Estado** | `D:\Backups\prosolutions\last-backup-status.json` tras cada corrida |

Qué respalda cada noche:

1. `docker exec prosolutions-db pg_dump -Fc` → `db\YYYYMMDD-HHmm.pgdump`
2. `prosolutions_uploads` (archivos subidos, app+bot) → `uploads\uploads-...tar.gz`
3. `prosolutions_payment_proofs` (comprobantes de pago) → `payment-proofs\payment-proofs-...tar.gz`
4. `prosolutions_repair_evidence` (evidencias de reparación) → `repair-evidence\repair-evidence-...tar.gz`

Además, tras el `pg_dump` el propio script valida la integridad del archivo con `pg_restore --list` **dentro de `prosolutions-db`** (`docker cp` del `.pgdump` a `/tmp` del contenedor, `docker exec pg_restore --list`, `rm`): mismo binario que el servidor y cero dependencia de un pull de imagen a las 03:30. Exige TOC completo (≥10 entradas) y guarda `db.verified` + `db.tocEntries` en el status. Si la **verificación** falla, el `.pgdump` se **conserva** — queda `db.ok:true` pero `db.verified:false` + `db.verifyError` (un dump sin verificar es advertencia, no fallo fatal); solo se descarta un dump que falló al generarse.

Los volúmenes se montan **solo-lectura** (`-v volumen:/data:ro`); el backup nunca escribe en ellos. El dump se genera dentro del contenedor y se vuelca byte a byte a disco (no usa `>` de PowerShell, que corrompería el binario en Windows PowerShell 5.1).

**Requisito:** Docker Desktop debe estar corriendo a las 03:30 → el N5 debe quedar con sesión de usuario iniciada (bloqueada vale, cerrada no) y *"Start Docker Desktop when you sign in"* activado.

---

## Instalación / actualización (en el N5)

```powershell
# PowerShell ELEVADO, desde la carpeta del proyecto (D:\Projectos\prosolutions_inventario_web)
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1

# Opciones: -At "04:00"   -UseSystem   -BackupRoot "E:\Backups\prosolutions"
```

Probar sin esperar a la madrugada:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-n5.ps1
# o la tarea tal cual la corre Windows:
Start-ScheduledTask -TaskName "ProSolutions-Backup"
Get-ScheduledTaskInfo "ProSolutions-Backup"   # LastRunTime / LastTaskResult (0 = OK)
```

---

## Dónde caen los archivos

```
D:\Backups\prosolutions\
├── db\20260115-0330.pgdump            # pg_dump -Fc (verificado con pg_restore --list)
├── uploads\uploads-20260115-0330.tar.gz
├── payment-proofs\payment-proofs-20260115-0330.tar.gz
├── repair-evidence\repair-evidence-20260115-0330.tar.gz
├── last-backup-status.json            # resultado de la última corrida (incluye db.tocEntries)
└── last-restore-drill.json            # resultado del último simulacro semanal
```

`last-backup-status.json` (ejemplo):

```json
{
  "startedAt": "2026-01-15T03:30:00",
  "ok": true,
  "db":       { "file": "D:\\Backups\\prosolutions\\db\\20260115-0330.pgdump", "bytes": 8388608, "ok": true, "verified": true, "tocEntries": 1234, "verifyError": null, "error": null },
  "uploads":  { "...": "..." },
  "proofs":   { "...": "..." },
  "evidence": { "...": "..." },
  "offsite":  { "enabled": true, "files": 4, "bytes": 12582912, "ok": true, "error": null },
  "finishedAt": "2026-01-15T03:31:12"
}
```

---

## Espejo en segundo disco (`F:\prosolutions-backups`)

`D:` y `C:` del N5 son SSDs distintos y `F:` es el HDD de 4 TB: el backup que solo vive en `D:` muere con el SSD. Por eso el script replica **los artefactos de cada corrida** a un segundo disco físico al terminar, controlado por el parámetro `-OffsiteRoot` (default `F:\prosolutions-backups`; cadena vacía lo desactiva).

Cómo funciona:

1. Misma estructura de subcarpetas que el origen: `F:\prosolutions-backups\db\`, `\uploads\`, `\payment-proofs\`, `\repair-evidence\`. Solo copia los artefactos de la corrida en curso que quedaron `ok` (no rsync completo — el espejo se construye corrida a corrida).
2. **Misma retención que el origen** (14 días por tipo, conservando siempre los 3 más nuevos por carpeta) y bajo la misma condición de seguridad: solo purga cuando el dump DB de la corrida quedó verificado — una racha de fallos nunca deja el espejo sin copias.
3. Si el disco `F:` no existe, el backup principal **no falla** por ello: el espejo se omite con advertencia y queda `offsite.ok:false` + `offsite.error` en el status. Pero una copia que muere a mitad (disco lleno, permisos) **sí** marca la corrida con error — una copia espejo que falla en silencio durante semanas es peor que una alerta.
4. El resultado viaja en `last-backup-status.json` como `offsite: { enabled, files, bytes, ok, error }` y la app lo expone saneado en `GET /api/admin/backup-status` (campo `offsite`; las rutas del host nunca se filtran).

La tarea programada corre el script **sin `-OffsiteRoot` explícito**, así que usa el default `F:\prosolutions-backups` — que es justo lo que se quiere en el N5. Para cambiar la raíz espejo o desactivarla (`-OffsiteRoot ""`) en corridas manuales, pasa el parámetro directo al script; para cambiarlo en la tarea hay que editar la acción registrada (register-backup-task.ps1 hoy solo propaga `-BackupRoot`):

```powershell
# Manual con otra raíz espejo, o sin espejo:
powershell -ExecutionPolicy Bypass -File .\scripts\backup-n5.ps1 -OffsiteRoot "E:\respaldo-espejo"
powershell -ExecutionPolicy Bypass -File .\scripts\backup-n5.ps1 -OffsiteRoot ""
```

### Restaurar desde el espejo

Es idéntico a restaurar desde `D:\Backups\prosolutions` — mismo nombre de archivo, solo cambia la raíz. Sirve cuando el SSD de `D:` murió o el artefacto del origen está corrupto:

```powershell
# DB: copiar el dump del espejo al contenedor y restaurar (igual que la sección "Cómo restaurar")
docker cp "F:\prosolutions-backups\db\20260115-0330.pgdump" prosolutions-db:/tmp/restore.pgdump
docker exec prosolutions-db pg_restore -U prosolutions -d prosolutions_db --clean --if-exists --no-owner /tmp/restore.pgdump
docker exec prosolutions-db rm /tmp/restore.pgdump

# Volúmenes: montar la carpeta del ESPEJO en vez de la del origen
docker run --rm -v prosolutions_uploads:/data -v F:/prosolutions-backups/uploads:/backup `
  alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/uploads-20260115-0330.tar.gz -C /data"
```

Ojo: el restore-drill semanal verifica el `.pgdump` del **origen** (`D:`), no el espejo — si quieres validar un dump del espejo, corre `verify-backup-restore.ps1 -DumpFile "F:\prosolutions-backups\db\<archivo>.pgdump"` a mano.

---

## Cómo restaurar

### Base de datos

```powershell
# 1) Copiar el dump dentro del contenedor y restaurar (sobreescribe objetos existentes)
docker cp "D:\Backups\prosolutions\db\20260115-0330.pgdump" prosolutions-db:/tmp/restore.pgdump
docker exec prosolutions-db pg_restore -U prosolutions -d prosolutions_db --clean --if-exists --no-owner /tmp/restore.pgdump
docker exec prosolutions-db rm /tmp/restore.pgdump

# 2) Reiniciar app/bot para que tomen el estado restaurado
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker restart app bot
```

Para restaurar en una BD **vacía** (p. ej. volumen nuevo), basta `pg_restore -U prosolutions -d prosolutions_db /tmp/restore.pgdump` sin `--clean`.

### Volúmenes (uploads / comprobantes / evidencias)

DESTRUCTIVO: vacía el volumen y extrae el tar encima. Parar la app primero.

```powershell
docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker stop app bot

docker run --rm -v prosolutions_uploads:/data -v D:/Backups/prosolutions/uploads:/backup `
  alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/uploads-20260115-0330.tar.gz -C /data"
# Mismo patrón con prosolutions_payment_proofs / prosolutions_repair_evidence

docker compose -f docker-compose.portainer.yml -p prosolutions --env-file .env.docker start app bot
```

Ensayo seguro (recomendado antes de tocar el volumen real): extraer a un volumen temporal y revisar el contenido con `docker run --rm -v tmp_restore:/data alpine ls -la /data`.

---

## Cómo verificar

```powershell
# Estado de la última corrida
Get-Content D:\Backups\prosolutions\last-backup-status.json

# Archivos recientes y tamaños
Get-ChildItem D:\Backups\prosolutions -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 8 FullName, Length

# Info de la tarea
Get-ScheduledTaskInfo "ProSolutions-Backup"   # LastTaskResult: 0 = éxito
```

Verificación de verdad (una vez al menos): restaurar el dump en un Postgres desechable — `docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=x postgres:16-alpine`, `docker cp` del `.pgdump`, `docker exec pgtest pg_restore -U postgres -d postgres ...`, `docker exec pgtest psql -U postgres -c "\dt"`.

---

## Simulacro automático de restauración (semanal)

Un backup que no restaura no es un backup: la tarea `ProSolutions-RestoreDrill` corre `scripts\verify-backup-restore.ps1` **domingos 04:15** y prueba la cadena completa sin tocar `prosolutions-db`.

La tarea se registra (una sola vez, PowerShell elevado, idempotente) con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-restore-drill-task.ps1
# Opciones: -At "04:15"   -DayOfWeek Sunday   -UseSystem   -BackupRoot "E:\Backups\prosolutions"
```

Toda la salida del simulacro queda en `D:\Backups\prosolutions\restore-drill-task.log`. Qué hace el script:

1. Toma el `.pgdump` más reciente de `D:\Backups\prosolutions\db` (o `-DumpFile` explícito).
2. Valida el TOC con `pg_restore --list` en contenedor efímero.
3. Levanta `prosolutions-restore-drill` (`postgres:16-alpine`, efímero) y restaura con `pg_restore --no-owner --no-privileges`.
4. Cuenta filas de las tablas críticas — la lista única `scripts/critical-tables.json` (la misma que verifica el preflight de arranque del contenedor, `scripts/docker-preflight.mjs`): exige que existan todas, `Business ≥ 1` y total `≥ 100`.
5. Escribe `last-restore-drill.json` y lo copia al volumen `prosolutions_payment_proofs` como `.restore-drill.json`.

Correr a mano:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup-restore.ps1
Start-ScheduledTask -TaskName "ProSolutions-RestoreDrill"
Get-Content D:\Backups\prosolutions\last-restore-drill.json   # ok:true + tables{...} + tocEntries
```

Sale con código 1 si cualquier paso falla — misma convención que el backup diario para monitoreo.

---

## Monitoreo (ya integrado en la app)

El estado del backup **ya se expone dentro de la aplicación** — no hace falta monitor externo:

- `/api/admin/backup-status` lee `last-backup-status.json` y el banner del panel admin muestra "backup OK hace X" / "backup atrasado" / "backup falló", junto al estado del restore-drill.
- `getPlatformHealth` lo incluye y `/platform/health` (consola de operador) muestra las líneas de backup y simulacro.

El criterio de frescura que usan ambos es el mismo: `ok:true` y `finishedAt` dentro de las últimas ~30 h. Si el backup falla, el script sale con código 1 y deja `"ok":false` + el campo `error` por artefacto — eso basta para que el banner lo muestre al entrar al panel.

Un chequeo de frescura manual equivalente (por ejemplo en una segunda tarea diaria a las 08:00 con alerta propia):

```powershell
$j = Get-Content D:\Backups\prosolutions\last-backup-status.json | ConvertFrom-Json
$fresh = $j.ok -and ((Get-Date) - [datetime]$j.finishedAt).TotalHours -lt 30
if (-not $fresh) { Write-Host "BACKUP ATRASADO O FALLIDO: $($j.error)" }
```
