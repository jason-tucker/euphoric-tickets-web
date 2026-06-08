'use client'

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'

// The ticket title with an inline rename for native tickets: a pencil button
// next to the heading swaps in an edit field bound to the rename server action.
// TicketTool tickets don't own their channel here, so they pass
// canRename={false} and keep their own rename control in the toolbar.
export function TitleEditor({
  subject,
  canRename,
  action,
}: {
  subject: string
  canRename: boolean
  action: (formData: FormData) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)

  if (canRename && editing) {
    return (
      // Optimistically close on submit; the server action revalidates the page
      // with the new subject, and a failed validation just reopens via the pencil.
      <form action={action} onSubmit={() => setEditing(false)} className="mt-1 flex items-center gap-2">
        <input
          name="name"
          defaultValue={subject}
          autoFocus
          required
          maxLength={100}
          aria-label="Ticket title"
          className="w-full max-w-md rounded-md border bg-background px-2 py-1 text-xl font-semibold"
        />
        <SubmitButton size="sm" variant="secondary" pendingChildren="Saving…">
          Save
        </SubmitButton>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Cancel rename"
          onClick={() => setEditing(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </form>
    )
  }

  return (
    <div className="mt-1 flex items-start gap-2">
      <h1 className="break-words text-2xl font-semibold">{subject}</h1>
      {canRename && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Rename ticket"
          title="Rename ticket"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
