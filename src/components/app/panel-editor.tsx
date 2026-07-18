'use client'

// The "Ticket panel" appearance editor: fields + live Discord-style preview.
// Pure client state. On the real settings page the visible controls carry form
// names (`withFormFields`) so the wrapping <form> submits them to the server
// action; the /demo mirror instead consumes the normalized value via `onChange`
// and writes it to the localStorage overlay.

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  PanelPreview,
  PANEL_DEFAULT_ACCENT,
  PANEL_DEFAULT_BODY,
  PANEL_DEFAULT_TITLE,
  type PanelButtonStyle,
  type PanelPreviewCategory,
  type PanelSettings,
} from './panel-preview'

// Bot default first, then Discord brand colors.
const PRESET_ACCENTS = ['#a855f7', '#5865f2', '#eb459e', '#ed4245', '#fee75c', '#57f287']

const BUTTON_STYLES: { value: PanelButtonStyle; label: string }[] = [
  { value: 'primary', label: 'Primary (blurple)' },
  { value: 'secondary', label: 'Secondary (grey)' },
  { value: 'success', label: 'Success (green)' },
  { value: 'danger', label: 'Danger (red)' },
]

// Drop fields matching the bot's hardcoded defaults so an untouched form
// round-trips to "no panel key" in settings JSONB. The server action applies
// the same rule; this copy keeps the demo overlay in the exact DB shape.
export function normalizePanelSettings(raw: {
  accentColor: string
  title: string
  body: string
  imageUrl: string
  buttonStyle: PanelButtonStyle
  showCategoryDescriptions: boolean
}): PanelSettings {
  const out: PanelSettings = {}
  const accent = raw.accentColor.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(accent) && accent !== PANEL_DEFAULT_ACCENT) out.accentColor = accent
  const title = raw.title.trim()
  if (title && title !== PANEL_DEFAULT_TITLE) out.title = title
  const body = raw.body.replace(/\r\n/g, '\n').trim()
  if (body && body !== PANEL_DEFAULT_BODY) out.body = body
  const imageUrl = raw.imageUrl.trim()
  if (imageUrl) out.imageUrl = imageUrl
  if (raw.buttonStyle !== 'primary') out.buttonStyle = raw.buttonStyle
  if (raw.showCategoryDescriptions) out.showCategoryDescriptions = true
  return out
}

export function PanelEditor({
  initial,
  categories,
  withFormFields = false,
  onChange,
}: {
  initial: PanelSettings
  categories: PanelPreviewCategory[]
  /** Render name= attributes so a wrapping <form> submits the fields. */
  withFormFields?: boolean
  /** Called with the normalized settings on every edit (and once on mount). */
  onChange?: (panel: PanelSettings) => void
}) {
  const [accent, setAccent] = React.useState(initial.accentColor ?? PANEL_DEFAULT_ACCENT)
  const [title, setTitle] = React.useState(initial.title ?? '')
  const [body, setBody] = React.useState(initial.body ?? '')
  const [imageUrl, setImageUrl] = React.useState(initial.imageUrl ?? '')
  const [buttonStyle, setButtonStyle] = React.useState<PanelButtonStyle>(initial.buttonStyle ?? 'primary')
  const [showDescriptions, setShowDescriptions] = React.useState(!!initial.showCategoryDescriptions)

  React.useEffect(() => {
    onChange?.(
      normalizePanelSettings({
        accentColor: accent,
        title,
        body,
        imageUrl,
        buttonStyle,
        showCategoryDescriptions: showDescriptions,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, title, body, imageUrl, buttonStyle, showDescriptions])

  const name = (n: string) => (withFormFields ? n : undefined)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="panelAccentColor">Accent color</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              id="panelAccentColor"
              name={name('accentColor')}
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
            />
            {PRESET_ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Accent color ${c}`}
                onClick={() => setAccent(c)}
                className={cn(
                  'h-6 w-6 rounded-full border border-black/20',
                  accent.toLowerCase() === c && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">The colored bar on the panel card.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="panelButtonStyle">Button style</Label>
          <select
            id="panelButtonStyle"
            name={name('buttonStyle')}
            value={buttonStyle}
            onChange={(e) => setButtonStyle(e.target.value as PanelButtonStyle)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            {BUTTON_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="panelTitle">Title</Label>
        <Input
          id="panelTitle"
          name={name('title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder={PANEL_DEFAULT_TITLE}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="panelBody">Body</Label>
        <Textarea
          id="panelBody"
          name={name('body')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={PANEL_DEFAULT_BODY}
        />
        <p className="text-xs text-muted-foreground">
          Blank fields fall back to the defaults shown as placeholders.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="panelImageUrl">Image URL (optional)</Label>
        <Input
          id="panelImageUrl"
          name={name('imageUrl')}
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          maxLength={512}
          placeholder="https://…"
        />
        <p className="text-xs text-muted-foreground">Shown under the body text. Must be https.</p>
      </div>
      <div className="flex items-start gap-3 rounded-md border border-input bg-background/40 p-3">
        <input
          id="panelShowCategoryDescriptions"
          name={name('showCategoryDescriptions')}
          type="checkbox"
          checked={showDescriptions}
          onChange={(e) => setShowDescriptions(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
        />
        <div className="space-y-0.5">
          <Label htmlFor="panelShowCategoryDescriptions" className="cursor-pointer">
            Show category descriptions
          </Label>
          <p className="text-xs text-muted-foreground">
            Lists each category as &quot;label — description&quot; on the card.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Preview</Label>
        <PanelPreview
          panel={{
            accentColor: accent,
            title: title || undefined,
            body: body || undefined,
            imageUrl: imageUrl.trim() || undefined,
            buttonStyle,
            showCategoryDescriptions: showDescriptions,
          }}
          categories={categories}
        />
      </div>
    </div>
  )
}
