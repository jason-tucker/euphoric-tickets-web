import { requireBusinessAccess } from '@/server/permissions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { saveBusinessSettings } from './actions'

export default async function BusinessSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { business } = await requireBusinessAccess(slug, 'admin')

  return (
    <main className="container max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings — {business.name}</h1>
        <p className="text-sm text-muted-foreground">
          Connect this business to Discord. Roles, webhook, and categories live here.
        </p>
      </div>

      <form action={saveBusinessSettings.bind(null, slug)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business</CardTitle>
            <CardDescription>What end users and your team see.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={business.name} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" defaultValue={business.description ?? ''} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discord</CardTitle>
            <CardDescription>
              The Discord guild and which roles count as admins of this business.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="discordGuildId">Discord guild ID</Label>
              <Input
                id="discordGuildId"
                name="discordGuildId"
                defaultValue={business.discordGuildId}
                pattern="\d{17,20}"
                required
              />
              <p className="text-xs text-muted-foreground">Enable Developer Mode in Discord, right-click your server, &quot;Copy Server ID&quot;.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adminRoleIds">Admin role IDs (comma-separated)</Label>
              <Input
                id="adminRoleIds"
                name="adminRoleIds"
                defaultValue={business.adminRoleIds}
                placeholder="e.g. 1234567890,9876543210"
              />
              <p className="text-xs text-muted-foreground">
                Members with any of these roles get admin access to this business.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="webhookUrl">Outbound webhook URL</Label>
              <Input
                id="webhookUrl"
                name="webhookUrl"
                defaultValue={business.webhookUrl ?? ''}
                placeholder="https://discord.com/api/webhooks/…"
              />
              <p className="text-xs text-muted-foreground">
                Per-user spoof posts go here. Create one in any Discord channel: Edit Channel → Integrations → Webhooks.
              </p>
            </div>
          </CardContent>
        </Card>

        <Button type="submit">Save settings</Button>
      </form>
    </main>
  )
}
