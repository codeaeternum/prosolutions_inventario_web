# Módulo de Crédito — Diseño y alcance

## Objetivo

Permitir que clientes autorizados compren o reserven **a crédito**: reciben el producto y pagan después, hasta un límite asignado por el administrador.

## Conceptos

- **Límite de crédito** (`creditLimit`): monto máximo en pesos que el cliente puede deber. Si es `null`, el cliente no tiene línea de crédito.
- **Saldo deudor** (`creditBalance`): lo que el cliente debe actualmente. Aumenta con ventas/reservas a crédito y disminuye con abonos.
- **Movimiento de crédito**: cada operación que afecta el saldo (nueva deuda o pago).

## Modelo de datos

### Usuario (extensión)

- `creditLimit: Float?` — Límite en pesos; `null` = sin crédito.
- `creditBalance: Float` — Saldo deudor actual (≥ 0).

### Movimientos de crédito

- `CreditMovement`: id, userId, amount, type (DEBT | PAYMENT), referenceType (RESERVATION | SALE | MANUAL), referenceId opcional, notes, createdAt.
- **DEBT**: venta o reserva a crédito → aumenta `creditBalance`.
- **PAYMENT**: abono del cliente → disminuye `creditBalance`.

Regla: al crear un movimiento DEBT se valida `creditBalance + amount ≤ creditLimit`. Si el usuario no tiene `creditLimit`, no se permite venta a crédito.

## Flujos

### 1. Asignar crédito a un cliente (admin)

- En **Admin → Usuarios** (o perfil del cliente): campo "Límite de crédito" (pesos). Al guardar se actualiza `User.creditLimit`.
- Opcional: historial de movimientos y saldo en la ficha del usuario.

### 2. Venta / reserva a crédito

- Al registrar una **venta** (panel o bot): opción "Cobrar ahora" vs "A crédito".
- Si es "A crédito": se comprueba `creditBalance + total ≤ creditLimit`; si pasa, se crea `CreditMovement` (DEBT, referenceType SALE/RESERVATION) y se actualiza `User.creditBalance`.
- La reserva o venta queda marcada como `paymentMethod: 'CREDIT'` o similar para trazabilidad.

### 3. Abono / pago a cuenta (admin)

- En **Admin → Créditos** (o en la ficha del usuario): "Registrar abono". Se ingresa monto; se crea `CreditMovement` (PAYMENT) y se reduce `creditBalance`. Opcional: notas (ej. "Pago en efectivo", "Transferencia").

### 4. Consulta del cliente

- En **Mi perfil** o **Mis reservas**: mostrar "Saldo a pagar (crédito): $X" y, si aplica, "Límite: $Y". Enlace a historial de movimientos (opcional en v1).

## API (resumen)

- `GET /api/credit/balance` — Saldo y límite del usuario logueado (cliente).
- `GET /api/credit/movements` — Historial de movimientos (paginado) del usuario.
- `GET /api/credit/users/[id]` — Admin: saldo, límite y movimientos de un usuario.
- `PATCH /api/credit/users/[id]` — Admin: actualizar `creditLimit`.
- `POST /api/credit/payment` — Admin: registrar abono (userId, amount, notes).
- Al crear reserva o venta a crédito: reutilizar endpoints existentes añadiendo `paymentMethod: 'CREDIT'` y creando el `CreditMovement` en el mismo flujo.

## UI (resumen)

- **Admin**
  - Usuarios: campo "Límite de crédito" y saldo actual; enlace a movimientos.
  - Nueva sección **Créditos** (o dentro de Usuarios): listado de clientes con crédito, saldos y botón "Registrar abono".
- **Cliente**
  - Perfil y/o Mis reservas: saldo a pagar y límite; opcional historial.

## Consideraciones

- **Moneda**: todo en la moneda principal (pesos) para simplificar.
- **Múltiples reservas**: cada reserva a crédito suma al saldo al confirmarse; no se exige pagar reserva por reserva.
- **Límite 0**: si `creditLimit === 0`, no se permite nueva deuda (solo abonos).
- **Seguridad**: solo ADMIN (y quizá EMPLOYEE) puede asignar límites y registrar abonos; el cliente solo consulta su saldo e historial.

## Aplicar la migración

Con la base de datos en marcha:

```bash
npx prisma migrate deploy
```

O, para crear y aplicar en desarrollo:

```bash
npx prisma migrate dev --name add_credit_module
```

La migración añade las columnas `creditLimit` y `creditBalance` en `User` y la tabla `CreditMovement` con sus enums.

### Si la BD ya tiene tablas (error P3005)

Si es la primera migración en el historial de Prisma pero la base de datos **ya contenía tablas** (ej. en N5 Pro tras un despliegue previo), `migrate deploy` puede fallar con **P3005** (database schema is not empty). En ese caso:

1. **Ejecutar el SQL a mano** y **marcar la migración como aplicada** usando el script:

   **Windows (N5 Pro, PowerShell), desde la raíz del proyecto:**
   ```powershell
   .\scripts\migrate-credit-on-existing-db.ps1
   ```

   **Linux / Mac / WSL (bash):**
   ```bash
   chmod +x scripts/migrate-credit-on-existing-db.sh
   ./scripts/migrate-credit-on-existing-db.sh
   ```

2. Asegúrate de tener `DATABASE_URL` en `.env` (en el N5, si corres el script en el host, usa por ejemplo `postgresql://user:pass@localhost:5432/prosolutions_db`).

3. Verificar: `npx prisma migrate status`.
