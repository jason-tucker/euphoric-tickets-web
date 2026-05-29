'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses } from '@/db/schema'
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
