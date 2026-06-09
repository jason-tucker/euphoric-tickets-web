'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSudo } from '@/server/sudo'
import { setAppSetting } from '@/server/appSettings'
import { leaveGuild, setBotUsername } from '@/server/botControl'

function backWith(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString()
  redirect(`/admin/bot${qs ? `?${qs}` : ''}`)
}

// Persist the bot name and push it to Discord as the bot's username. The
// app_settings value is saved regardless; only the Discord push can fail
// (rate limit), and we surface that as a warning rather than losing the name.
export async function setBotNameAction(formData: FormData): Promise<void> {
  await requireSudo()
  const name = String(formData.get('botName') ?? '').trim()
  if (name.length < 2 || name.length > 32) {
    backWith({ warn: 'Bot name must be 2–32 characters.' })
  }

  await setAppSetting('bot_name', name)
  const pushed = await setBotUsername(name)
  revalidatePath('/admin/bot')

  if (!pushed.ok) {
    backWith({ warn: `Saved the name, but Discord rejected the username change: ${pushed.error}` })
  }
  backWith({ ok: `Bot name set to “${name}”.` })
}

// Force the bot to leave a guild. Bound with the guildId from the form button.
export async function leaveGuildAction(guildId: string): Promise<void> {
  await requireSudo()
  if (!/^\d{17,20}$/.test(guildId)) {
    backWith({ warn: 'Invalid server id.' })
  }
  const result = await leaveGuild(guildId)
  revalidatePath('/admin/bot')

  if (!result.ok) {
    backWith({ warn: `Couldn't leave the server: ${result.error}` })
  }
  backWith({ ok: 'Bot left the server.' })
}
