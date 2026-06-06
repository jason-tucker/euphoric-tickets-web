// Slim site-wide footer showing the running app version. The semver comes
// from package.json, injected as NEXT_PUBLIC_APP_VERSION at build time (see
// next.config.ts). Server component — no interactivity, just a label.
export function SiteFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'
  return (
    <footer className="border-t py-4">
      <div className="container flex items-center justify-center">
        <p className="text-xs text-muted-foreground">
          Euphoric Tickets <span className="font-mono">v{version}</span>
        </p>
      </div>
    </footer>
  )
}
