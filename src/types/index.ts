// ==================== ENUMS (alineados con Prisma) ====================

export type UserRole = "ADMIN" | "EMPLOYEE" | "CUSTOMER"

export type CustomerType = "TECHNICIAN" | "STORE" | "NORMAL"

export type UserStatus = "PENDING" | "APPROVED" | "REJECTED"

export type ReservationStatus =
  | "PENDING"
  | "PENDING_PAYMENT"
  | "DEPOSIT_VERIFIED"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"

export type ReservationType = "TEMPORARY" | "DEPOSIT"

// ==================== PRODUCTO ====================

export interface ProductModelRef {
  model: {
    id: string
    name: string
    brand: { name: string }
  }
}

export interface ProductCategoryRef {
  name: string
  id?: string
}

export interface Product {
  id: string
  name: string
  barcode: string | null
  retailPrice: number
  wholesalePrice: number
  stock: number
  minStock: number
  images: string[]
  category: ProductCategoryRef
  models?: ProductModelRef[]
  isUniversal?: boolean
  description?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

// ==================== USUARIO ====================

export interface User {
  id: string
  name: string
  email: string | null
  phone?: string | null
  role: UserRole
  status: UserStatus
  customerType: CustomerType
  businessName?: string | null
  requestedCustomerType?: CustomerType
  monthlyPurchaseGoal?: number | null
  totalPurchases?: number
  currentMonthPurchases?: number
  lastPurchaseReset?: string | null
  qrCode?: string | null
  telegramId?: string | null
  createdAt?: string
  updatedAt?: string
}

// ==================== RESERVA ====================

export interface ReservationProductRef {
  id: string
  name: string
  images: string[]
  category?: { name: string }
  retailPrice?: number
  wholesalePrice?: number
}

export interface ReservationUserRef {
  id: string
  name: string
  email: string | null
  phone?: string | null
  customerType: CustomerType
}

export interface Reservation {
  id: string
  qrCode?: string
  quantity: number
  totalPrice: number
  depositAmount: number | null
  depositPaid: boolean
  type: ReservationType
  status: ReservationStatus | string
  paymentProofUrl: string | null
  paymentMethod: string | null
  adminNotes?: string | null
  expiresAt: string
  createdAt: string
  updatedAt?: string
  product: ReservationProductRef
  user: ReservationUserRef
}

// ==================== RESPUESTAS API PAGINADAS ====================

/**
 * Respuesta genérica paginada de API.
 * Algunos endpoints usan `data` o `items`, otros `products`/`users`/`reservations`;
 * esta interfaz cubre el formato estándar con data/items.
 */
export interface ApiPaginatedResponse<T> {
  /** Lista de ítems (alias usado en algunas APIs) */
  data?: T[]
  /** Lista de ítems (alias alternativo) */
  items?: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Respuesta de API de productos paginados (formato específico con `products`).
 */
export interface ApiProductsResponse {
  products: Product[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Respuesta de API de usuarios paginados (formato con `data` anidado en algunos casos).
 */
export interface ApiUsersResponse {
  data?: User[]
  users?: User[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Respuesta de API de reservas paginadas.
 */
export interface ApiReservationsResponse {
  data?: Reservation[]
  reservations?: Reservation[]
  total: number
  page: number
  limit: number
  totalPages: number
}
