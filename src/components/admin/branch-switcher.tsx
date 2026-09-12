"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Building2, Check, ChevronDown } from "lucide-react"

const BRANCH_KEY = "reficio-branch"

interface Branch {
  id: string
  name: string
  isActive: boolean
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function persistBranch(id: string) {
  document.cookie = `${BRANCH_KEY}=${id};path=/;max-age=31536000`
  localStorage.setItem(BRANCH_KEY, id)
}

interface BranchSwitcherProps {
  // Sucursal base del usuario logueado, usada como fallback inicial.
  homeBranchId?: string | null
}

export function BranchSwitcher({ homeBranchId }: BranchSwitcherProps) {
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/branches")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list: Branch[] = (data?.branches ?? []).filter((b: Branch) => b.isActive)
        setBranches(list)

        // Prioridad: cookie > localStorage > sucursal base del usuario
        const candidate =
          readCookie(BRANCH_KEY) ?? localStorage.getItem(BRANCH_KEY) ?? homeBranchId ?? null
        const valid = candidate && list.some((b) => b.id === candidate) ? candidate : null
        setSelected(valid)

        // Si se resolvió desde localStorage/homeBranch sin cookie, la persistimos
        // para que el servidor también la vea en las siguientes peticiones.
        if (valid && readCookie(BRANCH_KEY) !== valid) {
          persistBranch(valid)
          router.refresh()
        }
      })
      .catch(() => setBranches([]))
  }, [homeBranchId, router])

  const selectBranch = (id: string) => {
    if (id === selected) return
    setSelected(id)
    persistBranch(id)
    router.refresh()
  }

  if (branches.length === 0) return null

  const selectedBranch = branches.find((b) => b.id === selected)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 px-2 sm:px-3" title="Sucursal activa">
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline max-w-[140px] truncate">
            {selectedBranch?.name ?? "Sucursal"}
          </span>
          <ChevronDown className="hidden sm:inline h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch.id}
            onClick={() => selectBranch(branch.id)}
            className="flex items-center gap-2"
          >
            <Check
              className={
                branch.id === selected ? "h-4 w-4 text-primary" : "h-4 w-4 opacity-0"
              }
            />
            <span className="truncate">{branch.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
