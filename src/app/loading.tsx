import { LoadingSpinner } from "@/components/loading-spinner"

export default function RootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <LoadingSpinner size="lg" />
    </div>
  )
}
