import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Where the real app would redirect an unauthorized user, the demo keeps the
// chrome and shows this instead — so a visitor can still see that the surface
// exists and learn which persona unlocks it (switch via the nav's "Viewing as").
export function PersonaGate({ title, need }: { title: string; need: string }) {
  return (
    <main className="container max-w-xl py-10">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            This area is only visible to {need}. Use <strong>“Viewing as”</strong> in the top-right to switch
            persona and explore it — your place in the demo is kept in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The demo mirrors the real permission model: each persona sees exactly what that role would.
        </CardContent>
      </Card>
    </main>
  )
}
