# Estado de npm audit

Resumen del último `npm audit` local (**2026-11-25**) y acciones tomadas o pendientes.

## Acciones realizadas

- **Next.js**: ya está en `16.4.x` (línea parcheada frente a los advisories previos de Image Optimizer/RSC/PPR).
- **next-pwa**: ya no es dependencia del proyecto (PWA con service worker propio); sus advisories vía workbox no aplican.
- **2026-11-25 — `npm audit fix` (sin `--force`)**: actualizó la cadena dev `typescript-eslint`/`@typescript-eslint/*` de `8.70.0` a `8.74.0` y dependencias auxiliares (`ignore`, minimatch resuelto en esa cadena). Esto eliminó los 6 advisories moderados de `@typescript-eslint/*`/`typescript-eslint` por `minimatch`.
- **CI**: `npm audit --audit-level=high` corre como paso informativo en `.github/workflows/ci.yml` (no rompe el pipeline, deja el aviso visible en cada corrida).

## Estado actual (2026-11-25)

`7 vulnerabilities (4 moderate, 3 high)` después del fix no-breaking.

| Origen | Severidad | Estado / decisión |
|--------|-----------|-------------------|
| **effect → @prisma/config → prisma 7.10.1** | High (ReDoS en `Schema.TemplateLiteral`) | Pendiente. `npm audit fix --force` propondría **bajar a prisma 6.12.0**, un downgrade major incompatible con el pin actual Prisma 7; no se aplica. Revisar cuando Prisma publique una línea 7.x con `effect` corregido. Impacto acotado a CLI/tooling de Prisma, no al runtime web. |
| **minimatch → @ts-morph/common → ts-morph → shadcn** | Moderate (DoS por globparts amplification) | Pendiente. El fix automático propone **bajar shadcn a 1.0.0**, breaking/no deseado; no se aplica. Impacto acotado a la CLI de scaffolding `shadcn` en desarrollo, no al runtime de producción. |

Ya no aparecen los advisories previos de `typescript-eslint` ni los `high` antiguos de `undici`, `body-parser` o `systeminformation` en el árbol actual.

## Política operativa

1. Ejecutar `npm audit` periódicamente y `npm audit fix` **sin `--force`** cuando solo produzca updates semver compatibles.
2. No usar `npm audit fix --force` sin revisión: hoy sus dos “fixes” son downgrades/majors (`prisma@6.12.0`, `shadcn@1.0.0`) y no son aceptables como cambio automático.
3. **xlsx** se instala como tarball desde el CDN de SheetJS, así que `npm audit` no levanta advisories sobre ella; mantener la política de usarla solo con datos controlados por backend y planear reemplazo a mediano plazo.
4. Las vulnerabilidades restantes son de dependencias de desarrollo/CLI. No hay evidencia de exposición directa en el runtime Next.js de producción, pero conviene actualizar cuando exista una línea compatible.

## Comandos útiles

```bash
npm audit
npm audit --audit-level=high
npm audit fix          # Solo fixes semver-compatibles
npm audit fix --force  # NO ejecutar sin revisar breaking changes/downgrades
```
