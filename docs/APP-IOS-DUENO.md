# App iOS para el dueño del negocio — ProSolutions

**Recomendación:** Para escanear QR de reservas y usar las funciones de admin desde el móvil, basta con la **PWA**: instalar la web en la pantalla de inicio del iPhone y usar **“Escanear reserva”** (y ventas, inventario, etc.). Ver [PWA-DUENO.md](./PWA-DUENO.md) para instrucciones.

Si más adelante quieres una app nativa en la App Store, estas son las opciones.

---

## 1. Lo que ya tienes

- **Web admin** (Next.js): dashboard, ventas, reservas, inventario, reportes, configuración. Funciona en el **navegador del iPhone** (Safari).
- **Bot de Telegram**: ventas rápidas, carrito, reservas pendientes, notificaciones. El dueño puede usar **Telegram en iOS** como “app” del negocio sin desarrollar nada nuevo.

Con eso, el dueño **ya puede** gestionar el negocio desde el móvil (web en Safari o Telegram). Una app iOS sería un **complemento** para mejor UX y/o notificaciones nativas.

---

## 2. Opciones para una “app” en iOS

### A) PWA (Progressive Web App) — la más rápida

- **Qué es**: Tu web actual se puede “instalar” en la pantalla de inicio del iPhone (Add to Home Screen). Next.js ya tiene soporte PWA (next-pwa en el proyecto).
- **Ventajas**: Sin App Store, sin mantener un proyecto iOS aparte. Reutiliza 100% la web. Notificaciones push en iOS 16.4+ (con configuración).
- **Limitaciones**: Las notificaciones y el “modo app” en iOS son más limitados que en una app nativa. Safari impone algunas restricciones.
- **Esfuerzo**: Revisar/activar PWA en tu Next.js (manifest, service worker, ícono), probar “Añadir a la pantalla de inicio” y opcionalmente push.

**Conclusión**: Si solo quieres “icono en el iPhone que abre el admin”, la PWA es la opción más barata y rápida.

---

### B) App nativa (Swift / SwiftUI)

- **Qué es**: App en Xcode, publicada en la App Store, que consume tu API (Next.js) para login, reservas, ventas, reportes, etc.
- **Ventajas**: UX nativa, notificaciones push completas, mejor sensación de “app del negocio”, posible uso offline limitado (cachear datos).
- **Desventajas**: Mantener dos codebases (web + iOS). Necesitas cuenta de desarrollador Apple (99 USD/año) y pasar revisión de App Store. Desarrollo y actualizaciones más costosos.
- **Esfuerzo**: Alto. Diseño de pantallas, auth (JWT/NextAuth), llamadas a `/api/*`, listados, formularios, notificaciones. Tiempo estimado: varias semanas a meses según alcance.

**Conclusión**: Tiene sentido si quieres una app “de verdad” en la App Store y estás dispuesto a invertir en desarrollo y mantenimiento.

---

### C) Híbrido (React Native, Expo, Capacitor)

- **Qué es**: Un solo código (React/TypeScript) que compila a iOS (y Android). Puede reutilizar lógica o incluso pantallas similares a la web.
- **Ventajas**: Un solo equipo/lenguaje. Capacitor puede “envolver” tu web actual en un WebView y empaquetarla como app (rápido para un MVP). React Native/Expo da experiencia más nativa.
- **Desventajas**: Capacitor = básicamente tu web en una app (similar a PWA pero con binario en App Store). React Native/Expo = nuevo proyecto que consume tu API, no reutiliza la UI de Next.js tal cual.
- **Esfuerzo**: Capacitor (envolver web): bajo-medio. React Native/Expo (app nueva): medio-alto.

**Conclusión**: Si más adelante quieres también Android, un proyecto React Native/Expo que consuma tu API es una opción equilibrada. Para “solo iOS y rápido”, Capacitor o PWA son más prácticos.

---

## 3. Recomendación práctica

| Objetivo | Opción recomendada |
|----------|---------------------|
| Icono en el iPhone y abrir el admin rápido | **PWA** (revisar next-pwa y “Añadir a pantalla de inicio”) |
| Notificaciones push en el móvil sin App Store | **PWA** + Web Push (ya tienes VAPID en el proyecto) o **Telegram** para avisos |
| App en la App Store, experiencia nativa | **App nativa (Swift)** o **React Native/Expo** consumiendo tu API |
| Una app para iOS y Android con un solo código | **React Native / Expo** |

Para el **dueño del negocio** que ya usa Telegram y la web:

1. **Corto plazo**: Usar la **web en Safari** + “Añadir a pantalla de inicio” (PWA si está bien configurada) y **Telegram** para ventas rápidas y avisos. Cero desarrollo extra.
2. **Si pide “una app en el iPhone”**: Revisar que la PWA esté bien (manifest, ícono, que se pueda instalar). Eso ya es “una app” para muchos usuarios.
3. **Si realmente quiere una app en la App Store**: Planificar un proyecto iOS (nativo o React Native) que use tus mismas APIs; el backend (Next.js + Prisma) ya está listo para eso.

---

## 4. APIs listas para una app móvil

Tu backend ya expone lo que una app del dueño necesitaría:

- **Auth**: `POST /api/auth/callback/credentials` (login). Sesión JWT/cookies o token para móvil.
- **Reservas**: `GET/POST /api/reservations`, `PATCH/DELETE /api/reservations/[id]`.
- **Productos / búsqueda**: `GET /api/products`, `GET /api/search/pos` (para ventas rápidas).
- **Inventario**: `GET/POST /api/inventory` (movimientos).
- **Reportes**: `GET /api/reports`.
- **Configuración**: `GET/PUT /api/settings`.

Para una app nativa o React Native solo haría falta:

- Login (email/contraseña → token o sesión).
- Llamadas HTTP a esas rutas (con el mismo rol ADMIN/EMPLOYEE que ya tienes).
- Opcional: refresh token o flujo específico para móvil si no quieres depender de cookies.

**Resumen**: Sí se puede hacer una app iOS para el dueño. La opción más rápida y barata es mejorar la PWA y usar Telegram. Si quieres app en la App Store, tu API ya está preparada para conectar una app nativa o React Native.
