'use client'

import { Loader2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

// Drop-in replacement for <Button type="submit"> inside a <form>.
// Disables itself + shows a spinner while the form action is pending —
// so rapid double-clicks can't fire the action twice. useFormStatus reads
// from the nearest <form action={...}>; no prop drilling needed.
export function SubmitButton({
  children,
  pendingChildren,
  disabled,
  ...rest
}: ButtonProps & { pendingChildren?: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" {...rest} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {pending ? (pendingChildren ?? children) : children}
    </Button>
  )
}
