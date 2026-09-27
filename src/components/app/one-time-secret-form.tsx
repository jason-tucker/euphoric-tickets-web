'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import type { SecretResult } from '@/app/admin/integrations/actions'

// Wraps a server action that returns a secret (API key / webhook signing
// secret) and shows it ONCE. The value exists only in this component's
// memory: it is never put in the URL, localStorage, or a cookie, and it is
// gone on reload.
export function OneTimeSecretForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  confirm,
  showOpenLink,
  variant,
}: {
  action: (prev: SecretResult, formData: FormData) => Promise<SecretResult>
  children?: React.ReactNode
  submitLabel: string
  pendingLabel: string
  confirm?: string
  showOpenLink?: boolean
  variant?: 'default' | 'outline' | 'destructive'
}) {
  const [state, formAction] = useActionState(action, null)
  return (
    <div className="space-y-3">
      <form
        action={formAction}
        className="space-y-3"
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault()
        }}
      >
        {children}
        <SubmitButton variant={variant ?? 'default'} pendingChildren={pendingLabel}>
          {submitLabel}
        </SubmitButton>
      </form>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && (
        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRound className="h-4 w-4" aria-hidden /> Copy now — this is shown only once.
          </p>
          {state.items.map((it) => (
            <SecretRow key={it.label} label={it.label} value={it.value} />
          ))}
          {showOpenLink && (
            <Link href={`/admin/integrations/${state.id}`} className="inline-block text-sm underline underline-offset-2">
              Open the integration →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function SecretRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true))
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}
