import { cn } from '@/lib/utils'
import { statusBadgeClass, statusLabel } from '@/lib/format'

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        statusBadgeClass(status),
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  )
}
