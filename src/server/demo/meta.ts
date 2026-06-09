// Client-safe persona metadata. Contains ONLY plain data + a type-only import,
// so client components can import it without dragging the demo data generator
// into the browser bundle.

import type { PersonaKey } from './data'

export type { PersonaKey } from './data'

export const PERSONA_KEYS: PersonaKey[] = ['enduser', 'staff', 'admin', 'sudo']

export function isPersonaKey(v: string | undefined | null): v is PersonaKey {
  return !!v && (PERSONA_KEYS as string[]).includes(v)
}

export const PERSONA_META: Record<PersonaKey, { label: string; blurb: string }> = {
  enduser: { label: 'End user', blurb: 'A regular member — sees only the tickets they opened. No staff or admin tools.' },
  staff: { label: 'Staff', blurb: 'Holds staff roles on a few teams — works the queues they staff, but no settings or admin.' },
  admin: { label: 'Admin', blurb: 'Manages a whole Discord server’s teams — full queues plus team settings.' },
  sudo: { label: 'Sudo (owner)', blurb: 'Bot owner — sees every team and the sudo bot dashboards.' },
}
