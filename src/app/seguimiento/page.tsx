"use client"

import { Suspense } from "react"
import { DocumentShell } from "@/components/public/document-shell"
import { TrackOrder } from "@/components/public/track-order"

export default function SeguimientoPage() {
  return (
    <DocumentShell maxWidth="6xl" showHomeButton>
      <Suspense fallback={
        <div className="container mx-auto max-w-2xl px-4 pt-14 pb-20">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      }>
        <TrackOrder />
      </Suspense>
    </DocumentShell>
  )
}
