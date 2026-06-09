import Link from 'next/link'
import { getPersonaKey } from '@/server/demo/cookie'
import { demoScope, getPersona } from '@/server/demo/personas'
import { DemoStoreProvider } from '@/components/demo/store'
import { DemoTopNav } from '@/components/demo/demo-top-nav'
import { ResetDemoButton } from '@/components/demo/bits'

// The /demo subtree is public (the middleware matcher excludes it) and reads the
// persona cookie fresh on every request, so it stays dynamic.
export const dynamic = 'force-dynamic'

export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const personaKey = await getPersonaKey()
  const scope = demoScope(getPersona(personaKey))

  return (
    <DemoStoreProvider>
      <div className="border-b border-amber-500/30 bg-amber-500/10">
        <div className="container flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
          <p className="text-amber-700 dark:text-amber-300">
            <strong>Demo</strong> — sample data, fully interactive. Anything you change is saved{' '}
            <strong>only in your browser</strong> and never touches a real server or Discord.{' '}
            <Link href="/" className="underline">Back to the real app →</Link>
          </p>
          <ResetDemoButton />
        </div>
      </div>
      <DemoTopNav scope={scope} />
      {children}
    </DemoStoreProvider>
  )
}
