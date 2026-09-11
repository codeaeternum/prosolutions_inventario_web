# Guion breve para probar ProSolutions Taller

Objetivo: observar si el dueño puede trabajar cómodamente. Duración orientativa: 20–30 minutos. Usar clientes y equipos ficticios. El piloto aún no reemplaza la operación real ni registra pagos/refacciones de reparaciones.

## Recorrido

1. **Encontrar trabajo pendiente.** Filtrar por Local Centro y “En diagnóstico”. Abrir la consola que no carga. Explicar qué información falta para trabajar.
2. **Recibir un equipo nuevo.** Elegir cualquier electrónico que reciban de verdad; poner nombre y teléfono ficticios, falla, accesorios y estado físico. Si un campo no sirve, anotarlo.
3. **Asignar responsable.** Abrir “Siguiente acción”, asignar al otro técnico y explicar qué información necesitaría ver él.
4. **Preparar presupuesto.** Cambiar a diagnóstico, registrar el hallazgo y un importe. Revisar si el texto sería claro para el cliente.
5. **Registrar autorización.** Indicar quién autorizó y por qué medio. Comprobar que conserva el importe autorizado. No se envía ningún mensaje al cliente.
6. **Mover el equipo.** Registrar llegada a la otra sucursal sólo después de simular su recepción física. Verificar que la sucursal original permanece en la ficha.
7. **Terminar reparación.** Pasar a revisión final, registrar las pruebas hechas y marcar listo. Registrar a quién se entrega. El piloto no interpreta esto como un cobro.
8. **Probar dos ventanas.** Abrir la misma orden en ambas. Cambiar una; intentar guardar desde la otra. Debe pedir actualizar antes de sobrescribir.
9. **Volver a encontrar el caso.** Buscar por folio, teléfono, modelo o serie; filtrar por etapa y local.
10. **Comparar con TallerControl.** Repetir mentalmente dos tareas frecuentes y señalar en cuál hubo menos pasos, cuál fue confusa y cuál falta por completo.

## Dos situaciones que también deben probarse

Hacerlas con órdenes ficticias separadas del recorrido anterior. Reservar 5–10 minutos adicionales y anotar los pasos que requirieron ayuda.

1. **El cliente rechaza el presupuesto.** Abrir una orden en “Esperando autorización”, elegir “Cambiar etapa” y “Cancelado”. Registrar quién rechazó, por qué medio y el motivo. Comprobar que conserva el presupuesto y el historial, que no aparece como autorización ni como cobro y que la orden sigue localizable al filtrar “Cancelado”. El piloto no modela todavía la devolución física de un equipo cancelado: preguntar cómo la registran hoy y qué constancia necesitan.
2. **El presupuesto cambia antes de autorizarse.** En otra orden pendiente, registrar un presupuesto nuevo con un importe distinto y explicar el cambio. Verificar que el historial conserva ambos importes y que sigue “Sin autorización registrada”. Abrir “Registrar autorización del cliente”: una nota o un diagnóstico no deben aparecer como texto de autorización. Registrar una autorización ficticia del importe nuevo y comprobar que sólo ese importe figura como autorizado. Si el cambio ocurre después de empezar a reparar, anotar el recorrido que esperan: la recotización posterior a la autorización no forma parte de este piloto.

## Cómo recoger comentarios

| Tarea | ¿Se pudo hacer sin ayuda? | Dónde se atoró / qué esperaba | Importancia: impide trabajar, molesta o sería útil |
|---|---|---|---|
| Recepción | | | |
| Diagnóstico / presupuesto | | | |
| Autorización | | | |
| Técnico / traslado | | | |
| Revisión / entrega | | | |
| Buscar / dar seguimiento | | | |

Pedir ejemplos concretos: “al recibir una consola necesito registrar dos controles”, “me hace volver a escribir el teléfono”, “no sé quién tiene este equipo”. Una preferencia de color es distinta de una función que impide atender al cliente.

## Qué todavía no debe evaluar como terminado

Los accesos separados de secretarias/técnicos, fotografías, firma, tickets, garantías, refacciones por local, cobros de reparaciones, portal del cliente y migración de TallerControl están en el plan. En el piloto actual las personas que aparecen como responsables de ejemplo no tienen una cuenta habilitada para entrar como técnico.

## Puesta en marcha reproducible

El archivo `docker-compose.pilot.yml` crea un proyecto independiente `prosolutions-pilot` con tres volúmenes propios. El puerto predeterminado es sólo `127.0.0.1:3316`. La base de datos no publica un puerto y no se inicia el bot.

Guardar las variables `PILOT_DB_PASSWORD`, `PILOT_AUTH_SECRET` y `PILOT_ADMIN_PASSWORD` en un archivo privado fuera de Syncthing. La contraseña del administrador debe tener al menos 20 caracteres. No copiar variables de producción al piloto.

```sh
docker compose --env-file /ruta/privada/pilot.env -f docker-compose.pilot.yml build app migrate
docker compose --env-file /ruta/privada/pilot.env -f docker-compose.pilot.yml up -d db
docker compose --env-file /ruta/privada/pilot.env -f docker-compose.pilot.yml --profile setup run --rm migrate
docker compose --env-file /ruta/privada/pilot.env -f docker-compose.pilot.yml --profile setup run --rm migrate npx tsx scripts/seed-workshop-pilot.ts
docker compose --env-file /ruta/privada/pilot.env -f docker-compose.pilot.yml up -d app
```

La carga ficticia rechaza una base que ya tenga usuarios, productos o sucursales. Se ejecuta una sola vez, después de las migraciones. Abrir `/login`, entrar con `piloto@prosolutions.local` y la contraseña guardada en el archivo privado; abrir `/admin/taller`.

Para probar desde otro equipo, configurar una dirección de acceso adecuada y autenticada. No publicar el piloto ni reutilizar su contraseña sin revisar la exposición. Detenerlo con `docker compose ... stop` conserva los datos de prueba; no usar opciones que borren volúmenes de la instalación real.
