import { LoadingSpinner } from "@/components/loading-spinner"

export default function AdminLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center lg:pl-64">
      <LoadingSpinner size="lg" />
    </div>
  )
}
