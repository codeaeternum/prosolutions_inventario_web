# Estado de npm audit

Resumen del último `npm audit` (2026-11-08, `npm audit --audit-level=high` local) y acciones tomadas o pendientes.

## Acciones realizadas

- **Next.js**: Actualizado a `16.4.5` (parche que corrige DoS en Image Optimizer, deserialización RSC y consumo de memoria en PPR). Las vulnerabilidades en el rango 15.6–16.1.4 quedan cubiertas con esta versión.
- **Aviso PWA**: Implementado banner de “Nueva versión disponible – Recargar” cuando el service worker toma control de una nueva versión (`PwaUpdateBanner`).
- **next-pwa**: Ya no es dependencia del proyecto (la PWA se resolvió con service worker propio); sus advisories vía workbox dejaron de aplicar.
- **CI**: `npm audit --audit-level=high` corre como paso informativo en `.github/workflows/ci.yml` (no rompe el pipeline, deja el aviso visible en cada corrida).

## Vulnerabilidades pendientes (resumen al 2026-11-08)

`20 vulnerabilities (2 low, 14 moderate, 4 high)` en dependencias directas e indirectas. No se ha ejecutado `npm audit fix --force` para evitar cambios con impacto (major) sin revisión.

| Origen | Severidad | Notas |
|--------|-----------|--------|
| **undici** | High | Varios advisories (DoS, cache poisoning, TLS). Transitiva; `npm audit fix` la resuelve sin breaking. |
| **body-parser** | High | DoS por trailing bytes en cuerpo comprimido. Transitiva; fix sin breaking. |
| **systeminformation** | High | Path traversal / prototype pollution / command injection (Windows). Transitiva; fix sin breaking. |
| **vite** (vía vitest) | High | Advisories de dev-server (launch-editor, fs.allow). Solo afecta tooling de desarrollo; fix sale del rango declarado (requiere `--force`). |
| **@vitest/mocker** (vía vitest) | Moderate | Code injection por registro manual de mocks. Dev only. |
| **deepmerge / ts-morph** (vía shadcn CLI) | Moderate | Prototype poisoning. Solo en la CLI de scaffolding, no en runtime. |
| **ip-address, minimatch** | Moderate | DoS; transitivas de tooling (eslint/typescript-eslint). |

## Recomendaciones

1. Ejecutar `npm audit` y `npm audit fix` (sin `--force`) de forma periódica — con eso salen hoy las tres transitivas `high` sin breaking (undici, body-parser, systeminformation).
2. Revisar uso de **xlsx**: se instala como tarball desde el CDN de SheetJS (no del registry), así que `npm audit` no levanta advisories sobre ella; mantener la política de usarla solo con datos controlados por el backend y planear reemplazo a mediano plazo.
3. Dependencias solo de **desarrollo** (vitest/vite, shadcn, eslint): menor impacto en producción; actualizar cuando sea posible sin romper flujos (p. ej. `vitest@5.1.x` corrige el advisory de @vitest/mocker).

## Comandos útiles

```bash
npm audit
npm audit --audit-level=high
npm audit fix
npm audit fix --force   # Solo tras revisar breaking changes
```
