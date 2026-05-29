import { redirect } from 'next/navigation'
import { signIn, auth } from '@/server/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const session = await auth()
  const params = await searchParams
  if (session?.user) redirect(params.next || '/dashboard')

  async function loginWithDiscord() {
    'use server'
    await signIn('discord', { redirectTo: params.next || '/dashboard' })
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
            🎫
          </div>
          <CardTitle>Euphoric Tickets</CardTitle>
          <CardDescription>
            Open and manage support tickets across your communities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={loginWithDiscord}>
            <Button className="w-full" size="lg" type="submit">
              <DiscordIcon />
              Continue with Discord
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            We use Discord for sign-in and to know which communities you're a member of.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-4 w-4">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a.075.075 0 0 0-.079.038c-.34.6-.717 1.385-.98 2A18.27 18.27 0 0 0 12 4.86c-1.18 0-2.343.06-3.498.18-.262-.616-.65-1.4-.99-2A.077.077 0 0 0 7.434 3 19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C1.302 8.013.668 11.553.987 15.05a.083.083 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.029.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.042-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.7.772 1.366 1.225 1.993a.076.076 0 0 0 .084.028 19.838 19.838 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-4.177-.838-7.69-3.549-10.652a.06.06 0 0 0-.031-.028zM8.02 13.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.42-2.157 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.42-2.157 2.42z" />
    </svg>
  )
}
