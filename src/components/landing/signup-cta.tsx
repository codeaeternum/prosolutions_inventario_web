import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SignupCta() {
  return <Button asChild size="lg" className="h-auto min-h-12 whitespace-normal px-6 py-3 text-base"><Link href="/registro">Crear mi negocio gratis<ArrowRight aria-hidden className="ml-2 h-4 w-4 shrink-0" /></Link></Button>
}
