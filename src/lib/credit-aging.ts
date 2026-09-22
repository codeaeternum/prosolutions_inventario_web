/** Aging de cartera: antigüedad del saldo pendiente aplicando abonos FIFO a los cargos. */

export type CreditAgingBucket = "0-7" | "8-15" | "16-30" | "30+"

export interface CreditAging {
  /** ISO del DEBT más viejo sin cubrir; null si no hay saldo descubierto. */
  oldestDebtAt: string | null
  daysOverdue: number
  bucket: CreditAgingBucket | null
}

export interface CreditAgingMovement {
  type: "DEBT" | "PAYMENT" | "REVERSAL"
  amount: number
  createdAt: Date | string
}

const DAY_MS = 24 * 60 * 60 * 1000
const EPS = 0.005

function bucketOf(days: number): CreditAgingBucket {
  if (days <= 7) return "0-7"
  if (days <= 15) return "8-15"
  if (days <= 30) return "16-30"
  return "30+"
}

/**
 * FIFO: los abonos (PAYMENT) y reversiones (REVERSAL) cubren primero los cargos
 * (DEBT) más viejos. La fecha del primer cargo no cubierto marca la antigüedad
 * del saldo. Agrégalos por usuario antes de llamar, o usa creditAgingByUser.
 */
export function creditAging(
  movements: CreditAgingMovement[],
  now: Date = new Date()
): CreditAging {
  const debts = movements
    .filter((m) => m.type === "DEBT" && m.amount > EPS)
    .map((m) => ({ at: new Date(m.createdAt), amount: m.amount }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  let credit = movements
    .filter((m) => m.type !== "DEBT")
    .reduce((sum, m) => sum + m.amount, 0)

  let oldest: Date | null = null
  for (const debt of debts) {
    credit -= debt.amount
    if (credit < -EPS) {
      oldest = debt.at
      break
    }
    if (credit < 0) credit = 0
  }

  if (!oldest) return { oldestDebtAt: null, daysOverdue: 0, bucket: null }

  const daysOverdue = Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / DAY_MS))
  return { oldestDebtAt: oldest.toISOString(), daysOverdue, bucket: bucketOf(daysOverdue) }
}

/** Agrupa movimientos por userId y calcula el aging de cada uno. */
export function creditAgingByUser(
  movements: (CreditAgingMovement & { userId: string })[],
  now: Date = new Date()
): Map<string, CreditAging> {
  const byUser = new Map<string, CreditAgingMovement[]>()
  for (const m of movements) {
    const list = byUser.get(m.userId)
    if (list) list.push(m)
    else byUser.set(m.userId, [m])
  }
  const result = new Map<string, CreditAging>()
  for (const [userId, list] of byUser) result.set(userId, creditAging(list, now))
  return result
}
