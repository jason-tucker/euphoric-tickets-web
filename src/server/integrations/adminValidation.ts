// Input validation for the sudo-only /admin/integrations actions. Pure (no DB)
// so it is unit-testable; the actions add the DB-dependent checks.

import { z } from 'zod'
import { integrationScopes } from '@/db/schema'
import { normalizeWebhookUrl, validateExpectedCidr } from './webhookSsrf'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/
const CATEGORY_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/

// An exact https origin (scheme://host[:port]) with nothing after it.
export function parseLinkOrigin(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  return u.origin === v.replace(/\/$/, '') ? u.origin : null
}

export function parseCsvKeys(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))]
}

export const integrationSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'no control characters'),
  scopes: z.array(z.enum(integrationScopes)).max(integrationScopes.length),
  allowedCategoryKeys: z.array(z.string().regex(CATEGORY_KEY_RE, 'bad category key')).max(50),
  linkOrigin: z.string().nullable(),
  actorImpersonation: z.boolean(),
})

export const createIntegrationSchema = integrationSettingsSchema.extend({
  businessId: z.string().uuid(),
  slug: z.string().regex(SLUG_RE, 'lowercase letters, digits and hyphens (2-40 chars)'),
})

export function readSettingsForm(formData: FormData) {
  const originRaw = String(formData.get('linkOrigin') ?? '').trim()
  return {
    name: String(formData.get('name') ?? ''),
    scopes: formData.getAll('scopes').map(String),
    allowedCategoryKeys: parseCsvKeys(String(formData.get('allowedCategoryKeys') ?? '')),
    // '' → null (no link allowed); anything unparseable → a value that fails below.
    linkOrigin: originRaw ? (parseLinkOrigin(originRaw) ?? '__invalid__') : null,
    actorImpersonation: formData.get('actorImpersonation') != null,
  }
}

export function checkLinkOrigin(v: string | null): string | null {
  return v === '__invalid__' ? 'Link origin must be an exact https origin, e.g. https://music.euphoric.fm' : null
}

export const allowlistRowSchema = z.object({
  scheme: z.enum(['http', 'https']),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$|^[0-9a-f:.]+$/, 'bad host'),
  port: z.coerce.number().int().min(1).max(65535),
  path: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^\/[A-Za-z0-9._~\/-]*$/, 'path must start with / and contain no query or fragment'),
  expectedNetworkCidr: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const err = validateExpectedCidr(v)
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
    }),
})

export type AllowlistRowInput = z.infer<typeof allowlistRowSchema>

// The canonical URL an allowlist row permits (for display / quick fill).
export function allowlistRowUrl(r: { scheme: string; host: string; port: number; path: string }): string {
  const host = r.host.includes(':') ? `[${r.host}]` : r.host
  return `${r.scheme}://${host}:${r.port}${r.path}`
}

// Save-time webhook URL check: well-formed AND equal to an allowlist row.
export function checkWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const t = normalizeWebhookUrl(raw.trim())
  if (!t) return { ok: false, error: 'Not a valid http(s) URL (no credentials, query or fragment).' }
  return { ok: true, url: raw.trim() }
}
