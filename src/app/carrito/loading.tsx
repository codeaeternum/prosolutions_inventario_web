import { LoadingSpinner } from "@/components/loading-spinner"

export default function CarritoLoading() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <LoadingSpinner size="lg" />
    </div>
  )
}
