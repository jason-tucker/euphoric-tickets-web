'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { replyToTicket } from '@/app/b/[slug]/tickets/[id]/actions'

export function ReplyForm({ slug, ticketId }: { slug: string; ticketId: number }) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()

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
        placeholder="Type a reply… (posts to Discord as you)"
        rows={4}
        maxLength={2000}
        disabled={pending}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
          }
        }}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{body.length}/2000</span>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          <Send />
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  )
}
