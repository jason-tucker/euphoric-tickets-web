'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses } from '@/db/schema'
import { requireSudo } from '@/server/sudo'

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits, and hyphens; cannot start or end with a hyphen'),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  discordGuildId: z.string().regex(/^\d{17,20}$/, 'Not a valid Discord snowflake'),
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://discord.com/api/webhooks/', 'Must be a Discord webhook URL')
    .optional()
    .or(z.literal('')),
})

export async function createBusinessAction(formData: FormData): Promise<void> {
  await requireSudo()

  const raw = {
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    discordGuildId: String(formData.get('discordGuildId') ?? '').trim(),
    webhookUrl: String(formData.get('webhookUrl') ?? '').trim(),
  }

  const parsed = createSchema.safeParse({
    ...raw,
    description: raw.description || undefined,
    webhookUrl: raw.webhookUrl || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  await db.insert(businesses).values({
    slug: parsed.data.slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    discordGuildId: parsed.data.discordGuildId,
    webhookUrl: parsed.data.webhookUrl ?? null,
  })

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  redirect(`/b/${parsed.data.slug}`)
}
