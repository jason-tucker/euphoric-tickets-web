'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories } from '@/db/schema'
import { requireBusinessAccess } from '@/server/permissions'

const snowflake = z.string().regex(/^\d{17,20}$/, 'Not a valid Discord snowflake')

const settingsSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  discordGuildId: snowflake,
  adminRoleIds: z.string().regex(/^(\d{17,20})?(,\s*\d{17,20})*$/, 'Comma-separated snowflakes only').optional(),
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://discord.com/api/webhooks/', 'Must be a Discord webhook URL')
    .optional()
    .or(z.literal('')),
  discordFallbackCategoryId: snowflake.optional().or(z.literal('')),
  discordClosedCategoryId: snowflake.optional().or(z.literal('')),
  deleteClosedAfterDays: z.string().regex(/^\d+$/).optional().or(z.literal('')),
  terminology: z.enum(['business', 'client']),
})

export async function saveBusinessSettings(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const raw = {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    discordGuildId: String(formData.get('discordGuildId') ?? ''),
    adminRoleIds: String(formData.get('adminRoleIds') ?? '').trim(),
    webhookUrl: String(formData.get('webhookUrl') ?? '').trim(),
    discordFallbackCategoryId: String(formData.get('discordFallbackCategoryId') ?? '').trim(),
    discordClosedCategoryId: String(formData.get('discordClosedCategoryId') ?? '').trim(),
    deleteClosedAfterDays: String(formData.get('deleteClosedAfterDays') ?? '').trim(),
    terminology: (formData.get('terminology') === 'client' ? 'client' : 'business') as 'business' | 'client',
  }

  const parsed = settingsSchema.safeParse({
    ...raw,
    description: raw.description || undefined,
    webhookUrl: raw.webhookUrl || undefined,
    adminRoleIds: raw.adminRoleIds || undefined,
    discordFallbackCategoryId: raw.discordFallbackCategoryId || undefined,
    discordClosedCategoryId: raw.discordClosedCategoryId || undefined,
    deleteClosedAfterDays: raw.deleteClosedAfterDays || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db
    .update(businesses)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      discordGuildId: parsed.data.discordGuildId,
      adminRoleIds: parsed.data.adminRoleIds ?? '',
      webhookUrl: parsed.data.webhookUrl ?? null,
      discordFallbackCategoryId: parsed.data.discordFallbackCategoryId ?? null,
      discordClosedCategoryId: parsed.data.discordClosedCategoryId ?? null,
      deleteClosedAfterDays: parsed.data.deleteClosedAfterDays
        ? Number(parsed.data.deleteClosedAfterDays)
        : null,
      terminology: parsed.data.terminology,
      updatedAt: sql`now()`,
    })
    .where(eq(businesses.id, business.id))

  revalidatePath(`/b/${slug}`)
  revalidatePath(`/b/${slug}/settings`)
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
    })
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, business.id)))

  revalidatePath(`/b/${slug}/settings`)
  revalidatePath('/t/new')
}

export async function deleteCategoryAction(slug: string, categoryId: string): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  await db
    .delete(ticketCategories)
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, business.id)))

  revalidatePath(`/b/${slug}/settings`)
  revalidatePath('/t/new')
}
