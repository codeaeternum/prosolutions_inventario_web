# Escritorio, acceso SSH y datos reales

Comprobación del 11 de septiembre de 2026. **SSH funciona con `ssh galindoasc-desktop`; se inspeccionó la instalación activa y se restauró una copia de sus datos en un entorno aislado.** No se modificó la base del escritorio ni se desplegó una nueva versión.

## Instalación identificada

| Elemento | Resultado observado |
|---|---|
| Equipo | GALINDOASC, Windows, Tailscale 100.106.83.19 |
| Docker Engine | 29.6.1 |
| Aplicación | `prosolutions-app`, running/healthy, puerto del host 3005 |
| Bot | `prosolutions-bot`, running, sin healthcheck; proceso vivo no prueba flujo Telegram |
| PostgreSQL | `prosolutions-db`, 16.11, running/healthy, zona UTC |
| Arquitectura de imágenes | amd64; app y bot creados el 1 de abril de 2026 |
| Proyecto Compose activo | `prosolutions`; metadatos apuntan a `/data/compose/17/docker-compose.yml` |
| Volumen activo PostgreSQL | `prosolutions_postgres_data` |
| Volumen activo archivos | `prosolutions_uploads`, compartido por aplicación y bot |
| Otros volúmenes encontrados | `prosolutions_inventario_web_postgres_data` y `prosolutions_inventario_web_uploads`; contenido y vigencia no inspeccionados |
| Memoria de una muestra | App 75.64 MiB + BD 41.75 MiB + bot 111.9 MiB ≈229.29 MiB; no es medición de picos |
| Syncthing en Windows | Proceso activo; carpeta `D:\Proyectos_Sincronizados`, sendreceive, no pausada; configuración no equivale a prueba de sincronización al día |

**PostgreSQL publica 5432 en 0.0.0.0 y :: y su contraseña coincide con el valor predeterminado del Compose.** La comprobación emitió sólo un booleano, nunca el valor de la contraseña. Esto confirma exposición a las interfaces del host; no se verificó acceso desde Internet ni todas las reglas del firewall. Prioridad inmediata: cerrar la publicación o restringirla según necesidades y rotar la credencial coordinadamente en PostgreSQL, web y bot. No se cambiaron credenciales productivas, red ni firewall durante la auditoría.

Hay dos pares de volúmenes y dos carpetas del proyecto. No borrar ni migrar uno por su nombre: la fuente identificada son los volúmenes montados por el Compose activo. No se inspeccionaron datos de otros proyectos.

Evidencias: [primera inspección](evidencias/desktop-readonly.jsonl) y [comprobación adicional](evidencias/desktop-followup.json). La primera lectura no obtuvo metadatos del bot; el seguimiento resolvió esa limitación. El archivo PowerShell conservado contiene ajustes posteriores para argumentos de Windows, por lo que no debe interpretarse como una reproducción byte por byte de la primera invocación.

## Correspondencia de versiones

- `D:\Projectos\prosolutions_inventario_web` es una copia anterior: difieren Dockerfile, package/lockfile, esquema y bot respecto de esta Mac.
- `D:\Proyectos_Sincronizados\prosolutions_inventario_web` coincide con esta Mac en los **167 archivos presentes en ambos conjuntos de src/prisma/scripts/types**. Existe un archivo adicional sólo en Mac: `src/app/uploads/[[...path]]/route.ts`.
- Los 167 archivos fuente presentes dentro de la imagen del bot también coinciden con Mac. Esto permite atribuir a ese código los hallazgos estáticos del bot; no equivale a haber ejecutado los flujos de Telegram con clientes reales.
- En la aplicación compilada se verificaron package.json y prisma/schema.prisma coincidentes. Se confirmó la presencia del Route Handler compilado de uploads en la imagen app, aunque falta su fuente en la carpeta sincronizada de Windows y la imagen bot. No se probó equivalencia binaria completa de la aplicación; las fuentes y artefactos no forman un único conjunto idéntico.
- Ambas carpetas Windows tienen metadata Git con HEAD `8f01bc5e7775a311e59dda59ab8db14bb559b641`; la copia sincronizada reportó 43 entradas modificadas y la anterior 0. La carpeta Mac no tiene `.git`. No atribuir toda la imagen productiva a ese commit ni afirmar que la auditoría local cubre todos los cambios históricos.

Las reproducciones HTTP descritas en los demás anexos se hicieron contra la copia aislada de Mac. No se ejecutaron mutaciones, payloads de escritura ni reproducciones destructivas en el escritorio.

## Configuración y superficie verificadas

La aplicación activa usa Next.js 16.1.6 y Node.js 20.20.2. Un GET anónimo al catálogo devolvió 200 e incluyó claves de costo interno, mayoreo y conteos asociados. Se guardaron sólo nombres de campos y conteos, no productos particulares. Esto confirma SEC-02 también en el escritorio.

Los dos secretos de sesión están presentes, coinciden entre sí, tienen al menos 32 caracteres y no corresponden al fallback del Compose. CRON_SECRET y token Telegram están configurados. Estas comprobaciones de presencia/longitud no certifican su entropía, custodia o funcionamiento. [Evidencia sin valores secretos](evidencias/desktop-runtime-config-check.json).

## Datos observados

| Dato | Conteo o tamaño |
|---|---:|
| Base PostgreSQL | 9,490,915 bytes, aproximadamente 9.5 MB decimales |
| Directorio PGDATA | 65,016 KiB |
| Productos / unidades | 98 / 202 |
| Productos sin existencias / negativos | 20 / 0 |
| Usuarios | 5: 2 administradores y 3 clientes |
| Reservas | 3: 1 completada y 2 canceladas |
| Movimientos de inventario | 153 |
| Movimientos de crédito | 9 |
| Cajas / movimientos de caja | 1 / 5 |
| Marcas / categorías / modelos | 18 / 22 / 302 |
| Archivos de uploads | 45 archivos, 49,891,307 bytes, aproximadamente 47.58 MiB |
| Dump comprimido de la base | 69,115 bytes |
| Archivo comprimido de uploads | 49,828,379 bytes |

Estos conteos proceden del escritorio, pero no demuestran cuáles registros corresponden a ventas reales o pruebas. Se consultaron agregados y esquema; no se incluyeron nombres, contactos, contraseñas ni imágenes particulares en los informes.

La [revisión de integridad de datos](08-datos-verificados.md) detalla las diferencias observadas de inventario y crédito. Que ningún producto tenga stock negativo ahora no invalida la sobreasignación reproducida en pruebas. Del mismo modo, restaurar fielmente una base conserva también sus inconsistencias: recuperabilidad e integridad comercial son comprobaciones diferentes.

## Copia cifrada y restauración comprobada

Se creó una copia en esta Mac, **fuera de Syncthing**:

`/Users/galindoasc/.codex/prosolutions-backups/2026-09-11-audit`

Contiene la base y uploads cifrados con AES-256-GCM, manifiesto SHA256, instrucciones y recuperador Node.js. La llave está separada en `~/.ssh/prosolutions-backup-20260911.key`, modo 600; no se copió al proyecto ni se imprimió. El directorio de respaldo está protegido con modo 700.

El dump usa el snapshot consistente de `pg_dump -Fc`. Los archivos se copiaron después con el servicio activo: **no es una captura atómica conjunta ni la copia final de un corte de migración**. No se detuvieron aplicación, bot ni escrituras en el escritorio.

La copia se descifró y restauró con `pg_restore --exit-on-error --no-owner --no-acl` y extracción del archivo de uploads en un contenedor de prueba sin red y con almacenamiento temporal en memoria:

- Restauración PostgreSQL: exit 0, sin errores.
- Extracción de archivos: exit 0, sin errores.
- **16/16 tablas** coinciden entre origen y restauración en conteo y SHA256 del contenido canónico de todas sus filas.
- **45/45 archivos** coinciden entre archivo de origen y archivos restaurados en contenido y rutas relativas mediante hashes; bytes totales iguales.
- Se comprobó autenticación del cifrado y SHA256 antes de restaurar.
- Se eliminó el contenedor temporal tras la verificación; sólo queda la copia cifrada y sus instrucciones.

Evidencias: [manifiesto sin secretos](evidencias/real-backup-manifest.json), [resultado de restauración](evidencias/real-backup-restore-check.json), [tablas](evidencias/real-restore-table-checks.json) y [archivos](evidencias/real-restore-files.json).

**Límites:** no se reconstruyó todo el servicio con web, bot, roles/permisos productivos, secretos ni dominio. No se probó recuperación WAL/PITR ni se midió un RTO de desastre. La copia y su llave se encuentran en la misma Mac; no protegen contra pérdida de esa Mac. Hace falta implantar copias externas automáticas y custodia independiente de la llave. No se verificó ningún sistema previo de respaldo: la búsqueda acotada no encontró archivos de respaldo ni tareas/servicios identificables como ProSolutions/PostgreSQL, pero puede haber herramientas externas que no se revisaron.

## Acceso SSH creado a petición del usuario

Se generó una llave Ed25519 dedicada en esta Mac, se preservó la configuración SSH existente y se añadió el alias solicitado. El usuario ejecutó el instalador de la pública en PowerShell elevado y se comprobó conexión con respuesta `GALINDOASC`.

- Privada: `~/.ssh/prosolutions_galindoasc_ed25519`, modo 600; permanece exclusivamente en esta Mac.
- Pública: `~/.ssh/prosolutions_galindoasc_ed25519.pub`.
- Huella pública de Mac: `SHA256:/in0xi5YzDT93eJQVVdU/3JUIxM285MRGUydNpO3y4U`.
- Alias: `galindoasc-desktop`, usuario `dgali`, IdentityFile dedicado, IdentitiesOnly=yes y StrictHostKeyChecking=yes.
- Huella pública del host guardada: `SHA256:wJdoWuGSNQbF9uOVJsH7GR6ToFvdeHEat6SJUjBq6MI`. Primera aceptación mediante TOFU contra el peer de Tailscale; sin comparación independiente. Cambios posteriores de identidad serán rechazados.
- Pública instalada en `C:\ProgramData\ssh\administrators_authorized_keys`; se preservaron otras llaves. En la configuración estándar Windows ese archivo es compartido por las cuentas Administrators, no limita el acceso únicamente al proyecto.
- Llave sin frase para uso no interactivo; depende de proteger esta Mac y sus permisos. No se compartieron contraseñas por chat.

El [instalador legible](acceso/instalar-llave-mac.ps1) y el [comando codificado](acceso/comando-powershell.txt) quedan como referencia; no hace falta repetirlos. Parsec mostró inicialmente el escritorio, pero después falló la captura; el usuario completó la instalación y el trabajo posterior se hizo por SSH.

## Pendiente antes del traslado

1. Conciliar las diferencias comerciales con el dueño sin borrar historia.
2. Determinar si los volúmenes alternativos contienen información que deba conservarse.
3. Corregir los fallos del núcleo y verificar la versión exacta de la aplicación que se desplegará.
4. Medir picos de recursos y generación/retención de WAL; la pequeña base actual favorece el presupuesto, pero no sustituye esas mediciones.
5. Preparar configuración/secretos/roles, copias externas automáticas, ensayo de servicio completo y corte con escritura detenida.

La inspección y el ensayo de datos están completos dentro de estos límites. La contratación, el despliegue y el corte a nube siguen pendientes.
