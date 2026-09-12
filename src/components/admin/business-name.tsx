"use client"

import { useEffect, useState } from "react"

let cachedName: string | null = null
let inflight: Promise<string | null> | null = null
const listeners = new Set<(name: string) => void>()

function load(force = false): Promise<string | null> {
  if (force) inflight = null
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/api/business")
        if (!res.ok) return cachedName
        const data = await res.json()
        const name =
          typeof data?.name === "string" && data.name.trim() ? data.name : cachedName
        cachedName = name
        if (name) listeners.forEach((l) => l(name))
        return name
      } catch {
        inflight = null
        return cachedName
      }
    })()
  }
  return inflight
}

export function refreshBusinessName() {
  return load(true)
}

export function BusinessName({
  fallback = "Reficio",
  className,
}: {
  fallback?: string
  className?: string
}) {
  const [name, setName] = useState(cachedName ?? fallback)

  useEffect(() => {
    const update = (n: string) => setName(n)
    listeners.add(update)
    load().then((n) => {
      if (n) setName(n)
    })
    return () => {
      listeners.delete(update)
    }
  }, [])

  return <span className={className}>{name}</span>
}
