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

const categorySchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, _ and -'),
  label: z.string().min(1).max(80),
  emoji: z.string().max(8).optional(),
  description: z.string().max(200).optional(),
  sortOrder: z.string().regex(/^-?\d+$/).optional(),
  discordParentCategoryId: snowflake.optional().or(z.literal('')),
  discordClosedCategoryId: snowflake.optional().or(z.literal('')),
})

export async function addCategoryAction(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const parsed = categorySchema.safeParse({
    key: String(formData.get('key') ?? '').trim().toLowerCase(),
    label: String(formData.get('label') ?? '').trim(),
    emoji: String(formData.get('emoji') ?? '').trim() || undefined,
    description: String(formData.get('description') ?? '').trim() || undefined,
    sortOrder: String(formData.get('sortOrder') ?? '').trim() || undefined,
    discordParentCategoryId: String(formData.get('discordParentCategoryId') ?? '').trim() || undefined,
    discordClosedCategoryId: String(formData.get('discordClosedCategoryId') ?? '').trim() || undefined,
  })
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
  })

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
