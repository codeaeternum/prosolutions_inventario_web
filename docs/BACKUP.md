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
  "finishedAt": "2026-01-15T03:31:12"
}
```

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
4. Cuenta filas de tablas críticas (`Business`, `WorkshopBranch`, `User`, `Product`, `ProductModel`, `Sale`, `RepairOrder`, `Payment`, `InventoryMovement`, `AuditEvent`): exige que existan, `Business ≥ 1` y total `≥ 100`.
5. Escribe `last-restore-drill.json` y lo copia al volumen `prosolutions_payment_proofs` como `.restore-drill.json`.

Correr a mano:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-backup-restore.ps1
Start-ScheduledTask -TaskName "ProSolutions-RestoreDrill"
Get-Content D:\Backups\prosolutions\last-restore-drill.json   # ok:true + tables{...} + tocEntries
```

Sale con código 1 si cualquier paso falla — misma convención que el backup diario para monitoreo.

---

## Monitoreo (Uptime Kuma corre en el mismo N5, puerto 3001)

El JSON está pensado para que Kuma (o la app) lo exponga como chequeo. Dos opciones:

**Opción A — monitor Push (recomendada, sin exponer nada).** Crear en Kuma un monitor tipo *Push* y usar el parámetro `-KumaPushUrl` del propio backup — al terminar hace `GET <url>?status=up|down&msg=backup&ping=` según el resultado de la corrida:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-n5.ps1 -KumaPushUrl "http://localhost:3001/api/push/<TOKEN>"
# Para la tarea programada: registrar con -ArgumentList extra o editar la acción
# en taskschd.msc para añadir: -KumaPushUrl "http://localhost:3001/api/push/<TOKEN>"
```

Alternativa equivalente: añadir al final del flujo un pequeño chequeo de frescura, p. ej. una segunda tarea diaria a las 08:00 o estas líneas en un wrapper:

```powershell
$j = Get-Content D:\Backups\prosolutions\last-backup-status.json | ConvertFrom-Json
$fresh = $j.ok -and ((Get-Date) - [datetime]$j.finishedAt).TotalHours -lt 30
$s = if ($fresh) { "up" } else { "down" }
Invoke-RestMethod "http://localhost:3001/api/push/<TOKEN>?status=$s&msg=backup&ping="
```

**Opción B — HTTP + keyword.** Servir `D:\Backups\prosolutions\` con cualquier estático (o copiar el JSON a una ruta que ya sirva la app) y crear en Kuma un monitor HTTP con keyword `"ok":true`. El contenido no incluye secretos.

Si el backup falla, el script sale con código 1 y `"ok":false` + el campo `error` por artefacto — suficiente para alertar.
