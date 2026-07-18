'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories, tickets } from '@/db/schema'
import { requireBusinessAccess } from '@/server/permissions'
import { reconcileTicketTool } from '@/server/tickettool'
import { postBot } from '@/server/botControl'

const snowflake = z.string().regex(/^\d{17,20}$/, 'Not a valid Discord snowflake')

const settingsSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  discordGuildId: snowflake,
  adminRoleIds: z.string().regex(/^(\d{17,20})?(,\s*\d{17,20})*$/, 'Comma-separated snowflakes only').optional(),
  staffRoleIds: z.string().regex(/^(\d{17,20})?(,\s*\d{17,20})*$/, 'Comma-separated snowflakes only').optional(),
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://discord.com/api/webhooks/', 'Must be a Discord webhook URL')
    .optional()
    .or(z.literal('')),
  discordFallbackCategoryId: snowflake.optional().or(z.literal('')),
  discordClosedCategoryId: snowflake.optional().or(z.literal('')),
  deleteClosedAfterDays: z.string().regex(/^\d+$/).optional().or(z.literal('')),
  // Which ticket system this team runs.
  ticketMode: z.enum(['euphoric', 'tickettool']).optional(),
  // TicketTool coexistence: CSV of GUILD_CATEGORY snowflakes to watch (empty
  // = off) + the prefix that server's TicketTool uses for its commands.
  ticketToolCategoryIds: z
    .string()
    .regex(/^$|^(\d{17,20})(,\s*\d{17,20})*$/, 'Comma-separated Discord category snowflakes only')
    .optional(),
  ticketToolPrefix: z.string().min(1).max(5).optional(),
})

export async function saveBusinessSettings(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const raw = {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    discordGuildId: String(formData.get('discordGuildId') ?? ''),
    adminRoleIds: String(formData.get('adminRoleIds') ?? '').trim(),
    staffRoleIds: String(formData.get('staffRoleIds') ?? '').trim(),
    webhookUrl: String(formData.get('webhookUrl') ?? '').trim(),
    discordFallbackCategoryId: String(formData.get('discordFallbackCategoryId') ?? '').trim(),
    discordClosedCategoryId: String(formData.get('discordClosedCategoryId') ?? '').trim(),
    deleteClosedAfterDays: String(formData.get('deleteClosedAfterDays') ?? '').trim(),
    ticketMode: (formData.get('ticketMode') === 'tickettool' ? 'tickettool' : 'euphoric') as 'euphoric' | 'tickettool',
    ticketToolCategoryIds: String(formData.get('ticketToolCategoryIds') ?? '').trim().replace(/\s+/g, ''),
    ticketToolPrefix: String(formData.get('ticketToolPrefix') ?? '').trim(),
  }

  const parsed = settingsSchema.safeParse({
    ...raw,
    description: raw.description || undefined,
    webhookUrl: raw.webhookUrl || undefined,
    adminRoleIds: raw.adminRoleIds || undefined,
    staffRoleIds: raw.staffRoleIds || undefined,
    discordFallbackCategoryId: raw.discordFallbackCategoryId || undefined,
    discordClosedCategoryId: raw.discordClosedCategoryId || undefined,
    deleteClosedAfterDays: raw.deleteClosedAfterDays || undefined,
    ticketToolCategoryIds: raw.ticketToolCategoryIds || undefined,
    ticketToolPrefix: raw.ticketToolPrefix || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db
    .update(businesses)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      discordGuildId: parsed.data.discordGuildId,
      adminRoleIds: parsed.data.adminRoleIds ?? '',
      staffRoleIds: parsed.data.staffRoleIds ?? '',
      webhookUrl: parsed.data.webhookUrl ?? null,
      discordFallbackCategoryId: parsed.data.discordFallbackCategoryId ?? null,
      discordClosedCategoryId: parsed.data.discordClosedCategoryId ?? null,
      deleteClosedAfterDays: parsed.data.deleteClosedAfterDays
        ? Number(parsed.data.deleteClosedAfterDays)
        : null,
      ticketMode: parsed.data.ticketMode ?? 'euphoric',
      ticketToolCategoryIds: parsed.data.ticketToolCategoryIds ?? '',
      ticketToolPrefix: parsed.data.ticketToolPrefix ?? '$',
      updatedAt: sql`now()`,
    })
    .where(eq(businesses.id, business.id))

  // If this team is on TicketTool with categories set, ask the bot to back-grab
  // any already-open TicketTool tickets under those categories now (so linking a
  // category surfaces existing tickets immediately). Best-effort.
  if (parsed.data.ticketMode === 'tickettool' && (parsed.data.ticketToolCategoryIds ?? '') !== '') {
    await reconcileTicketTool(business.id)
  }

  revalidatePath(`/b/${slug}`)
  revalidatePath(`/b/${slug}/settings`)
}

// businesses.settings.panel — the JSONB contract the bot reads to render
// panels (/panel post + refresh). All fields optional; unset = bot default.
const panelSchema = z.object({
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Accent color must be #rrggbb').optional(),
  title: z.string().min(1).max(100).optional(),
  body: z.string().min(1).max(1000).optional(),
  imageUrl: z
    .string()
    .max(512)
    .url()
    .startsWith('https://', 'Image URL must be https')
    .optional(),
  buttonStyle: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
  showCategoryDescriptions: z.boolean().optional(),
})

// The bot's hardcoded panel defaults (ticketRenderer.ts) — values equal to
// these are dropped so an untouched form stores no panel key at all.
const PANEL_DEFAULTS = {
  accentColor: '#a855f7',
  title: '🎫 Open a Ticket',
  body: 'Need help? Pick a category below to open a private ticket with the staff team.\nOnly you and staff will see the channel.',
}

// Bridge to the bot's internal HTTP — shared transport in botControl. Short
// timeout: the settings page shouldn't hang on a dead bot.
async function postPanelBridge(
  path: string,
  body: Record<string, string>,
): Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false; error: string }> {
  return postBot(path, body, { timeoutMs: 4000 })
}

export async function savePanelSettingsAction(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  // Textareas submit CRLF — normalize so the default-body comparison holds.
  const raw = {
    accentColor: String(formData.get('accentColor') ?? '').trim().toLowerCase(),
    title: String(formData.get('title') ?? '').trim(),
    body: String(formData.get('body') ?? '').replace(/\r\n/g, '\n').trim(),
    imageUrl: String(formData.get('imageUrl') ?? '').trim(),
    buttonStyle: String(formData.get('buttonStyle') ?? 'primary'),
    showCategoryDescriptions: formData.get('showCategoryDescriptions') != null,
  }

  const parsed = panelSchema.safeParse({
    accentColor: raw.accentColor && raw.accentColor !== PANEL_DEFAULTS.accentColor ? raw.accentColor : undefined,
    title: raw.title && raw.title !== PANEL_DEFAULTS.title ? raw.title : undefined,
    body: raw.body && raw.body !== PANEL_DEFAULTS.body ? raw.body : undefined,
    imageUrl: raw.imageUrl || undefined,
    buttonStyle: raw.buttonStyle !== 'primary' ? raw.buttonStyle : undefined,
    showCategoryDescriptions: raw.showCategoryDescriptions || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  const panel = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  )
  const settings: Record<string, unknown> = { ...business.settings }
  if (Object.keys(panel).length > 0) settings.panel = panel
  else delete settings.panel

  await db
    .update(businesses)
    .set({ settings, updatedAt: sql`now()` })
    .where(eq(businesses.id, business.id))

  revalidatePath(`/b/${slug}/settings`)

  // Best-effort: ask the bot to re-render every posted panel now. A dead
  // bridge only delays the refresh until someone runs /panel refresh.
  const refresh = await postPanelBridge('/api/internal/panel/refresh', { businessId: business.id })
  if (!refresh.ok) {
    redirect(
      `/b/${slug}/settings?warn=${encodeURIComponent('Saved — panels will refresh when the bot next runs /panel refresh.')}`,
    )
  }
  // The endpoint 200s even when individual panel edits failed (message or
  // channel deleted) — read the counts so the flash doesn't overpromise.
  const done = Number(refresh.data?.refreshed ?? 0)
  const failed = Number(refresh.data?.failed ?? 0)
  if (failed > 0) {
    redirect(
      `/b/${slug}/settings?warn=${encodeURIComponent(
        `Panel saved — refreshed ${done} panel${done === 1 ? '' : 's'}, but ${failed} couldn't be updated (message or channel gone). Re-post those with /panel post.`,
      )}`,
    )
  }
  redirect(
    `/b/${slug}/settings?ok=${encodeURIComponent(
      done > 0 ? `Panel saved — ${done} posted panel${done === 1 ? '' : 's'} refreshed.` : 'Panel saved.',
    )}`,
  )
}

export async function postPanelAction(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const back = (params: Record<string, string>): never => {
    redirect(`/b/${slug}/settings?${new URLSearchParams(params).toString()}`)
  }

  const channelId = String(formData.get('channelId') ?? '').trim()
  if (!/^\d{17,20}$/.test(channelId)) back({ warn: 'Pick a channel first.' })

  const result = await postPanelBridge('/api/internal/panel/post', {
    businessId: business.id,
    channelId,
  })
  if (!result.ok) back({ warn: `Couldn't post the panel: ${result.error}` })

  back({ ok: 'Panel posted — ticket buttons work even in read-only channels.' })
}

// CSV of Discord role snowflakes — empty string allowed (means "inherit").
const roleCsv = z
  .string()
  .regex(/^$|^(\d{17,20})(,\s*\d{17,20})*$/, 'Comma-separated Discord role snowflakes only')

const categorySchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, _ and -'),
  label: z.string().min(1).max(80),
  emoji: z.string().max(8).optional(),
  description: z.string().max(200).optional(),
  sortOrder: z.string().regex(/^-?\d+$/).optional(),
  discordParentCategoryId: snowflake.optional().or(z.literal('')),
  discordClosedCategoryId: snowflake.optional().or(z.literal('')),
  // P1 (lantern): per-category permission tiers.
  allowRoleIds: roleCsv.optional(),
  staffRoleIds: roleCsv.optional(),
  // P1 (lantern, used by bot in P4): optional template for the first message
  // in newly-opened tickets of this category.
  firstMessageTemplate: z.string().max(2000).optional(),
  // Staff-only destination — hidden from the open-ticket flow (web + bot),
  // but still selectable in the staff change-category dropdown.
  staffOnly: z.boolean().optional(),
  // Default ticket kind for tickets opened in this category. Replaces the
  // per-ticket Type picker that used to live on /t/new.
  kind: z.enum(['normal', 'project']).optional(),
})

// Pulls the shared category fields out of a FormData and normalises blanks.
function readCategoryFields(formData: FormData) {
  const norm = (k: string) => {
    const v = String(formData.get(k) ?? '').trim()
    return v.length > 0 ? v : undefined
  }
  return {
    key: String(formData.get('key') ?? '').trim().toLowerCase(),
    label: String(formData.get('label') ?? '').trim(),
    emoji: norm('emoji'),
    description: norm('description'),
    sortOrder: norm('sortOrder'),
    discordParentCategoryId: norm('discordParentCategoryId'),
    discordClosedCategoryId: norm('discordClosedCategoryId'),
    allowRoleIds: String(formData.get('allowRoleIds') ?? '').trim().replace(/\s+/g, ''),
    staffRoleIds: String(formData.get('staffRoleIds') ?? '').trim().replace(/\s+/g, ''),
    firstMessageTemplate: norm('firstMessageTemplate'),
    staffOnly: formData.get('staffOnly') != null,
    kind: (formData.get('kind') === 'project' ? 'project' : 'normal') as 'normal' | 'project',
  }
}

export async function addCategoryAction(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const raw = readCategoryFields(formData)
  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db.insert(ticketCategories).values({
    businessId: business.id,
    key: parsed.data.key,
    label: parsed.data.label,
    emoji: parsed.data.emoji ?? null,
    description: parsed.data.description ?? null,
    sortOrder: parsed.data.sortOrder ?? '0',
    discordParentCategoryId: parsed.data.discordParentCategoryId ?? null,
    discordClosedCategoryId: parsed.data.discordClosedCategoryId ?? null,
    allowRoleIds: parsed.data.allowRoleIds ?? '',
    staffRoleIds: parsed.data.staffRoleIds ?? '',
    firstMessageTemplate: parsed.data.firstMessageTemplate ?? null,
    staffOnly: parsed.data.staffOnly ?? false,
    kind: parsed.data.kind ?? 'normal',
  })

  revalidatePath(`/b/${slug}/settings`)
  revalidatePath('/t/new')
}

export async function updateCategoryAction(
  slug: string,
  categoryId: string,
  formData: FormData,
): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const raw = readCategoryFields(formData)
  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db
    .update(ticketCategories)
    .set({
      key: parsed.data.key,
      label: parsed.data.label,
      emoji: parsed.data.emoji ?? null,
      description: parsed.data.description ?? null,
      sortOrder: parsed.data.sortOrder ?? '0',
      discordParentCategoryId: parsed.data.discordParentCategoryId ?? null,
      discordClosedCategoryId: parsed.data.discordClosedCategoryId ?? null,
      allowRoleIds: parsed.data.allowRoleIds ?? '',
      staffRoleIds: parsed.data.staffRoleIds ?? '',
      firstMessageTemplate: parsed.data.firstMessageTemplate ?? null,
      staffOnly: parsed.data.staffOnly ?? false,
      kind: parsed.data.kind ?? 'normal',
    })
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, business.id)))

  revalidatePath(`/b/${slug}/settings`)
  revalidatePath('/t/new')
}

export async function deleteCategoryAction(slug: string, categoryId: string): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  // Defensive: the queries below are already business-scoped, but reject a
  // malformed id outright (consistent with the UUID checks elsewhere).
  if (!/^[0-9a-f-]{36}$/i.test(categoryId)) {
    revalidatePath(`/b/${slug}/settings`)
    return
  }

  // Tickets reference the category via a RESTRICT FK, so deleting a category
  // that still has tickets throws. Orphan those tickets first (categoryId is
  // nullable). Notification prefs cascade-delete on their own.
  await db
    .update(tickets)
    .set({ categoryId: null })
    .where(and(eq(tickets.categoryId, categoryId), eq(tickets.businessId, business.id)))

  await db
    .delete(ticketCategories)
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, business.id)))

  revalidatePath(`/b/${slug}/settings`)
  revalidatePath('/t/new')
}
