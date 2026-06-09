'use client'

// Resolves a ticket-detail to render. Seeded tickets arrive with a server-built
// `base`; tickets the visitor opened in-session live only in the overlay, so we
// reconstruct a base for those from the store. Either way the interactive view
// (DemoTicketDetail) drives everything off the overlay.

import Link from 'next/link'
import type { DemoTicketBase } from '@/server/demo/detail'
import { useDemoStore } from '@/components/demo/store'
import { DemoTicketDetail } from './ticket-detail'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type Me = { id: string; name: string; image: string | null; discordId: string | null }

export function DemoTicketLoader({ base, slug, me, id }: { base: DemoTicketBase | null; slug: string; me: Me; id: number }) {
  const { overlay, hydrated } = useDemoStore()

  if (base) return <DemoTicketDetail base={base} slug={slug} me={me} />

  const nt = overlay.newTickets.find((t) => t.id === id && t.teamSlug === slug)
  if (!nt) {
    if (!hydrated) return <main className="container py-10 text-sm text-muted-foreground">Loading…</main>
    return (
      <main className="container max-w-xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>Ticket not found</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>This demo ticket doesn’t exist (or was cleared with “Reset demo”).</p>
            <Button asChild size="sm" variant="outline"><Link href="/demo">← Back to dashboard</Link></Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const isOpener = nt.openerId === me.id
  const synth: DemoTicketBase = {
    ticket: nt,
    access: {
      isAdmin: false,
      isStaff: false,
      isOpener,
      canReply: isOpener,
      canClaim: false,
      canClose: isOpener,
      canChangeCategory: false,
      canManageMembers: false,
      canDeleteChannel: false,
    },
    // base messages/notes stay empty — DemoTicketDetail folds the overlay's in.
    messages: [],
    internalNotes: [],
    audit: [
      {
        id: 'a-opened',
        action: 'opened',
        metadata: nt.categoryLabel ? { categoryLabel: nt.categoryLabel } : {},
        createdAt: nt.openedAt,
        actorName: nt.openerName,
        actorDiscordId: nt.openerDiscordId,
      },
    ],
    people: nt.openerDiscordId ? [{ discordId: nt.openerDiscordId, name: nt.openerName, image: nt.openerImage, isExternal: false, isOpener: true }] : [],
    accessRoles: [],
    categories: [],
    assignable: [],
  }
  return <DemoTicketDetail base={synth} slug={slug} me={me} />
}
