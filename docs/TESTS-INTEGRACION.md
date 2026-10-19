# Pruebas de integración con PostgreSQL real

Los `*.integration.test.ts` (65 pruebas en `src/__tests__/domain/`) corren contra una
base PostgreSQL de fixture dedicada y se saltan automáticamente si no existe.

## Levantar el fixture

```bash
docker run -d --name reficio-test-db \
  -e POSTGRES_USER=audit \
  -e POSTGRES_PASSWORD=audit-isolated-only \
  -e POSTGRES_DB=hardening \
  -p 55433:5432 postgres:16-alpine

DATABASE_URL="postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening" \
  npx prisma migrate deploy
```

La conexión está **forzada** en los tests a `127.0.0.1:55433/hardening` con usuario
`audit` — si `DATABASE_URL` apunta a otra cosa, los tests se niegan a correr
(protección para nunca borrar una base real).

## Correr las pruebas

```bash
RUN_DATABASE_TESTS=1 npx vitest run --project integration
```

- El proyecto `integration` corre **archivo por archivo** (`fileParallelism: false`)
  porque todas comparten la misma base: en paralelo chocan las transacciones
  serializables y agotan los reintentos de `operation()`.
- Cada archivo crea su propio negocio con prefijo aleatorio (`test-<uuid>`), así que
  la base persiste entre corridas sin conflicto.
- El ruido `[operation-alerts] alertSensitiveOperation falló: DATABASE_URL no está
  definida` en stderr es esperado: las alertas usan el singleton de Prisma que no
  tiene URL en el entorno de test — es best-effort y no afecta el resultado.
- Limpieza total: `docker rm -f reficio-test-db`.
