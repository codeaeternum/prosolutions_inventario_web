# Pro-Solutions Inventario Web

Sistema de inventario y catálogo para refacciones de celulares.

---

## 🔐 Credenciales

### Admin
- **Email:** `admin@prosolutions.com`
- **Contraseña:** `admin123`

### Base de Datos (PostgreSQL)
- **Host:** `localhost`
- **Puerto:** `5432`
- **Base de datos:** `prosolutions_db`
- **Usuario:** `prosolutions`
- **Contraseña:** `prosolutions123`
- **URL:** `postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db`

---

## 🚀 Comandos

### Desarrollo Local

```bash
# Iniciar todo (Docker + servidor)
./deploy-local.sh up

# Solo base de datos
./deploy-local.sh db

# Ejecutar seed (datos de prueba)
./deploy-local.sh seed

# Reiniciar todo
./deploy-local.sh reset

# Detener
./deploy-local.sh down
```

### Comandos Manuales

```bash
# Servidor de desarrollo
npm run dev

# Base de datos con Docker
docker compose -f docker-compose.dev.yml up -d

# Prisma
npx prisma migrate deploy   # Aplicar migraciones (no usar db push)
npx prisma generate         # Generar cliente
npx prisma studio           # UI para ver datos
npx tsx prisma/seed.ts      # Ejecutar seed

# Build producción
npm run build
npm start
```

---

## 📁 Estructura del Proyecto

```
├── prisma/
│   ├── schema.prisma       # Modelo de base de datos
│   ├── seed.ts             # Datos iniciales
│   └── prisma.config.ts    # Configuración Prisma 7
│
├── src/
│   ├── app/
│   │   ├── (auth)/         # Páginas de autenticación
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── pending/
│   │   │
│   │   ├── admin/          # Panel de administración
│   │   │   ├── productos/
│   │   │   ├── marcas/
│   │   │   ├── modelos/
│   │   │   ├── categorias/
│   │   │   ├── usuarios/
│   │   │   └── reservas/
│   │   │
│   │   ├── api/            # APIs REST
│   │   │   ├── auth/
│   │   │   ├── products/
│   │   │   ├── brands/
│   │   │   ├── models/
│   │   │   ├── categories/
│   │   │   ├── users/
│   │   │   ├── reservations/
│   │   │   ├── settings/
│   │   │   └── search/
│   │   │
│   │   ├── mis-reservas/   # Vista cliente de reservas
│   │   └── page.tsx        # Página principal (catálogo público)
│   │
│   ├── components/
│   │   ├── ui/             # Componentes shadcn/ui
│   │   └── admin/          # Sidebar, Header admin
│   │
│   └── lib/
│       ├── auth.ts         # NextAuth configuración
│       ├── auth.config.ts  # Config Edge-compatible
│       ├── prisma.ts       # Cliente Prisma
│       └── utils.ts        # Utilidades (formatPrice, cn)
│
├── deploy-local.sh         # Script desarrollo local
├── deploy-n5.sh            # Script para N5 Pro
└── docker-compose.dev.yml  # PostgreSQL desarrollo
```

---

## 👥 Roles de Usuario

| Rol | Descripción | Permisos |
|-----|-------------|----------|
| **ADMIN** | Administrador | Acceso total, gestión de usuarios, productos, reservas |
| **CUSTOMER** | Cliente | Ver catálogo, hacer reservas |

### Estados de Usuario
- **PENDING**: Esperando aprobación
- **APPROVED**: Cuenta activa
- **REJECTED**: Cuenta rechazada

### Tipos de Cliente
- **RETAIL**: Menudeo (precio normal)
- **WHOLESALE**: Mayoreo (precio especial)

---

## 📦 Sistema de Reservas

### Tipos de Reserva

1. **TEMPORARY** (Temporal)
   - Sin pago requerido
   - Expira en X minutos (configurable, default: 30 min)
   - Cliente debe pasar a recoger antes de que expire

2. **DEPOSIT** (Con Depósito)
   - Requiere 50% de anticipo
   - Cliente sube foto del comprobante (transferencia/OXXO)
   - Admin verifica el pago
   - Una vez verificado, tiene X horas para recoger (default: 48h)

### Estados de Reserva

| Estado | Descripción |
|--------|-------------|
| PENDING | Esperando acción |
| DEPOSIT_VERIFIED | Depósito verificado por admin |
| APPROVED | Lista para recoger |
| REJECTED | Rechazada por admin |
| COMPLETED | Entregada al cliente |
| CANCELLED | Cancelada |
| EXPIRED | Expirada automáticamente |

### Configuración (Admin)
- Minutos de reserva temporal
- Porcentaje de depósito
- Horas para recoger después de verificar
- Horas para verificar depósito

---

## 🔧 Tecnologías

- **Framework:** Next.js 16.1.4 (App Router, Turbopack)
- **Base de datos:** PostgreSQL 16
- **ORM:** Prisma 7.2.0
- **Autenticación:** NextAuth v5 (Auth.js)
- **UI:** Tailwind CSS + shadcn/ui
- **Iconos:** Lucide React
- **PWA:** next-pwa

---

## 📱 Características

### Catálogo Público
- Muestra productos con `isPublic: true`
- Precio visible según `hidePrice`:
  - `false`: Precio visible para todos
  - `true`: Precio solo para usuarios logueados/aprobados

### Búsqueda
- Por nombre de producto
- Por marca/modelo
- Por SKU/número de modelo (SM-S938B, A2894, etc.)
- Por código de barras

### Responsive
- Diseño adaptativo para:
  - Móviles (bottom navigation)
  - Tablets
  - Escritorio (sidebar lateral)

### PWA
- Instalable en dispositivos
- Manifiesto configurado

---

## 🌐 URLs

### Desarrollo
- **App:** http://localhost:3000
- **Prisma Studio:** http://localhost:5555 (`npx prisma studio`)

### Páginas Principales
- `/` - Catálogo público
- `/login` - Iniciar sesión
- `/register` - Solicitar cuenta
- `/admin` - Panel de administración
- `/admin/productos` - Gestión de productos
- `/admin/reservas` - Gestión de reservas
- `/mis-reservas` - Reservas del cliente

---

## 📝 Notas

### Prisma 7
- Archivo de configuración en raíz: `prisma.config.ts`
- No usa `url` en schema.prisma, se define en config

### Middleware
- Next.js 16 deprecó `middleware.ts`, ahora usa `proxy.ts`
- Actualmente funciona con advertencia

### Autenticación Edge
- `auth.config.ts` contiene config compatible con Edge runtime
- `auth.ts` importa config y agrega proveedores (usa Node.js)

---

## 🐛 Solución de Problemas

### Error: "The datasource property url is no longer supported"
- Prisma 7 requiere `prisma.config.ts` en la raíz del proyecto

### Error: "crypto is not defined"
- Separar auth en `auth.config.ts` (Edge) y `auth.ts` (Node.js)

### Puerto 3000 ocupado
```bash
pkill -f "next dev"
# o
lsof -i :3000 | awk 'NR>1 {print $2}' | xargs kill
```

### Reiniciar todo desde cero
```bash
./deploy-local.sh reset
```

---

*Última actualización: 20 de enero de 2026*
