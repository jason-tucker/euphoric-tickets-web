import { ChangelogDialog } from './changelog-dialog'

// Slim site-wide footer showing the running app version. The semver comes
// from package.json, injected as NEXT_PUBLIC_APP_VERSION at build time (see
// next.config.ts). The version is clickable — it opens the changelog.
export function SiteFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'
  return (
    <footer className="border-t py-4">
      <div className="container flex items-center justify-center">
        <p className="text-xs text-muted-foreground">
          Euphoric Tickets <ChangelogDialog version={version} />
        </p>
      </div>
    </footer>
  )
}
