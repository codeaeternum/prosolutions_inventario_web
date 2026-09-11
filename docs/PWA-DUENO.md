# PWA para el dueño — Escanear QR y usar desde el móvil

La web ya funciona como **PWA**: el dueño puede instalarla en el iPhone (o Android) y usarla como una app, **incluido el escaneo de QR de reservas** y el resto de funciones del admin.

---

## 1. Instalar la PWA en el iPhone

1. Abre **Safari** y entra a tu sitio (ej. `https://prosolutions.ascnex.com`).
2. Inicia sesión como admin.
3. Pulsa el botón **Compartir** (cuadrado con flecha hacia arriba).
4. Baja y elige **“Añadir a la pantalla de inicio”**.
5. Confirma el nombre (ej. “Pro-Solutions”) y **Añadir**.

Quedará un icono en la pantalla de inicio. Al abrirlo, la web se abre a pantalla completa (sin barra de Safari), como una app.

---

## 2. Escanear QR de reservas

- En el menú del admin (Operaciones) entra a **“Escanear reserva”**.
- Permite el acceso a la **cámara** cuando el navegador lo pida (solo la primera vez).
- Apunta al QR que enseñe el cliente (el que recibe por Telegram o en la web al reservar).
- Al detectar el código irás directo a la pantalla de **verificación**: ves datos de la reserva y puedes marcar **“Marcar como entregado”**.

Los QR del **bot de Telegram** (reservation id) y los de la **web** (id o qrCode) son válidos.

---

## 3. Otras funciones desde la PWA

Desde la misma PWA el dueño puede:

- **Ventas**: escanear códigos de barras de productos o buscar y agregar al carrito.
- **Inventario**: ajustes de stock y escaneo de productos.
- **Reservas**: lista de reservas y **Escanear reserva** para verificar por QR.
- **Productos**: listado, nuevo, editar, escanear código de barras.
- **Reportes, configuración**, etc.

Todo lo que funciona en el navegador funciona en la PWA instalada.

---

## 4. Cámara y permisos

- La cámara está permitida **solo para tu propio sitio** (seguridad).
- Si en el iPhone no pide permiso o da error, comprueba: **Ajustes → Safari → Cámara** (o el nombre de la PWA si aparece) y déjalo en “Preguntar” o “Permitir”.
- Es importante **usar la PWA** (icono en la pantalla de inicio), no abrir la URL desde Safari sin instalar: en modo “app” los permisos y la experiencia suelen ser más estables.

---

## 5. Iconos de la PWA

Los iconos se generan desde `public/logo.jpg`. En el proyecto ejecuta:

```bash
npm run pwa:icons
```

Esto crea `public/icons/` con los tamaños necesarios (72, 96, 128, 144, 152, 192, 384, 512 px). Si cambias el logo, vuelve a ejecutar el script.

## 6. Aviso “Instalar app”

En móvil (iPhone/Android), si la app no está instalada, se muestra un banner abajo con el enlace **“Cómo instalar”** que lleva a `/instalar` con las instrucciones. Puedes cerrarlo con “Ahora no” o la X; la elección se guarda y no se vuelve a mostrar hasta que borres datos del sitio.
