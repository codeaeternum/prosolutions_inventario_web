import { LoadingSpinner } from "@/components/loading-spinner"

export default function MisReservasLoading() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <LoadingSpinner size="lg" />
    </div>
  )
}
