"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { cn } from "@/lib/utils"

interface ReservationQRProps {
  qrCode: string
  reservationId: string
  size?: number
  className?: string
  showCode?: boolean
}

export function ReservationQR({
  qrCode,
  reservationId,
  size = 150,
  className,
  showCode = true,
}: ReservationQRProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("")
  const [error, setError] = useState(false)

  useEffect(() => {
    const generateQR = async () => {
      try {
        // El contenido del QR es una URL que puede ser escaneada
        const qrContent = `${typeof window !== "undefined" ? window.location.origin : ""}/verificar/${qrCode}`
        const dataUrl = await QRCode.toDataURL(qrContent, {
          width: size,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
          errorCorrectionLevel: "M",
        })
        setQrDataUrl(dataUrl)
      } catch (err) {
        console.error("Error generating QR:", err)
        setError(true)
      }
    }

    generateQR()
  }, [qrCode, size])

  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-muted rounded-lg", className)} style={{ width: size, height: size }}>
        <span className="text-xs text-muted-foreground">Error QR</span>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt={`QR Reserva ${reservationId}`}
          width={size}
          height={size}
          className="rounded-lg border"
        />
      ) : (
        <div
          className="animate-pulse bg-muted rounded-lg"
          style={{ width: size, height: size }}
        />
      )}
      {showCode && (
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground">Código:</p>
          <p className="font-mono text-xs font-medium">{qrCode.slice(-8).toUpperCase()}</p>
        </div>
      )}
    </div>
  )
}
