// ---------------------------------------------------------------------------
// Vendor / Hospital list — user-managed names offered as a dropdown in the
// record form and as a filter. Same two-tier storage as the entries:
//   • localStorage — always written, works with no backend.
//   • Supabase (finance_vendors) — owner-only rows when signed in, so the
//     list follows the account across devices (migration 0003).
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConfigured } from '../lib/supabase'

export type Vendor = {
  id: string
  name: string
  createdAt: string
}

const STORAGE_KEY = 'kk_financial_vendors'

export function loadLocalVendors(): Vendor[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Vendor[]) : []
  } catch {
    return []
  }
}

export function saveLocalVendors(vendors: Vendor[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors))
}

export function newVendorId(): string {
  return 'ven_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const byName = (a: Vendor, b: Vendor) => a.name.localeCompare(b.name)

type VendorRow = {
  id: string
  user_id?: string
  name: string
  created_at: string | null
}

function rowToVendor(r: VendorRow): Vendor {
  return { id: r.id, name: r.name ?? '', createdAt: r.created_at ?? new Date().toISOString() }
}

function vendorToRow(v: Vendor, userId: string) {
  return { id: v.id, user_id: userId, name: v.name, created_at: v.createdAt }
}

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export const vendorService = {
  // Load the vendor list. Cloud when signed in (mirroring to the local cache,
  // uploading device-only vendors on first signed-in load), local otherwise.
  async list(): Promise<{ vendors: Vendor[]; synced: boolean }> {
    const local = loadLocalVendors()
    const uid = await currentUserId()
    if (uid && supabase) {
      const { data, error } = await supabase.from('finance_vendors').select('*')
      if (!error && data) {
        const cloud = (data as VendorRow[]).map(rowToVendor)
        const cloudIds = new Set(cloud.map((v) => v.id))
        const localOnly = local.filter((v) => !cloudIds.has(v.id))
        if (localOnly.length > 0) {
          try {
            await supabase
              .from('finance_vendors')
              .upsert(localOnly.map((v) => vendorToRow(v, uid)), { onConflict: 'id' })
          } catch {
            // ignore — vendors stay in the local cache either way
          }
        }
        const merged = [...cloud, ...localOnly].sort(byName)
        saveLocalVendors(merged)
        return { vendors: merged, synced: true }
      }
    }
    return { vendors: [...local].sort(byName), synced: false }
  },

  async upsert(vendor: Vendor): Promise<{ synced: boolean }> {
    const local = loadLocalVendors()
    const merged = local.some((v) => v.id === vendor.id)
      ? local.map((v) => (v.id === vendor.id ? vendor : v))
      : [...local, vendor]
    saveLocalVendors(merged.sort(byName))

    const uid = await currentUserId()
    if (uid && supabase) {
      const { error } = await supabase
        .from('finance_vendors')
        .upsert(vendorToRow(vendor, uid), { onConflict: 'id' })
      if (!error) return { synced: true }
    }
    return { synced: false }
  },

  async remove(id: string): Promise<{ synced: boolean }> {
    saveLocalVendors(loadLocalVendors().filter((v) => v.id !== id))
    const uid = await currentUserId()
    if (uid && supabase) {
      const { error } = await supabase.from('finance_vendors').delete().eq('id', id)
      if (!error) return { synced: true }
    }
    return { synced: false }
  },
}
