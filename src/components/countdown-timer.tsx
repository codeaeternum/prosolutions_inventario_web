"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Clock, AlertTriangle, XCircle } from "lucide-react"

interface CountdownTimerProps {
  expiresAt: string | Date
  className?: string
  onExpire?: () => void
  showIcon?: boolean
  compact?: boolean
}

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
  total: number
}

function calculateTimeLeft(expiresAt: Date): TimeLeft {
  const now = new Date().getTime()
  const expiry = new Date(expiresAt).getTime()
  const difference = expiry - now

  if (difference <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 }
  }

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
    total: difference,
  }
}

function getUrgencyLevel(timeLeft: TimeLeft): "normal" | "warning" | "critical" | "expired" {
  if (timeLeft.total <= 0) return "expired"
  if (timeLeft.total <= 5 * 60 * 1000) return "critical" // 5 minutos
  if (timeLeft.total <= 30 * 60 * 1000) return "warning" // 30 minutos
  return "normal"
}

export function CountdownTimer({
  expiresAt,
  className,
  onExpire,
  showIcon = true,
  compact = false,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() =>
    calculateTimeLeft(new Date(expiresAt))
  )
  const [hasExpired, setHasExpired] = useState(false)

  const checkExpiration = useCallback(() => {
    const newTimeLeft = calculateTimeLeft(new Date(expiresAt))
    setTimeLeft(newTimeLeft)

    if (newTimeLeft.total <= 0 && !hasExpired) {
      setHasExpired(true)
      onExpire?.()
    }
  }, [expiresAt, hasExpired, onExpire])

  useEffect(() => {
    checkExpiration()
    const timer = setInterval(checkExpiration, 1000)
    return () => clearInterval(timer)
  }, [checkExpiration])

  const urgency = getUrgencyLevel(timeLeft)

  const urgencyStyles = {
    normal: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 animate-pulse",
    expired: "bg-muted text-muted-foreground",
  }

  const IconComponent = {
    normal: Clock,
    warning: AlertTriangle,
    critical: AlertTriangle,
    expired: XCircle,
  }[urgency]

  if (urgency === "expired") {
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium",
        urgencyStyles.expired,
        className
      )}>
        {showIcon && <XCircle className="h-3.5 w-3.5" />}
        <span>Expirado</span>
      </div>
    )
  }

  // Formato del tiempo
  let timeDisplay: string
  if (compact) {
    if (timeLeft.days > 0) {
      timeDisplay = `${timeLeft.days}d ${timeLeft.hours}h`
    } else if (timeLeft.hours > 0) {
      timeDisplay = `${timeLeft.hours}h ${timeLeft.minutes}m`
    } else if (timeLeft.minutes > 0) {
      timeDisplay = `${timeLeft.minutes}m ${timeLeft.seconds}s`
    } else {
      timeDisplay = `${timeLeft.seconds}s`
    }
  } else {
    const parts: string[] = []
    if (timeLeft.days > 0) parts.push(`${timeLeft.days}d`)
    if (timeLeft.hours > 0) parts.push(`${timeLeft.hours}h`)
    if (timeLeft.minutes > 0) parts.push(`${timeLeft.minutes}m`)
    if (timeLeft.days === 0 && timeLeft.hours === 0) {
      parts.push(`${timeLeft.seconds}s`)
    }
    timeDisplay = parts.join(" ")
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium",
      urgencyStyles[urgency],
      className
    )}>
      {showIcon && <IconComponent className="h-3.5 w-3.5" />}
      <span>{timeDisplay}</span>
    </div>
  )
}

// Versión para mostrar como texto simple
export function CountdownText({
  expiresAt,
  className,
}: {
  expiresAt: string | Date
  className?: string
}) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() =>
    calculateTimeLeft(new Date(expiresAt))
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(new Date(expiresAt)))
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  if (timeLeft.total <= 0) {
    return <span className={cn("text-muted-foreground", className)}>Expirado</span>
  }

  let text: string
  if (timeLeft.days > 0) {
    text = `${timeLeft.days}d ${timeLeft.hours}h restantes`
  } else if (timeLeft.hours > 0) {
    text = `${timeLeft.hours}h ${timeLeft.minutes}m restantes`
  } else if (timeLeft.minutes > 0) {
    text = `${timeLeft.minutes}m ${timeLeft.seconds}s restantes`
  } else {
    text = `${timeLeft.seconds}s restantes`
  }

  return <span className={className}>{text}</span>
}
