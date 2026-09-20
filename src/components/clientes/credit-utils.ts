/** Tipos y etiquetas compartidos del crédito de clientes (cartera y ficha 360). */

export type CreditMovementTypeLabel = "DEBT" | "PAYMENT" | "REVERSAL"

export const creditMovementLabels: Record<CreditMovementTypeLabel, string> = {
  DEBT: "Cargo",
  PAYMENT: "Abono",
  REVERSAL: "Reversión de deuda",
}

export interface CreditMovementItem {
  id: string
  amount: number
  type: CreditMovementTypeLabel
  referenceType: string | null
  notes: string | null
  createdAt: string
}

/** Respuesta de GET /api/credit/users/[id] (detalle de cuenta para el estado). */
export interface CreditAccountDetail {
  id: string
  name: string
  email: string | null
  creditLimit: number | null
  creditBalance: number | null
  creditMovements: CreditMovementItem[]
}
