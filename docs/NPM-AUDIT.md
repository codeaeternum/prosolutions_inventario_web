# Estado de npm audit

Resumen del último `npm audit` y acciones tomadas o pendientes.

## Acciones realizadas

- **Next.js**: Actualizado a `16.1.6` (parche que corrige DoS en Image Optimizer, deserialización RSC y consumo de memoria en PPR). Las vulnerabilidades en el rango 15.6–16.1.4 quedan cubiertas con esta versión.
- **Aviso PWA**: Implementado banner de “Nueva versión disponible – Recargar” cuando el service worker toma control de una nueva versión (`PwaUpdateBanner`).

## Vulnerabilidades pendientes (resumen)

Tras actualizar Next, siguen apareciendo avisos en dependencias directas e indirectas. No se ha ejecutado `npm audit fix --force` para evitar cambios con impacto (major) sin revisión.

| Origen | Severidad | Notas |
|--------|-----------|--------|
| **next-pwa** | High | Depende de workbox-webpack-plugin / workbox-build (serialize-javascript, etc.). Fix sugerido: bajar a 2.0.2 (major down). Valorar migrar a otra solución PWA (ej. next-pwa oficial o Workbox manual). |
| **prisma** | High | Vía @prisma/dev (hono, @hono/node-server). Entorno de desarrollo; no afecta al cliente Prisma en producción. Fix sugerido implica bajar major. |
| **xlsx** | High | Prototype pollution y ReDoS. No hay fix en la rama actual; valorar actualizar o sustituir por otra lib de Excel. |
| **vitest** | Moderate | Vía vite, esbuild (dev only). Fix en major 4.x. |
| Otras (lodash, minimatch, ajv, etc.) | Moderate | Transitives de build y dev. `npm audit fix` puede resolver algunas sin breaking. |

## Recomendaciones

1. Ejecutar `npm audit` y `npm audit fix` (sin `--force`) de forma periódica y revisar los cambios.
2. Revisar uso de **xlsx**: si solo se usa para exportar datos controlados por el backend, el riesgo puede ser acotado; en cualquier caso, planear actualización o reemplazo.
3. **next-pwa**: Si se mantiene, seguir avisos de seguridad; a medio plazo valorar alternativas (PWA en Next.js 15+ o Workbox manual).
4. Dependencias solo de **desarrollo** (prisma CLI, vitest, vite): menor impacto en producción; actualizar cuando sea posible sin romper flujos.

## Comandos útiles

```bash
npm audit
npm audit fix
npm audit fix --force   # Solo tras revisar breaking changes
```
