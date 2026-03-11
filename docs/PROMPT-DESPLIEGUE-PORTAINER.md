# Prompt para desplegar otra app con Portainer (como AeternaSuite)

Copia y pega el bloque siguiente cuando quieras que un asistente (IA o persona) haga **todo** el análisis y despliegue de otra aplicación usando Portainer: revisar puertos, CORS, variables de entorno, compose y ejecutar los pasos necesarios.

---

## Prompt (copiar desde la línea siguiente)

```
Necesito desplegar esta aplicación usando Portainer (y opcionalmente Docker Compose en el mismo host). Quiero que hagas todo el trabajo de análisis y despliegue, como si fuera un proyecto ya maduro tipo AeternaSuite.

**Tu rol:**
1. **Analizar el proyecto:** Revisa la estructura del repo (docker-compose, Dockerfiles, .env.example, documentación). Identifica servicios (frontend, API, base de datos, Redis, etc.), puertos que usan y variables de entorno necesarias.

2. **Revisar puertos:** Comprueba que los puertos en los archivos compose (y en la app) no entren en conflicto con servicios que ya corren en el host (por ejemplo: 3000, 3001, 5432, 6379 suelen estar ocupados). Si hace falta, propón y aplica cambios (por ejemplo web en 3010, API en 3011, Postgres en 5433, Redis en 6380) y documéntalos en un archivo PUERTOS.md o equivalente.

3. **CORS:** Si el frontend se sirve desde un dominio (ej. app.midominio.com) y la API desde otro (api.midominio.com), asegura que la API permita ese origen en CORS (orígenes permitidos, métodos, cabeceras). Si hay proxy o túnel (Cloudflare, etc.), indica que las peticiones OPTIONS (preflight) deben llegar al backend para que devuelva los headers CORS.

4. **Variables de entorno:** Lista las variables obligatorias (por ejemplo POSTGRES_PASSWORD, DATABASE_URL, API_URL, FRONTEND_URL) y opcionales. Crea o actualiza .env.example y, si el despliegue es con compose, documenta que hace falta un .env con al menos las obligatorias (por ejemplo para `docker compose --env-file .env up`).

5. **Compose para Portainer:** Ten (o crea) un docker-compose pensado para Portainer (Web editor): sin `build` si las imágenes se construyen aparte, con nombres de imagen fijos. Incluye solo los servicios que se despliegan (API, Web, Postgres, Redis, etc.) y mapeos de puertos sin conflicto.

6. **Scripts de despliegue:** Si el proyecto tiene package.json (o equivalente), añade scripts para:
   - Construir las imágenes (ej. `deploy:images`).
   - Desplegar con Docker Compose (ej. `deploy:docker`: build + `docker compose -p <nombre> -f <compose> --env-file .env up -d --force-recreate`).
   Opcional: script para redeploy vía API de Portainer si el usuario configura PORTAINER_URL y PORTAINER_API_TOKEN.

7. **Documentación:** Crea o actualiza un doc (ej. DESPLIEGUE_PORTAINER.md o docs/PORTAINER_COMO_FUNCIONA_EL_STACK.md) que explique: mismo stack al actualizar, puertos en host vs internos, cómo actualizar el YAML en Portainer, y que al decir "despliega" ejecutes build + compose (o redeploy por API).

8. **Ejecutar cuando yo lo pida:** Cuando diga "despliega" (o "despliega para verificar"), ejecuta los comandos necesarios en mi máquina (build de imágenes y docker compose up, o el flujo que hayas definido) y confirma el resultado. Si algo falla (por ejemplo falta POSTGRES_PASSWORD en .env), indícalo y corrige o documenta el paso.

**Contexto adicional (opcional):** [Ejemplos: "El proyecto está en D:\\MisApps\\mi-otra-app." / "Uso Cloudflare Tunnel: app en app.miapp.com." / "En el mismo host ya corre ProSolutions en 3005 (web) y 5432 (Postgres) — ver docs/MINISFORUM-N5-ESTADO.md en el repo de ProSolutions."]

No inventes datos sensibles; usa placeholders en .env.example. Responde en español.
```

---

## Uso

1. Abre el proyecto de la **otra app** en Cursor (o donde vayas a usar el asistente).
2. Copia todo el contenido del bloque **Prompt** de arriba (desde "Necesito desplegar" hasta "Responde en español").
3. Pégalo en el chat y, si quieres, añade en **Contexto adicional** cosas como:
   - "El proyecto está en D:\MisApps\mi-otra-app."
   - "Uso Cloudflare Tunnel: app en app.miapp.com, API en api.miapp.com."
   - "En el mismo host ya corre ProSolutions en 3005 y 5432 (ver docs/MINISFORUM-N5-ESTADO.md)."
4. Cuando el asistente haya revisado todo y definido los scripts, di **"Despliega"** o **"Despliega para verificar"** para que ejecute build + compose (o el flujo acordado).

Así el asistente hace el análisis de puertos, CORS, env y compose, y deja listo el flujo de despliegue igual que en AeternaSuite.
