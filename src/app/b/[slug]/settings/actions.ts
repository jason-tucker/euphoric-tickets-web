'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories } from '@/db/schema'
import { requireBusinessAccess } from '@/server/permissions'

const settingsSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  discordGuildId: z.string().regex(/^\d{17,20}$/, 'Not a valid Discord snowflake'),
  adminRoleIds: z.string().regex(/^(\d{17,20})?(,\s*\d{17,20})*$/, 'Comma-separated snowflakes only').optional(),
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://discord.com/api/webhooks/', 'Must be a Discord webhook URL')
    .optional()
    .or(z.literal('')),
})

export async function saveBusinessSettings(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const raw = {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    discordGuildId: String(formData.get('discordGuildId') ?? ''),
    adminRoleIds: String(formData.get('adminRoleIds') ?? '').trim(),
    webhookUrl: String(formData.get('webhookUrl') ?? '').trim(),
  }

  const parsed = settingsSchema.safeParse({
    ...raw,
    description: raw.description || undefined,
    webhookUrl: raw.webhookUrl || undefined,
    adminRoleIds: raw.adminRoleIds || undefined,
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
})

export async function addCategoryAction(slug: string, formData: FormData): Promise<void> {
  const { business } = await requireBusinessAccess(slug, 'admin')

  const parsed = categorySchema.safeParse({
    key: String(formData.get('key') ?? '').trim().toLowerCase(),
    label: String(formData.get('label') ?? '').trim(),
    emoji: String(formData.get('emoji') ?? '').trim() || undefined,
    description: String(formData.get('description') ?? '').trim() || undefined,
    sortOrder: String(formData.get('sortOrder') ?? '').trim() || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db.insert(ticketCategories).values({
    businessId: business.id,
    key: parsed.data.key,
    label: parsed.data.label,
    emoji: parsed.data.emoji ?? null,
    description: parsed.data.description ?? null,
    sortOrder: parsed.data.sortOrder ?? '0',
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
