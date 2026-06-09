'use client'

// The demo's per-browser write layer. Every "change" a visitor makes in the demo
// — sending a reply, claiming/closing/assigning, editing settings, opening a new
// ticket — is recorded here and persisted to localStorage, so it survives reloads
// and return visits. NOTHING here touches the server, the database, or Discord:
// it's a sandbox layered on top of the deterministic read-only base data. That's
// what keeps the demo interactive while remaining incapable of changing anything
// real.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { DemoTicket } from '@/server/demo/personas'
import type { DemoMessage } from '@/server/demo/detail'
import type { DemoBusiness, DemoCategory } from '@/server/demo/data'

export type TicketPatch = {
  status?: string
  subject?: string
  categoryId?: string | null
  categoryLabel?: string | null
  categoryEmoji?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  assigneeImage?: string | null
  closedAt?: string | null
  updatedAt?: string
}

export type CategoryOps = {
  added: DemoCategory[]
  edited: Record<string, Partial<DemoCategory>>
  deleted: string[]
}

export type DemoOverlay = {
  v: number
  nextTicketId: number
  ticketPatches: Record<number, TicketPatch>
  messages: Record<number, DemoMessage[]>
  internalNotes: Record<number, DemoMessage[]>
  newTickets: DemoTicket[]
  settings: Record<string, Partial<DemoBusiness>>
  categoryOps: Record<string, CategoryOps>
  appSettings: { botName?: string }
}

const STORAGE_KEY = 'euphoric-demo-overlay-v1'
const FIRST_OVERLAY_ID = 1_000_000

export const EMPTY_OVERLAY: DemoOverlay = {
  v: 1,
  nextTicketId: FIRST_OVERLAY_ID,
  ticketPatches: {},
  messages: {},
  internalNotes: {},
  newTickets: [],
  settings: {},
  categoryOps: {},
  appSettings: {},
}

// ─── pure merge helpers (overlay is passed in; usable anywhere) ──────────────

export function mergeTicket(base: DemoTicket, overlay: DemoOverlay): DemoTicket {
  const patch = overlay.ticketPatches[base.id]
  const msgs = overlay.messages[base.id]
  const t: DemoTicket = { ...base }
  if (patch) {
    if (patch.status !== undefined) t.status = patch.status
    if (patch.subject !== undefined) t.subject = patch.subject
    if (patch.categoryId !== undefined) {
      t.categoryId = patch.categoryId
      t.categoryLabel = patch.categoryLabel ?? t.categoryLabel
      t.categoryEmoji = patch.categoryEmoji ?? t.categoryEmoji
    }
    if ('assigneeId' in patch) {
      t.assigneeId = patch.assigneeId ?? null
      t.assigneeName = patch.assigneeName ?? null
      t.assigneeImage = patch.assigneeImage ?? null
    }
    if (patch.closedAt !== undefined) t.closedAt = patch.closedAt
    if (t.status === 'closed' && !t.closedAt) t.closedAt = patch.updatedAt ?? new Date().toISOString()
    if (t.status !== 'closed') t.closedAt = null
  }
  let lastMs = Date.parse(t.lastActivityAt)
  if (patch?.updatedAt) lastMs = Math.max(lastMs, Date.parse(patch.updatedAt))
  if (msgs && msgs.length) lastMs = Math.max(lastMs, Date.parse(msgs[msgs.length - 1].createdAt))
  if (Number.isFinite(lastMs)) t.lastActivityAt = new Date(lastMs).toISOString()
  return t
}

// Merge a base ticket list with the overlay: patch existing rows, fold in any
// new tickets, and re-sort by last activity (newest first).
export function mergeTicketList(base: DemoTicket[], overlay: DemoOverlay): DemoTicket[] {
  const byId = new Map<number, DemoTicket>()
  for (const t of base) byId.set(t.id, mergeTicket(t, overlay))
  for (const nt of overlay.newTickets) byId.set(nt.id, mergeTicket(nt, overlay))
  return [...byId.values()].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
}

export function mergeMessages(base: DemoMessage[], extra: DemoMessage[] | undefined): DemoMessage[] {
  const all = extra && extra.length ? [...base, ...extra] : base
  return [...all].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function mergedCategories(team: { categories: DemoCategory[] }, ops: CategoryOps | undefined): DemoCategory[] {
  if (!ops) return team.categories
  const deleted = new Set(ops.deleted)
  const out = team.categories
    .filter((c) => !deleted.has(c.id))
    .map((c) => (ops.edited[c.id] ? { ...c, ...ops.edited[c.id] } : c))
  return [...out, ...ops.added.filter((c) => !deleted.has(c.id))]
}

// ─── context + provider ──────────────────────────────────────────────────

type DemoStore = {
  overlay: DemoOverlay
  hydrated: boolean
  addMessage: (ticketId: number, msg: Omit<DemoMessage, 'id'>) => void
  addInternalNote: (ticketId: number, msg: Omit<DemoMessage, 'id'>) => void
  patchTicket: (ticketId: number, patch: TicketPatch) => void
  createTicket: (input: { ticket: Omit<DemoTicket, 'id'>; firstMessage: Omit<DemoMessage, 'id'> }) => number
  saveSettings: (slug: string, patch: Partial<DemoBusiness>) => void
  addCategory: (slug: string, cat: DemoCategory) => void
  editCategory: (slug: string, catId: string, patch: Partial<DemoCategory>) => void
  deleteCategory: (slug: string, catId: string) => void
  setBotName: (name: string) => void
  reset: () => void
}

const Ctx = createContext<DemoStore | null>(null)

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<DemoOverlay>(EMPTY_OVERLAY)
  const [hydrated, setHydrated] = useState(false)
  const seq = useRef(0)

  // Load once on mount — keeps SSR/first-paint identical to the server (empty
  // overlay), then applies the persisted edits.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DemoOverlay
        if (parsed && parsed.v === 1) setOverlay({ ...EMPTY_OVERLAY, ...parsed })
      }
    } catch {
      /* ignore malformed storage */
    }
    setHydrated(true)
  }, [])

  // Persist on change (after hydration so we don't clobber storage with defaults).
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay))
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [overlay, hydrated])

  const uid = useCallback((prefix: string) => {
    seq.current += 1
    return `${prefix}-${Date.now().toString(36)}-${seq.current}`
  }, [])

  const addMessage = useCallback((ticketId: number, msg: Omit<DemoMessage, 'id'>) => {
    setOverlay((o) => {
      const list = o.messages[ticketId] ?? []
      return { ...o, messages: { ...o.messages, [ticketId]: [...list, { ...msg, id: uid('msg') }] } }
    })
  }, [uid])

  const addInternalNote = useCallback((ticketId: number, msg: Omit<DemoMessage, 'id'>) => {
    setOverlay((o) => {
      const list = o.internalNotes[ticketId] ?? []
      return { ...o, internalNotes: { ...o.internalNotes, [ticketId]: [...list, { ...msg, id: uid('note') }] } }
    })
  }, [uid])

  const patchTicket = useCallback((ticketId: number, patch: TicketPatch) => {
    setOverlay((o) => ({
      ...o,
      ticketPatches: {
        ...o.ticketPatches,
        [ticketId]: { ...o.ticketPatches[ticketId], ...patch, updatedAt: new Date().toISOString() },
      },
    }))
  }, [])

  const createTicket = useCallback<DemoStore['createTicket']>((input) => {
    let id = FIRST_OVERLAY_ID
    setOverlay((o) => {
      id = o.nextTicketId
      const ticket: DemoTicket = { ...input.ticket, id }
      return {
        ...o,
        nextTicketId: id + 1,
        newTickets: [...o.newTickets, ticket],
        messages: { ...o.messages, [id]: [{ ...input.firstMessage, id: uid('msg') }] },
      }
    })
    return id
  }, [uid])

  const saveSettings = useCallback((slug: string, patch: Partial<DemoBusiness>) => {
    setOverlay((o) => ({ ...o, settings: { ...o.settings, [slug]: { ...o.settings[slug], ...patch } } }))
  }, [])

  const mutateCatOps = useCallback((slug: string, fn: (ops: CategoryOps) => CategoryOps) => {
    setOverlay((o) => {
      const cur = o.categoryOps[slug] ?? { added: [], edited: {}, deleted: [] }
      return { ...o, categoryOps: { ...o.categoryOps, [slug]: fn(cur) } }
    })
  }, [])

  const addCategory = useCallback((slug: string, cat: DemoCategory) => {
    mutateCatOps(slug, (ops) => ({ ...ops, added: [...ops.added, cat] }))
  }, [mutateCatOps])

  const editCategory = useCallback((slug: string, catId: string, patch: Partial<DemoCategory>) => {
    mutateCatOps(slug, (ops) => {
      // Editing an overlay-added category mutates it in place; a base one records a patch.
      if (ops.added.some((c) => c.id === catId)) {
        return { ...ops, added: ops.added.map((c) => (c.id === catId ? { ...c, ...patch } : c)) }
      }
      return { ...ops, edited: { ...ops.edited, [catId]: { ...ops.edited[catId], ...patch } } }
    })
  }, [mutateCatOps])

  const deleteCategory = useCallback((slug: string, catId: string) => {
    mutateCatOps(slug, (ops) => ({
      ...ops,
      added: ops.added.filter((c) => c.id !== catId),
      deleted: ops.deleted.includes(catId) ? ops.deleted : [...ops.deleted, catId],
    }))
  }, [mutateCatOps])

  const setBotName = useCallback((name: string) => {
    setOverlay((o) => ({ ...o, appSettings: { ...o.appSettings, botName: name } }))
  }, [])

  const reset = useCallback(() => {
    setOverlay(EMPTY_OVERLAY)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<DemoStore>(
    () => ({
      overlay,
      hydrated,
      addMessage,
      addInternalNote,
      patchTicket,
      createTicket,
      saveSettings,
      addCategory,
      editCategory,
      deleteCategory,
      setBotName,
      reset,
    }),
    [overlay, hydrated, addMessage, addInternalNote, patchTicket, createTicket, saveSettings, addCategory, editCategory, deleteCategory, setBotName, reset],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDemoStore(): DemoStore {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDemoStore must be used inside <DemoStoreProvider>')
  return ctx
}
