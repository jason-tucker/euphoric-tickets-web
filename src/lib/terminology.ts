// Single source of truth for the team / client UI noun. Pulled from
// `businesses.terminology` (the enum value stays `'business' | 'client'` in
// the DB for back-compat, but the default surface noun is now "team").
//
// `client`-mode is for tenants that are actually client relationships
// (agencies, freelancers, retainers) — the schema is identical, only the
// labels change.

export type Terminology = 'business' | 'client'

export function nounSingular(t: Terminology): string {
  return t === 'client' ? 'client' : 'team'
}

export function nounPlural(t: Terminology): string {
  return t === 'client' ? 'clients' : 'teams'
}

export function titleSingular(t: Terminology): string {
  return t === 'client' ? 'Client' : 'Team'
}

export function titlePlural(t: Terminology): string {
  return t === 'client' ? 'Clients' : 'Teams'
}
