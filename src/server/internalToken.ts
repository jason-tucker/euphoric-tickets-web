// The web↔bot internal channel's shared secret (plan §4.6 step 5, P1c).
//
// Every internal call in either direction (`x-internal-token`) authenticates
// with a dedicated INTERNAL_TOKEN only. There is deliberately NO fallback to
// DISCORD_BOT_TOKEN: the bot token must never become an HTTP shared secret or
// travel on the wire. A missing or short token is a configuration error —
// src/instrumentation.ts refuses to boot on it, and every call site fails
// closed if it somehow reaches runtime anyway.
//
// No `server-only` import here: src/instrumentation.ts loads this at boot,
// outside the react-server condition. The module holds no secret itself.

export const INTERNAL_TOKEN_MIN_LENGTH = 32

export class InternalTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InternalTokenError'
  }
}

// Returns INTERNAL_TOKEN, or throws InternalTokenError when it is missing or
// shorter than INTERNAL_TOKEN_MIN_LENGTH. The message never contains the value.
export function getInternalToken(): string {
  const token = process.env.INTERNAL_TOKEN
  if (!token) {
    throw new InternalTokenError('INTERNAL_TOKEN is not set (required for the web↔bot internal channel)')
  }
  if (token.length < INTERNAL_TOKEN_MIN_LENGTH) {
    throw new InternalTokenError(
      `INTERNAL_TOKEN is too short: it needs at least ${INTERNAL_TOKEN_MIN_LENGTH} characters (got ${token.length})`,
    )
  }
  return token
}

// Non-throwing variant for best-effort callers: the token, or null (with the
// reason logged) when it is invalid. Callers must treat null as "do not call".
export function internalTokenOrNull(context: string): string | null {
  try {
    return getInternalToken()
  } catch (err) {
    console.error(`[${context}] ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
