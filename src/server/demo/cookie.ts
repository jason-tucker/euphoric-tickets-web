// Reads the active demo persona from the `demo_persona` cookie. The cookie is a
// pure UI-state selector (which synthetic viewer to render as) — it carries no
// secret and is never read by any real/authenticated code path. Default is the
// end-user persona.

import { cookies } from 'next/headers'
import type { PersonaKey } from './data'
import { isPersonaKey } from './meta'

export const PERSONA_COOKIE = 'demo_persona'

export async function getPersonaKey(): Promise<PersonaKey> {
  const v = (await cookies()).get(PERSONA_COOKIE)?.value
  return isPersonaKey(v) ? v : 'enduser'
}
