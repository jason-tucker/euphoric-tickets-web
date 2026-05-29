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

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    discordId?: string
    avatarHash?: string | null
    discordAccessToken?: string
    guilds?: DiscordGuildSnapshot[]
    guildsFetchedAt?: number
  }
}

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

        token.userId = inserted[0]!.id
        token.discordId = discordId
        token.avatarHash = discordProfile.avatar ?? null
        token.discordAccessToken = account.access_token
        token.guilds = []
        token.guildsFetchedAt = 0
      }

      // Refresh guild list when stale or explicitly asked.
      const stale = !token.guildsFetchedAt || Date.now() - token.guildsFetchedAt > GUILDS_REFRESH_MS
      if ((stale || trigger === 'update') && token.discordAccessToken) {
        try {
          const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token.discordAccessToken}` },
            cache: 'no-store',
          })
          if (res.ok) {
            token.guilds = (await res.json()) as DiscordGuildSnapshot[]
            token.guildsFetchedAt = Date.now()
          }
        } catch {
          // Discord hiccup — keep the stale snapshot rather than locking the
          // user out.
        }
      }

      return token
    },

    async session({ session, token }) {
      session.user = {
        id: (token.userId as string) ?? '',
        discordId: (token.discordId as string) ?? '',
        name: session.user?.name ?? null,
        email: session.user?.email ?? null,
        image: session.user?.image ?? null,
        avatarHash: token.avatarHash ?? null,
      }
      session.discordAccessToken = token.discordAccessToken
      session.guilds = token.guilds ?? []
      return session
    },
  },
})
