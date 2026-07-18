'use client'

// Discord-style live preview of the "Open a Ticket" panel the bot posts
// (Components V2 container + button row). Deliberately Discord-dark in both app
// themes — it's a facsimile of the Discord client, not app UI. Pure client
// rendering with no server deps so the /demo mirror can import it too.

export type PanelButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'

// Mirrors the businesses.settings.panel JSONB contract the bot reads. Every
// field optional — unset falls back to the bot's hardcoded default.
export type PanelSettings = {
  accentColor?: string
  title?: string
  body?: string
  imageUrl?: string
  buttonStyle?: PanelButtonStyle
  showCategoryDescriptions?: boolean
}

export type PanelPreviewCategory = {
  key: string
  label: string
  emoji: string | null
  description: string | null
}

// The bot's hardcoded panel defaults (euphoric-tickets ticketRenderer.ts).
// Values equal to these are treated as "unset" so an untouched form stores no
// panel key at all.
export const PANEL_DEFAULT_ACCENT = '#a855f7'
export const PANEL_DEFAULT_TITLE = '🎫 Open a Ticket'
export const PANEL_DEFAULT_BODY =
  'Need help? Pick a category below to open a private ticket with the staff team.\nOnly you and staff will see the channel.'

// Discord's button colors per style.
const BUTTON_COLORS: Record<PanelButtonStyle, string> = {
  primary: '#5865F2',
  secondary: '#4E5058',
  success: '#248046',
  danger: '#DA373C',
}

export function PanelPreview({
  panel,
  categories,
}: {
  panel: PanelSettings
  categories: PanelPreviewCategory[]
}) {
  const accent = panel.accentColor || PANEL_DEFAULT_ACCENT
  const title = panel.title || PANEL_DEFAULT_TITLE
  const body = panel.body || PANEL_DEFAULT_BODY
  const buttonColor = BUTTON_COLORS[panel.buttonStyle ?? 'primary']
  // The bot falls back to one generic button when a team has no categories.
  const cats: PanelPreviewCategory[] =
    categories.length > 0
      ? categories.slice(0, 5)
      : [{ key: 'support', label: 'Open a ticket', emoji: '🎫', description: null }]
  const described = panel.showCategoryDescriptions ? cats.filter((c) => c.description) : []

  return (
    <div className="space-y-2 overflow-hidden rounded-md bg-[#313338] p-3 sm:p-4">
      <div
        className="rounded-lg border-l-4 bg-[#2b2d31] p-3 sm:p-4"
        style={{ borderLeftColor: accent }}
      >
        <p className="break-words text-base font-bold text-white">{title}</p>
        <div className="my-2 border-t border-[#3f4147]" />
        <p className="whitespace-pre-line break-words text-sm text-[#dbdee1]">{body}</p>
        {described.length > 0 && (
          <div className="mt-2 space-y-0.5 text-sm text-[#dbdee1]">
            {described.map((c) => (
              <p key={c.key} className="break-words">
                <span className="font-semibold">{c.label}</span> — {c.description}
              </p>
            ))}
          </div>
        )}
        {panel.imageUrl && panel.imageUrl.startsWith('https://') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={panel.imageUrl}
            alt="Panel image"
            className="mt-2 max-h-40 max-w-full rounded-md"
            loading="lazy"
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1.5 rounded-[3px] px-4 py-1.5 text-sm font-medium text-white"
            style={{ backgroundColor: buttonColor }}
          >
            {c.emoji && <span aria-hidden>{c.emoji}</span>}
            <span className="max-w-[16ch] truncate">{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
