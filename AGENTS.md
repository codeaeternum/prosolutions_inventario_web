<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Observabilidad

- `x-request-id` lo genera/propaga `src/proxy.ts` (request upstream y response); en route handlers léelo con `(await headers()).get("x-request-id")`, no inventes otro mecanismo de correlación.
- Los fallos de negocio se loguean UNA línea JSON (`event:"business_failure"`) desde `businessFailure` en `src/lib/domain/http.ts` — no añadas `console.error` sueltos en catch de APIs ni loguees PII/secretos (mensaje recortado a 200 chars).
