'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Send } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { DiscordMarkdown } from '@/components/app/discord-markdown'
import { replyToTicket } from '@/app/b/[slug]/tickets/[id]/actions'
import { cn } from '@/lib/utils'

export function ReplyForm({ slug, ticketId }: { slug: string; ticketId: number }) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [showPreview, setShowPreview] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!body.trim() || pending) return
    const fd = new FormData()
    fd.set('body', body)
    startTransition(async () => {
      const res = await replyToTicket(slug, ticketId, fd)
      if (res.ok) {
        setBody('')
        toast.success('Reply sent.')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Type a reply… (Discord formatting supported)"
        rows={5}
        maxLength={2000}
        disabled={pending}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
          }
        }}
        className="min-h-[8rem] resize-y"
      />

      {/* Preview toggle — shows the rendered Discord output below the input. */}
      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
          showPreview ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
        )}
      >
        {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {showPreview ? 'Hide preview' : 'Show preview'}
      </button>

      {showPreview && (
        <div className="rounded-md border bg-muted/30 p-2.5">
          <DiscordMarkdown content={body} />
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{body.length}/2000</span>
        <Button type="submit" size="sm" disabled={pending || !body.trim()} aria-busy={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send />}
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  )
}
