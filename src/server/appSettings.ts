import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { appSettings } from '@/db/schema'

// Thin accessors over the app_settings key/value store (bot-owner global
// settings; see src/db/schema/appSettings.ts).

export async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  return row?.value ?? null
}

export async function setAppSetting(key: string, value: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    })
}
