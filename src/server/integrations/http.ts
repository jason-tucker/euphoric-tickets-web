// Small HTTP helpers shared by the /api/v1/* route handlers.

import type { ZodError } from 'zod'

export const MAX_API_BODY_BYTES = 32 * 1024

export function apiJson(status: number, body: unknown, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(headers ?? {}) } })
}

export function apiError(status: number, code: string, headers?: Record<string, string>, extra?: Record<string, unknown>): Response {
  return apiJson(status, { error: code, ...(extra ?? {}) }, headers)
}

export function validationError(err: ZodError): Response {
  const issues = err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }))
  return apiError(422, 'validation', undefined, { issues })
}

export class BodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

// Read a JSON body with a hard byte cap (streamed, so an oversized body is cut
// off rather than buffered). Throws BodyError(413|415|422).
export async function readJsonBody(req: Request, maxBytes = MAX_API_BODY_BYTES): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? ''
  if (!/^application\/json\b/i.test(ct)) throw new BodyError(415, 'unsupported_media_type')
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(413, 'payload_too_large')
  if (!req.body) throw new BodyError(422, 'validation')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyError(413, 'payload_too_large')
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BodyError(422, 'validation')
  }
}

// `/api/v1/tickets/:id` path segment → ticket id, or null (→ 404).
export function parseTicketId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null
  const n = Number(raw)
  return n <= 2_147_483_647 ? n : null
}

// Header names that must never reach a log line.
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-internal-token', 'proxy-authorization'])

// Loggable view of request headers with credentials redacted. Integration
// code never logs raw headers; use this if request context must be logged.
export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value
  })
  return out
}

// Error → coarse class for logs (never the message: it can echo URLs/bodies).
export function errorClass(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout'
    return err.name || 'Error'
  }
  return 'unknown'
}
