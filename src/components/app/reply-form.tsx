'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Eye, Loader2, Pencil, Send } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { DiscordMarkdown } from '@/components/app/discord-markdown'
import { replyToTicket } from '@/app/b/[slug]/tickets/[id]/actions'
import { cn } from '@/lib/utils'

export function ReplyForm({ slug, ticketId }: { slug: string; ticketId: number }) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  // On narrow screens the preview collapses to a toggle so the form stays usable.
  const [mobileTab, setMobileTab] = useState<'write' | 'preview'>('write')

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

  const textarea = (
    <Textarea
      value={body}
      onChange={(e) => setBody(e.target.value)}
      placeholder="Type a reply… (Discord formatting supported)"
      rows={6}
      maxLength={2000}
      disabled={pending}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          ;(e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
        }
      }}
      className="h-full min-h-[9rem] resize-y"
    />
  )

  const preview = (
    <div className="min-h-[9rem] rounded-md border bg-muted/30 p-2.5">
      <DiscordMarkdown content={body} />
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {/* Mobile: tabbed. Desktop (sm+): side-by-side. */}
      <div className="sm:hidden">
        <div className="mb-2 inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMobileTab('write')}
            className={cn('inline-flex items-center gap-1 rounded px-2 py-1', mobileTab === 'write' && 'bg-accent')}
          >
            <Pencil className="h-3 w-3" /> Write
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            className={cn('inline-flex items-center gap-1 rounded px-2 py-1', mobileTab === 'preview' && 'bg-accent')}
          >
            <Eye className="h-3 w-3" /> Preview
          </button>
        </div>
        {mobileTab === 'write' ? textarea : preview}
      </div>

      <div className="hidden gap-2 sm:grid sm:grid-cols-2">
        <div className="flex flex-col">{textarea}</div>
        <div className="flex flex-col">
          <div className="mb-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Eye className="h-3 w-3" /> Preview
          </div>
          {preview}
        </div>
      </div>

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
