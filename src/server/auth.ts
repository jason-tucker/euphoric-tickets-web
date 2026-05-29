import NextAuth from 'next-auth'
import Discord from 'next-auth/providers/discord'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { users } from '@/db/schema'

// Scopes:
//   identify              — discord id, username, avatar
//   email                 — user email (cosmetic only)
//   guilds                — list of guilds the user is in (for business resolution)
//   guilds.members.read   — the user's roles per guild (for admin resolution)
const DISCORD_SCOPES = 'identify email guilds guilds.members.read'

export type DiscordGuildSnapshot = {
  id: string
  name: string
  icon: string | null
  permissions: string
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      discordId: string
      name?: string | null
      email?: string | null
      image?: string | null
      avatarHash?: string | null
    }
    discordAccessToken?: string
    guilds?: DiscordGuildSnapshot[]
  }
}

// We don't augment `next-auth/jwt` — Next.js's `tsc` plugin trips on it
// even though the module exists. The `token` argument inside the jwt
// callback is loosely typed and we add fields to it via property
// assignment. That's fine: only this file reads them back.

// Re-fetch guild list at most every 10 minutes to keep session size small
// and avoid spamming Discord on every request.
const GUILDS_REFRESH_MS = 10 * 60 * 1000

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID!,
      clientSecret: process.env.AUTH_DISCORD_SECRET!,
      authorization: { params: { scope: DISCORD_SCOPES } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile, trigger }) {
      const t = token as Record<string, unknown>
      // First login — Discord profile + access token arrive here.
      if (account?.provider === 'discord' && profile) {
        const discordId = String(profile.id)
        const discordProfile = profile as {
          id: string
          username?: string
          global_name?: string | null
          avatar?: string | null
          email?: string | null
        }

        // Upsert the user row.
        const inserted = await db
          .insert(users)
          .values({
            discordId,
            name: discordProfile.global_name ?? discordProfile.username ?? null,
            email: discordProfile.email ?? null,
            image: discordProfile.avatar
              ? `https://cdn.discordapp.com/avatars/${discordId}/${discordProfile.avatar}.${discordProfile.avatar.startsWith('a_') ? 'gif' : 'png'}`
              : null,
          })
          .onConflictDoUpdate({
            target: users.discordId,
            set: {
              name: sql`excluded.name`,
              email: sql`excluded.email`,
              image: sql`excluded.image`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: users.id })

        t.userId = inserted[0]!.id
        t.discordId = discordId
        t.avatarHash = discordProfile.avatar ?? null
        t.discordAccessToken = account.access_token
        t.guilds = []
        t.guildsFetchedAt = 0
      }

      // Refresh guild list when stale or explicitly asked.
      const accessToken = t.discordAccessToken as string | undefined
      const lastFetched = (t.guildsFetchedAt as number | undefined) ?? 0
      const stale = lastFetched === 0 || Date.now() - lastFetched > GUILDS_REFRESH_MS
      if ((stale || trigger === 'update') && accessToken) {
        try {
          const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
          })
          if (res.ok) {
            t.guilds = (await res.json()) as DiscordGuildSnapshot[]
            t.guildsFetchedAt = Date.now()
          }
        } catch {
          // Discord hiccup — keep the stale snapshot rather than locking the
          // user out.
        }
      }

      return token
    },

    async session({ session, token }) {
      const t = token as Record<string, unknown>
      session.user = {
        id: (t.userId as string) ?? '',
        discordId: (t.discordId as string) ?? '',
        name: session.user?.name ?? null,
        email: session.user?.email ?? null,
        image: session.user?.image ?? null,
        avatarHash: (t.avatarHash as string | null | undefined) ?? null,
      }
      session.discordAccessToken = t.discordAccessToken as string | undefined
      session.guilds = (t.guilds as DiscordGuildSnapshot[] | undefined) ?? []
      return session
    },
  },
})
