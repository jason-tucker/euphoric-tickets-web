import { z } from 'zod'

const SNOWFLAKE_RE = /^\d{17,20}$/

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.enum(['true', 'false']).optional().default('true'),
  AUTH_DISCORD_ID: z.string().regex(SNOWFLAKE_RE),
  AUTH_DISCORD_SECRET: z.string().min(10),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
})

// Coerce empty strings → undefined (a fresh .env copy often has them).
for (const k of ['AUTH_URL']) {
  if (process.env[k] === '') delete process.env[k]
}

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  // Don't crash in build-time bundling; only crash at runtime.
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'postgresql://placeholder/placeholder') {
    process.exit(1)
  }
}

export const env = (parsed.success ? parsed.data : (process.env as never)) as z.infer<typeof schema>
