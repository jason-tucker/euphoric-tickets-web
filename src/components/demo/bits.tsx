'use client'

// Small shared affordances for the demo: a hint that edits are local-only, and a
// button to wipe the per-browser overlay back to the seeded data.

import { RotateCcw } from 'lucide-react'
import { useDemoStore } from './store'
import { Button } from '@/components/ui/button'

export function SavedHint({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-xs text-muted-foreground'}>
      Saved in your browser only — this demo never changes anything real.
    </p>
  )
}

export function ResetDemoButton({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'default'
  className?: string
}) {
  const { reset } = useDemoStore()
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      onClick={() => {
        if (confirm('Reset the demo? This clears the changes saved in your browser.')) reset()
      }}
      title="Clear the changes saved in your browser and return to the seeded demo data"
    >
      <RotateCcw className="mr-1 h-3.5 w-3.5" />
      Reset demo
    </Button>
  )
}
