import { LoadingSpinner } from "@/components/loading-spinner"

export default function CatalogoLoading() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <LoadingSpinner size="lg" />
    </div>
  )
}
