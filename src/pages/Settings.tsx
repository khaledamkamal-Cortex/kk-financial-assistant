import { useEffect, useState } from 'react'
import { navigate } from '../lib/router'
import { t } from '../strings'
import { vendorService, newVendorId, type Vendor } from '../data/vendors'
import { financeService } from '../data/finance'

// ---------------------------------------------------------------------------
// Settings page (#/settings). Manages the Vendor / Hospital list that feeds
// the dropdown in the record form and the vendor filter on the main screen.
// ---------------------------------------------------------------------------

const byName = (a: Vendor, b: Vendor) => a.name.localeCompare(b.name)

export default function Settings() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [synced, setSynced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    let active = true
    vendorService
      .list()
      .then(({ vendors: list, synced: s }) => {
        if (!active) return
        setVendors(list)
        setSynced(s)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function isDuplicate(name: string, exceptId?: string) {
    const lower = name.toLowerCase()
    return vendors.some((v) => v.id !== exceptId && v.name.toLowerCase() === lower)
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    if (isDuplicate(name)) {
      window.alert(t.setDuplicate)
      return
    }
    const vendor: Vendor = { id: newVendorId(), name, createdAt: new Date().toISOString() }
    setVendors((prev) => [...prev, vendor].sort(byName))
    setNewName('')
    await vendorService.upsert(vendor)
  }

  function startRename(v: Vendor) {
    setEditId(v.id)
    setEditName(v.name)
  }

  async function saveRename() {
    if (!editId) return
    const name = editName.trim()
    const current = vendors.find((v) => v.id === editId)
    if (!name || !current) {
      setEditId(null)
      return
    }
    if (name === current.name) {
      setEditId(null)
      return
    }
    if (isDuplicate(name, editId)) {
      window.alert(t.setDuplicate)
      return
    }
    const updated: Vendor = { ...current, name }
    setVendors((prev) => prev.map((v) => (v.id === editId ? updated : v)).sort(byName))
    setEditId(null)
    await vendorService.upsert(updated)

    // Offer to carry the rename over to records that use the old name.
    const { entries } = await financeService.list()
    const matches = entries.filter((e) => e.site.trim() === current.name)
    if (matches.length > 0) {
      const msg = t.setRenameEntries
        .replace('{n}', String(matches.length))
        .replace('{old}', current.name)
        .replace('{new}', name)
      if (window.confirm(msg)) {
        for (const e of matches) {
          await financeService.upsert({ ...e, site: name })
        }
      }
    }
  }

  async function remove(v: Vendor) {
    if (!window.confirm(t.setDeleteConfirm)) return
    setVendors((prev) => prev.filter((x) => x.id !== v.id))
    if (editId === v.id) setEditId(null)
    await vendorService.remove(v.id)
  }

  return (
    <>
      <header className="app-header">
        <button className="app-header__back" onClick={() => navigate('')} aria-label={t.suBack}>
          ←
        </button>
        <h1 className="app-header__title">{t.setTitle}</h1>
      </header>
      <div className="screen">
        <div className="card page-card">
          <h3 className="page-section-title">{t.setVendors}</h3>
          <p className="muted page-intro">{t.setVendorsHint}</p>

          <form
            className="set-addrow"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <input
              placeholder={t.setAddPh}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="btn btn--primary set-addbtn" type="submit" disabled={!newName.trim()}>
              + {t.setAdd}
            </button>
          </form>

          {loading ? (
            <div className="empty">{t.finLoading}</div>
          ) : vendors.length === 0 ? (
            <div className="empty">{t.setEmptyVendors}</div>
          ) : (
            <div className="set-list">
              {vendors.map((v) =>
                editId === v.id ? (
                  <form
                    key={v.id}
                    className="set-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void saveRename()
                    }}
                  >
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <button className="fin-link" type="submit">
                      {t.finSave}
                    </button>
                    <button className="fin-link" type="button" onClick={() => setEditId(null)}>
                      {t.finCancel}
                    </button>
                  </form>
                ) : (
                  <div key={v.id} className="set-row">
                    <span className="set-row__name">🏥 {v.name}</span>
                    <button className="fin-link" onClick={() => startRename(v)}>
                      {t.finEdit}
                    </button>
                    <button className="fin-link fin-link--danger" onClick={() => remove(v)}>
                      {t.finDelete}
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          <div className="fin-syncbadge page-syncbadge">
            {synced ? '☁︎ ' + t.finSynced : '📱 ' + t.finLocalOnly}
          </div>
        </div>
      </div>
    </>
  )
}
