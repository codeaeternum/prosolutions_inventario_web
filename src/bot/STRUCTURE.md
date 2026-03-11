# Estructura del Bot — ProSolutions Telegram

El bot vive en `src/bot/`. Este documento describe la estructura actual y la dirección para modularizar.

**Cómo funciona el bot (flujos, sesiones, integración con la web):** ver **[BOT-FUNCIONAMIENTO.md](./BOT-FUNCIONAMIENTO.md)**.

## Estado actual

- **`index.ts`**: Punto de entrada único; registra comandos, middlewares, cron y toda la lógica. ~2600 líneas (start, help, miid, cancelar y middleware extraídos).
- **`lib/prisma.ts`**: Cliente Prisma singleton para el bot (`getPrisma()`).
- **`lib/notify.ts`**: Helpers `isAdmin(telegramId)` y `notifyAdmins(bot, message)`.
- **`lib/guards.ts`**: `requireAdmin(ctx)` y `requirePrisma(ctx)` para comandos que exigen admin o BD (evitan repetir el mismo mensaje).
- **`lib/utils.ts`**: `generateQRCode()`.
- **`middlewares/logger.ts`**: Middleware de logging.
- **`commands/start.ts`**, **`commands/help.ts`**, **`commands/miid.ts`**, **`commands/cancelar.ts`**: Comandos registrados desde index. `/cancelar` limpia también las sesiones de eliminar, venta, carrito, qr y ajustes.

**Convenciones:** Los comandos que requieren admin usan `requireAdmin(ctx)`; los que requieren BD usan `requirePrisma(ctx)`. Todas las respuestas al usuario usan `await ctx.reply(...)` para asegurar envío y propagación de errores.

## Estructura objetivo (esbozo)

```
src/bot/
├── index.ts              # Entrada: crea bot, registra comandos y middlewares
├── STRUCTURE.md           # Este archivo
├── lib/
│   ├── prisma.ts          # getPrisma()
│   └── notify.ts          # isAdmin(), notifyAdmins()
├── commands/             # (futuro) Comandos por archivo
│   ├── start.ts
│   ├── search.ts
│   ├── reserve.ts
│   └── ...
├── handlers/              # (futuro) Flujos largos o por contexto
│   ├── registration.ts
│   ├── reservation.ts
│   └── ...
├── middlewares/           # (futuro) Logging, sesión, etc.
│   └── logger.ts
└── lib/
    └── utils.ts           # (futuro) generateQRCode(), formateo, etc.
```

## Cómo migrar poco a poco

1. **Comandos**: Sacar cada `bot.command('xxx', ...)` a `commands/xxx.ts` que exporte una función `register(bot: Telegraf)` y en `index.ts` hacer `import { register as registerSearch } from './commands/search'; registerSearch(bot);`
2. **Handlers**: Flujos que usan escenas o muchos pasos (registro, reserva) a `handlers/nombre.ts` y registrar en index.
3. **Utilidades**: `generateQRCode` y otras funciones puras a `lib/utils.ts`.
4. **Estados**: Si se usan máquinas de estado (scenes), agrupar en `handlers/` o `scenes/`.

## Dependencias entre módulos

- `lib/prisma` no depende del bot.
- `lib/notify` depende de `lib/prisma` y recibe `bot` por parámetro.
- Los comandos/handlers futuros importarán `lib/prisma`, `lib/notify` y opcionalmente `lib/utils`; el `bot` se inyecta desde `index.ts`.

## Notas

- El bot se ejecuta con `tsx` (ver `package.json`: `bot:dev`, `bot:start`), por lo que ESM e imports con tipos funcionan.
- Mantener un único punto de entrada (`index.ts`) que monte todo evita duplicar la inicialización de Telegraf y Prisma.
