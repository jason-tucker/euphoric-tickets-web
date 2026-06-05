'use client'

import { Button } from '@/components/ui/button'
import { leaveGuildAction } from './actions'

// Force-leaving a guild is destructive + outward-facing (the bot loses access
// to every channel there), so gate the submit behind a native confirm.
export function LeaveGuildButton({ guildId, guildName }: { guildId: string; guildName: string }) {
  return (
    <form
      action={leaveGuildAction.bind(null, guildId)}
      onSubmit={(e) => {
        if (
          !confirm(
            `Force the bot to LEAVE “${guildName}”?\n\n` +
              'It will lose access to every channel there. This does NOT delete the team or its tickets — re-invite the bot to restore access.',
          )
        ) {
          e.preventDefault()
        }
      }}
    >
      <Button type="submit" variant="destructive" size="sm">
        Force leave
      </Button>
    </form>
  )
}
