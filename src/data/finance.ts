// ---------------------------------------------------------------------------
// KK Financial Assistant data layer.
//
// Two-tier storage:
//   • localStorage — always written, so the ledger works offline and with no
//     backend at all (and survives as an offline cache).
//   • Supabase (finance_entries) — used as the source of truth when the user is
//     signed in and Supabase is configured, so records sync across devices and
//     survive clearing the browser. Owner-only RLS keeps them private.
//
// The UI talks to `financeService`; it never needs to know which tier is live.
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConfigured } from '../lib/supabase'

export type FinanceEntryType = 'lecture' | 'referral' | 'hospital' | 'other'

export type FinanceEntry = {
  id: string
  type: FinanceEntryType
  title: string // lecture title / case description
  site: string // venue / hospital / institution
  patientRef?: string // optional case or patient reference
  fee: number
  currency: string // EGP, USD, EUR ...
  date: string // ISO yyyy-mm-dd
  paid: boolean
  notes?: string
  remindAt?: string // ISO date — follow-up reminder for an unpaid fee
  createdAt: string // ISO timestamp
}

const STORAGE_KEY = 'kk_financial_assistant'
const VALID_TYPES: FinanceEntryType[] = ['lecture', 'referral', 'hospital', 'other']

// ---------------- local cache (offline + no-backend fallback) ----------------
export function loadLocal(): FinanceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FinanceEntry[]) : []
  } catch {
    return []
  }
}

export function saveLocal(entries: FinanceEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function newId(): string {
  return 'fin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---------------- CSV export ----------------
export function toCSV(entries: FinanceEntry[]): string {
  const header = ['type', 'title', 'site', 'patientRef', 'fee', 'currency', 'date', 'status', 'notes']
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const rows = entries.map((e) =>
    [e.type, e.title, e.site, e.patientRef ?? '', e.fee, e.currency, e.date, e.paid ? 'paid' : 'unpaid', e.notes ?? '']
      .map(escape)
      .join(',')
  )
  return [header.join(','), ...rows].join('\n')
}

// ---------------- CSV import ----------------
// Minimal RFC-4180-ish parser (handles quotes, escaped quotes, commas/newlines in quotes).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''))
}

function normalizeDate(s: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  const base = isNaN(d.getTime()) ? new Date() : d
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

// Parse CSV text (our export format, or any file with matching headers) into entries.
export function parseCSV(text: string): FinanceEntry[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ''))
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const idx = {
    type: col('type'),
    title: col('title'),
    site: col('site'),
    patientRef: col('patientref'),
    fee: col('fee'),
    currency: col('currency'),
    date: col('date'),
    status: col('status'),
    paid: col('paid'),
    notes: col('notes'),
  }
  const hasHeader = idx.title !== -1 || idx.fee !== -1
  const dataRows = hasHeader ? rows.slice(1) : rows
  const at = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')
  const out: FinanceEntry[] = []
  for (const r of dataRows) {
    const typeRaw = at(r, idx.type).toLowerCase() as FinanceEntryType
    const statusRaw = (at(r, idx.status) || at(r, idx.paid)).toLowerCase()
    const entry: FinanceEntry = {
      id: newId(),
      type: VALID_TYPES.includes(typeRaw) ? typeRaw : 'other',
      title: at(r, idx.title),
      site: at(r, idx.site),
      patientRef: at(r, idx.patientRef) || undefined,
      fee: Number(at(r, idx.fee).replace(/[^0-9.-]/g, '')) || 0,
      currency: (at(r, idx.currency) || 'EGP').toUpperCase(),
      date: normalizeDate(at(r, idx.date)),
      paid: /^(paid|true|yes|1)$/.test(statusRaw),
      notes: at(r, idx.notes) || undefined,
      createdAt: new Date().toISOString(),
    }
    if (!entry.title && !entry.site && !entry.fee) continue
    out.push(entry)
  }
  return out
}

// ---------------- Supabase sync service ----------------
type FinanceRow = {
  id: string
  user_id?: string
  type: string
  title: string
  site: string | null
  patient_ref: string | null
  fee: number | string
  currency: string
  date: string
  paid: boolean
  notes: string | null
  remind_at: string | null
  created_at: string | null
}

function rowToEntry(r: FinanceRow): FinanceEntry {
  return {
    id: r.id,
    type: (VALID_TYPES.includes(r.type as FinanceEntryType) ? r.type : 'other') as FinanceEntryType,
    title: r.title ?? '',
    site: r.site ?? '',
    patientRef: r.patient_ref ?? undefined,
    fee: Number(r.fee) || 0,
    currency: r.currency ?? 'EGP',
    date: r.date,
    paid: Boolean(r.paid),
    notes: r.notes ?? undefined,
    remindAt: r.remind_at ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  }
}

function entryToRow(e: FinanceEntry, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    type: e.type,
    title: e.title,
    site: e.site || '',
    patient_ref: e.patientRef || null,
    fee: e.fee,
    currency: e.currency,
    date: e.date,
    paid: e.paid,
    notes: e.notes || null,
    remind_at: e.remindAt || null,
    // reset the push flag on every write so an edited/renewed reminder can fire
    notified_at: null,
    created_at: e.createdAt,
  }
}

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export const financeService = {
  // Whether cloud sync is even possible (env configured). Auth is checked per call.
  get cloudPossible() {
    return isSupabaseConfigured
  },

  // Load all entries. Uses Supabase when signed in (mirroring to the local
  // cache), otherwise the local cache. `synced` reports which tier answered.
  //
  // On the first signed-in load of a device that already has local entries
  // (created offline / before the account existed), those entries are merged
  // INTO the cloud instead of being overwritten by the (possibly empty) cloud
  // set — so "use offline first, then create an account" uploads existing data.
  async list(): Promise<{ entries: FinanceEntry[]; synced: boolean }> {
    const local = loadLocal()
    const uid = await currentUserId()
    if (uid && supabase) {
      const { data, error } = await supabase
        .from('finance_entries')
        .select('*')
        .order('date', { ascending: false })
      if (!error && data) {
        const cloud = (data as FinanceRow[]).map(rowToEntry)
        const cloudIds = new Set(cloud.map((e) => e.id))
        const localOnly = local.filter((e) => !cloudIds.has(e.id))
        if (localOnly.length > 0) {
          // Upload device-only entries. If this fails they still stay in the
          // returned list and the local cache, and will be retried next load.
          try {
            await supabase
              .from('finance_entries')
              .upsert(localOnly.map((e) => entryToRow(e, uid)), { onConflict: 'id' })
          } catch {
            // ignore — entries are preserved locally either way
          }
        }
        const merged = [...cloud, ...localOnly].sort((a, b) =>
          a.date < b.date ? 1 : a.date > b.date ? -1 : 0
        )
        saveLocal(merged)
        return { entries: merged, synced: true }
      }
    }
    return { entries: local, synced: false }
  },

  async upsert(entry: FinanceEntry): Promise<{ synced: boolean }> {
    const local = loadLocal()
    const merged = local.some((e) => e.id === entry.id)
      ? local.map((e) => (e.id === entry.id ? entry : e))
      : [...local, entry]
    saveLocal(merged)

    const uid = await currentUserId()
    if (uid && supabase) {
      const { error } = await supabase
        .from('finance_entries')
        .upsert(entryToRow(entry, uid), { onConflict: 'id' })
      if (!error) return { synced: true }
    }
    return { synced: false }
  },

  async remove(id: string): Promise<{ synced: boolean }> {
    saveLocal(loadLocal().filter((e) => e.id !== id))
    const uid = await currentUserId()
    if (uid && supabase) {
      const { error } = await supabase.from('finance_entries').delete().eq('id', id)
      if (!error) return { synced: true }
    }
    return { synced: false }
  },

  async importMany(entries: FinanceEntry[]): Promise<{ added: number; synced: boolean }> {
    const local = loadLocal()
    const byId = new Map(local.map((e) => [e.id, e]))
    for (const e of entries) byId.set(e.id, e)
    saveLocal(Array.from(byId.values()))

    const uid = await currentUserId()
    if (uid && supabase && entries.length) {
      const rows = entries.map((e) => entryToRow(e, uid))
      const { error } = await supabase.from('finance_entries').upsert(rows, { onConflict: 'id' })
      if (!error) return { added: entries.length, synced: true }
    }
    return { added: entries.length, synced: false }
  },
}
