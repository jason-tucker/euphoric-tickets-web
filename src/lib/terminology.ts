// Single source of truth for the business / client UI noun. Pulled from
// `businesses.terminology` (`'business' | 'client'`, default `'business'`).
//
// `client`-mode is for tenants that are actually client relationships
// (agencies, freelancers, retainers) — the schema is identical, only the
// labels change.

export type Terminology = 'business' | 'client'

export function nounSingular(t: Terminology): string {
  return t === 'client' ? 'client' : 'business'
}

export function nounPlural(t: Terminology): string {
  return t === 'client' ? 'clients' : 'businesses'
}

export function titleSingular(t: Terminology): string {
  return t === 'client' ? 'Client' : 'Business'
}

export function titlePlural(t: Terminology): string {
  return t === 'client' ? 'Clients' : 'Businesses'
}
