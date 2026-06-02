import type { Metadata } from 'next'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Help — Euphoric Tickets',
  description: 'How to open tickets, reply, and manage your team.',
}

// Public help / documentation page. Covers the whole system for every tier.
export default function HelpPage() {
  return (
    <>
      <TopNav />
      <main className="container max-w-3xl space-y-6 py-6">
        <div>
          <h1 className="text-3xl font-semibold">Help &amp; how-to</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you can do with Euphoric Tickets, on Discord and on the web.
          </p>
        </div>

        {/* On-page nav */}
        <nav className="flex flex-wrap gap-2 text-sm">
          {[
            ['what-it-is', 'What it is'],
            ['open', 'Open a ticket'],
            ['conversation', 'The conversation'],
            ['attachments', 'Audio & files'],
            ['notifications', 'Notifications'],
            ['staff', 'For staff'],
            ['admin', 'For admins'],
            ['tickettool', 'TicketTool'],
            ['tiers', 'Who can do what'],
            ['commands', 'Command reference'],
            ['faq', 'FAQ'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md border px-2.5 py-1 hover:bg-accent">
              {label}
            </a>
          ))}
        </nav>

        <Section id="what-it-is" title="What it is">
          <p>
            Euphoric Tickets is a support system that works <strong>two ways at once</strong>: in
            Discord and on this website. They share one database, so a message typed in Discord shows
            up here within a second, and a reply sent here lands in the Discord channel — as you, with
            your name and avatar.
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>A <strong>team</strong> is one organization with its own ticket queue.</li>
            <li>A <strong>ticket</strong> is a private channel between you and the team&apos;s staff.</li>
            <li>A <strong>category</strong> sorts tickets (Support, Billing, …) and controls who can open and staff them.</li>
          </ul>
        </Section>

        <Section id="open" title="Open a ticket">
          <p className="font-medium">From Discord</p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Find the ticket <strong>panel</strong> a staff member posted in the server.</li>
            <li>Click the button for the category you need.</li>
            <li>The bot creates a private channel just for you and the staff — describe your issue there.</li>
          </ol>
          <p className="mt-3 font-medium">From the web</p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Sign in with Discord (top-right).</li>
            <li>Click <strong>Open a ticket</strong>, pick the team, category, a subject, and your message.</li>
            <li>You&apos;ll be taken to the ticket — it&apos;s now live in Discord too.</li>
          </ol>
        </Section>

        <Section id="conversation" title="The conversation">
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Reply anywhere.</strong> Type in the Discord channel, or use the reply box here. Both sides update live — no refresh needed.</li>
            <li><strong>Formatting.</strong> The web reply box has a live <em>preview</em> showing exactly how your message&apos;s Discord formatting (bold, italics, code, mentions) will look before you send.</li>
            <li><strong>Status updates.</strong> Small grey lines like <code>Ticket claimed by @name</code> appear when staff act on your ticket — they&apos;re silent, no pings.</li>
            <li><strong>Closing.</strong> Press <strong>Close</strong> on the ticket, or use <code>/tickets close</code>. You&apos;ll get a transcript by DM and can still read it on the web afterward.</li>
          </ul>
        </Section>

        <Section id="attachments" title="Audio & files">
          <p>
            Audio clips and files shared in a ticket show up on the web automatically. <strong>Audio
            plays inline</strong> with a player; other files get a download link. Media streams
            straight from Discord — nothing is stored on our servers.
          </p>
        </Section>

        <Section id="notifications" title="Notifications">
          <p>
            Go to <strong>Notifications</strong> (in the top-right menu) to get pinged when things
            happen:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>ntfy</strong> — free push notifications to your phone. Pick a hard-to-guess topic here, then subscribe to it in the <a className="underline" href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy app</a>.</li>
            <li><strong>Discord DM</strong> — the bot DMs you directly.</li>
          </ul>
          <p>Choose either/both for <em>new tickets</em> and <em>replies on tickets you&apos;re on</em>.</p>
        </Section>

        <Section id="staff" title="For staff">
          <p>Staff are members with a role assigned to a category. You can:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Claim / unclaim</strong> a ticket — <code>/tickets claim</code>, or the button on the card. Claiming shows your teammates you&apos;ve got it.</li>
            <li><strong>Assign</strong> it to a teammate — <code>/tickets assign @user</code>, or the dropdown on the web.</li>
            <li><strong>Add / remove people</strong> — <code>/tickets add @user</code> / <code>remove</code>, or the <strong>People</strong> card on the web.</li>
            <li><strong>Internal notes</strong> — staff-only notes, never shown to the opener. Add them from the web ticket page; they live in a private Discord thread.</li>
            <li><strong>Close / reopen</strong> — close saves a transcript; on the web, closing archives the channel so it can be reopened.</li>
            <li><strong>Rename</strong> — <code>/tickets rename new-name</code> (the ticket number is kept).</li>
            <li><strong>List</strong> — <code>/tickets list</code> shows every open ticket.</li>
          </ul>
        </Section>

        <Section id="admin" title="For admins">
          <p>Admins (and team owners) can do everything staff can, plus:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Manage categories</strong> — on <em>Team settings</em>: emoji, label, description, the Discord categories tickets open/close under, <strong>who can open</strong> the category, <strong>staff roles</strong>, and a <strong>custom first message</strong> (supports <code>{'{{user}}'}</code>, <code>{'{{ticketId}}'}</code>, <code>{'{{subject}}'}</code>, <code>{'{{category}}'}</code>).</li>
            <li><strong>Searchable pickers</strong> — every &quot;paste a Discord ID&quot; field is now a search box for channels/roles/members (and still accepts a raw ID).</li>
            <li><strong>Change a ticket&apos;s category</strong> — the <strong>Move</strong> dropdown, the 🗂️ button, or <code>/tickets category key</code>.</li>
            <li><strong>Convert a channel</strong> — <code>/tickets convert</code> turns a normal channel into a ticket and imports its recent history (with attachments).</li>
            <li><strong>Delete a channel</strong> — <code>/tickets delete</code> permanently removes a <em>closed</em> ticket&apos;s channel (the transcript stays on the web). Admin-only.</li>
            <li><strong>External people</strong> — add someone by Discord ID even if they&apos;re <em>not in the server</em>. They get a DM link, sign in with Discord, and can view/reply here without ever joining the guild.</li>
          </ul>
        </Section>

        <Section id="tickettool" title="TicketTool coexistence">
          <p>
            If your server also runs the third-party <strong>TicketTool</strong> bot, Euphoric Tickets
            can run alongside it: it <strong>ingests</strong> TicketTool&apos;s tickets into this archive
            and lets you <strong>control</strong> them from here.
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Setup (admin, once)</strong> — on <em>Team settings → TicketTool coexistence</em>, pick the Discord categories TicketTool opens its channels under, and set its command prefix (default <code>$</code>). Then, in <strong>TicketTool&apos;s</strong> dashboard → <em>Server Configs → Bot</em>, paste this bot&apos;s user ID (shown on that settings card) so TicketTool accepts its commands.</li>
            <li><strong>Ingest</strong> — every TicketTool ticket opened under a watched category appears here automatically, with its full message history, and stays in sync live.</li>
            <li><strong>Two-way replies</strong> — reply from the web and it posts into the TicketTool channel as you.</li>
            <li><strong>Control</strong> — <strong>Rename</strong>, <strong>Add</strong>/<strong>Remove</strong> people, and <strong>Request close</strong> from the ticket page; each becomes the matching TicketTool command (<code>$rename</code>, <code>$add</code>, <code>$remove</code>, <code>$closeRequest</code>).</li>
            <li><strong>Hands-off by design</strong> — Euphoric never deletes or moves a TicketTool channel; TicketTool stays in charge of its own tickets.</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Gotcha: if commands seem ignored, the bot&apos;s ID probably isn&apos;t whitelisted in TicketTool, or
            the prefix doesn&apos;t match your server&apos;s TicketTool prefix.
          </p>
        </Section>

        <Section id="tiers" title="Who can do what">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1 pr-3">Action</th>
                  <th className="py-1">Required role</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-b [&_td]:py-1">
                <tr><td className="pr-3">Open / reply / close your own ticket</td><td>anyone</td></tr>
                <tr><td className="pr-3">Claim, assign, add/remove members, internal notes</td><td>staff (category role)</td></tr>
                <tr><td className="pr-3">Change category, edit settings, delete channel</td><td>admin only</td></tr>
                <tr><td className="pr-3">Create teams, system dashboards</td><td>sudo</td></tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="commands" title="Command reference">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="[&_td]:border-b [&_td]:py-1 [&_code]:font-mono">
                <tr><td className="pr-3"><code>/help</code></td><td>This guide, tailored to your access.</td></tr>
                <tr><td className="pr-3"><code>/tickets claim</code> · <code>unclaim</code></td><td>Take / release a ticket (staff).</td></tr>
                <tr><td className="pr-3"><code>/tickets assign @user</code></td><td>Assign to a teammate (staff).</td></tr>
                <tr><td className="pr-3"><code>/tickets close</code></td><td>Close + transcript (staff or opener).</td></tr>
                <tr><td className="pr-3"><code>/tickets add</code> · <code>remove @user</code></td><td>Manage ticket membership (staff).</td></tr>
                <tr><td className="pr-3"><code>/tickets rename name</code></td><td>Rename the channel (staff).</td></tr>
                <tr><td className="pr-3"><code>/tickets list</code></td><td>List open tickets (staff).</td></tr>
                <tr><td className="pr-3"><code>/tickets category key</code></td><td>Move to another category (admin).</td></tr>
                <tr><td className="pr-3"><code>/tickets convert</code></td><td>Convert this channel into a ticket (admin).</td></tr>
                <tr><td className="pr-3"><code>/tickets delete</code></td><td>Delete a closed ticket&apos;s channel (admin).</td></tr>
                <tr><td className="pr-3"><code>/panel post</code> · <code>refresh</code></td><td>Post / re-render the ticket panel (sudo).</td></tr>
                <tr><td className="pr-3"><code>/admin …</code></td><td>Manage sudo + teams from Discord (sudo).</td></tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="faq" title="FAQ">
          <dl className="space-y-3">
            <Faq q="I DM'd the bot and nothing happened.">
              The bot doesn&apos;t handle DMs — they don&apos;t reach staff. Open a ticket from the
              server panel or here on the web instead.
            </Faq>
            <Faq q="Why can't I open a certain category?">
              Some categories are restricted to specific roles. If you think you should have access,
              ask an admin to add your role to that category&apos;s <em>allow-to-open</em> list.
            </Faq>
            <Faq q="A ticket says its channel went missing.">
              The bot noticed the Discord channel was deleted. Your transcript is safe here on the
              web — an admin can reopen or close the ticket to tidy up.
            </Faq>
            <Faq q="Can someone outside the server join a ticket?">
              Yes — an admin can add them by Discord ID. They&apos;ll get a DM with a link, sign in
              with Discord, and view/reply here without joining the server.
            </Faq>
          </dl>
        </Section>
      </main>
    </>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{q}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  )
}
