import { useEffect, useMemo, useRef, useState } from 'react'
import AccountBar from '../components/AccountBar'
import { t } from '../strings'
import {
  financeService,
  newId,
  toCSV,
  parseCSV,
  type FinanceEntry,
  type FinanceEntryType,
} from '../data/finance'

type TypeFilter = 'all' | FinanceEntryType
type StatusFilter = 'all' | 'paid' | 'unpaid'
type Period = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'
type Sort = 'dateDesc' | 'dateAsc' | 'feeDesc' | 'feeAsc'

type Agg = { earned: number; collected: number; outstanding: number; count: number }

const TYPE_META: Record<FinanceEntryType, { label: string; icon: string }> = {
  lecture: { label: t.finTypeLecture, icon: '🎓' },
  referral: { label: t.finTypeReferral, icon: '🏥' },
  hospital: { label: t.finTypeHospital, icon: '🏨' },
  other: { label: t.finTypeOther, icon: '📌' },
}

const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayLocal = () => fmtDate(new Date())

function periodRange(period: Period): { from?: string; to?: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (period) {
    case 'thisMonth':
      return { from: fmtDate(new Date(y, m, 1)), to: fmtDate(new Date(y, m + 1, 0)) }
    case 'lastMonth':
      return { from: fmtDate(new Date(y, m - 1, 1)), to: fmtDate(new Date(y, m, 0)) }
    case 'thisYear':
      return { from: fmtDate(new Date(y, 0, 1)), to: fmtDate(new Date(y, 11, 31)) }
    default:
      return {}
  }
}

function groupBy(entries: FinanceEntry[], keyFn: (e: FinanceEntry) => string) {
  const outer = new Map<string, Map<string, Agg>>()
  for (const e of entries) {
    const label = keyFn(e) || '—'
    const cur = e.currency || '—'
    const inner = outer.get(label) ?? new Map<string, Agg>()
    const acc = inner.get(cur) ?? { earned: 0, collected: 0, outstanding: 0, count: 0 }
    acc.earned += e.fee
    acc.count += 1
    if (e.paid) acc.collected += e.fee
    else acc.outstanding += e.fee
    inner.set(cur, acc)
    outer.set(label, inner)
  }
  return Array.from(outer.entries())
    .map(([label, inner]) => {
      const curs = Array.from(inner.entries())
      const total = curs.reduce((s, [, a]) => s + a.earned, 0)
      return { label, curs, total }
    })
    .sort((a, b) => b.total - a.total)
}

function emptyDraft(): FinanceEntry {
  return {
    id: newId(),
    type: 'lecture',
    title: '',
    site: '',
    patientRef: '',
    fee: 0,
    currency: 'EGP',
    date: todayLocal(),
    paid: false,
    notes: '',
    remindAt: '',
    createdAt: new Date().toISOString(),
  }
}

export default function Tracker() {
  const [entries, setEntries] = useState<FinanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [synced, setSynced] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [sort, setSort] = useState<Sort>('dateDesc')
  const [query, setQuery] = useState('')
  const [showStats, setShowStats] = useState(false)
  const [editing, setEditing] = useState<FinanceEntry | null>(null)
  const [isNew, setIsNew] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    financeService
      .list()
      .then(({ entries: list, synced: s }) => {
        if (!active) return
        setEntries(list)
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

  async function reload() {
    const { entries: list, synced: s } = await financeService.list()
    setEntries(list)
    setSynced(s)
  }

  const range = useMemo(() => {
    if (period === 'custom') return { from: customFrom || undefined, to: customTo || undefined }
    return periodRange(period)
  }, [period, customFrom, customTo])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (statusFilter === 'paid' && !e.paid) return false
      if (statusFilter === 'unpaid' && e.paid) return false
      if (range.from && e.date < range.from) return false
      if (range.to && e.date > range.to) return false
      if (q) {
        const hay = `${e.title} ${e.site} ${e.patientRef ?? ''} ${e.notes ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, typeFilter, statusFilter, range, query])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sort) {
      case 'dateAsc':
        arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        break
      case 'feeDesc':
        arr.sort((a, b) => b.fee - a.fee)
        break
      case 'feeAsc':
        arr.sort((a, b) => a.fee - b.fee)
        break
      default:
        arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    }
    return arr
  }, [filtered, sort])

  const totals = useMemo(() => {
    const map = new Map<string, { earned: number; collected: number; outstanding: number }>()
    for (const e of filtered) {
      const cur = e.currency || '—'
      const acc = map.get(cur) ?? { earned: 0, collected: 0, outstanding: 0 }
      acc.earned += e.fee
      if (e.paid) acc.collected += e.fee
      else acc.outstanding += e.fee
      map.set(cur, acc)
    }
    return Array.from(map.entries())
  }, [filtered])

  const byType = useMemo(() => groupBy(filtered, (e) => e.type), [filtered])
  const bySite = useMemo(() => groupBy(filtered, (e) => e.site.trim() || t.finNoSite), [filtered])

  function startAdd() {
    setEditing(emptyDraft())
    setIsNew(true)
  }
  function startEdit(e: FinanceEntry) {
    setEditing({ ...e, remindAt: e.remindAt ?? '' })
    setIsNew(false)
  }
  async function remove(id: string) {
    if (!window.confirm(t.finConfirmDelete)) return
    setEntries((prev) => prev.filter((e) => e.id !== id))
    await financeService.remove(id)
  }
  async function togglePaid(e: FinanceEntry) {
    const updated = { ...e, paid: !e.paid }
    setEntries((prev) => prev.map((x) => (x.id === e.id ? updated : x)))
    await financeService.upsert(updated)
  }
  async function saveDraft() {
    if (!editing) return
    const draft: FinanceEntry = {
      ...editing,
      title: editing.title.trim(),
      site: editing.site.trim(),
      fee: Number(editing.fee) || 0,
      currency: (editing.currency || 'EGP').trim().toUpperCase(),
      patientRef: editing.patientRef?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
      remindAt: editing.remindAt || undefined,
    }
    if (!draft.title) {
      window.alert(t.finTitleRequired)
      return
    }
    setEntries((prev) =>
      prev.some((e) => e.id === draft.id) ? prev.map((e) => (e.id === draft.id ? draft : e)) : [...prev, draft]
    )
    setEditing(null)
    await financeService.upsert(draft)
  }
  function exportCsv() {
    const csv = toCSV(sorted)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-${todayLocal()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  async function onImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length === 0) {
        window.alert(t.finImportEmpty)
        return
      }
      if (!window.confirm(t.finImportConfirm.replace('{n}', String(parsed.length)))) return
      const res = await financeService.importMany(parsed)
      await reload()
      window.alert(t.finImportDone.replace('{n}', String(res.added)))
    } catch {
      window.alert(t.finImportError)
    }
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const typeLabel = (k: string) => TYPE_META[k as FinanceEntryType]?.label ?? k
  const today = todayLocal()

  return (
    <>
      <header className="app-header">
        <span className="app-header__logo">💰</span>
        <h1 className="app-header__title">{t.finTitle}</h1>
      </header>
      <AccountBar onAuthChange={() => void reload()} />
      <div className="screen">
        <div className="fin-summary">
          {totals.length === 0 ? (
            <div className="fin-summary__card card">
              <span className="muted">{t.finNoData}</span>
            </div>
          ) : (
            totals.map(([cur, v]) => (
              <div key={cur} className="fin-summary__card card">
                <div className="fin-summary__cur">{cur}</div>
                <div className="fin-summary__row">
                  <span className="muted">{t.finEarned}</span>
                  <strong>{fmt(v.earned)}</strong>
                </div>
                <div className="fin-summary__row">
                  <span className="muted">{t.finCollected}</span>
                  <strong className="fin-pos">{fmt(v.collected)}</strong>
                </div>
                <div className="fin-summary__row">
                  <span className="muted">{t.finOutstanding}</span>
                  <strong className="fin-neg">{fmt(v.outstanding)}</strong>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="fin-syncbadge">{synced ? '☁︎ ' + t.finSynced : '📱 ' + t.finLocalOnly}</div>

        <div className="fin-toolbar">
          <button className="btn btn--primary" onClick={startAdd}>
            + {t.finAdd}
          </button>
          <button className="btn btn--ghost" onClick={exportCsv} disabled={sorted.length === 0}>
            ⬇ {t.finExport}
          </button>
          <button className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            ⬆ {t.finImport}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onImportFile}
          />
        </div>

        <div className="fin-controls">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="all">{t.finAllTime}</option>
            <option value="thisMonth">{t.finThisMonth}</option>
            <option value="lastMonth">{t.finLastMonth}</option>
            <option value="thisYear">{t.finThisYear}</option>
            <option value="custom">{t.finCustom}</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="dateDesc">{t.finSortDateDesc}</option>
            <option value="dateAsc">{t.finSortDateAsc}</option>
            <option value="feeDesc">{t.finSortFeeDesc}</option>
            <option value="feeAsc">{t.finSortFeeAsc}</option>
          </select>
        </div>

        {period === 'custom' && (
          <div className="fin-range">
            <div className="field">
              <label>{t.finFrom}</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>{t.finTo}</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        <button
          className={'fin-statbtn' + (showStats ? ' is-open' : '')}
          onClick={() => setShowStats((s) => !s)}
        >
          📊 {showStats ? t.finHideStats : t.finStats}
        </button>

        {showStats && (
          <div className="fin-stats card">
            <div className="fin-stats__group">
              <h4>{t.finByType}</h4>
              {byType.length === 0 ? (
                <span className="muted">{t.finNoData}</span>
              ) : (
                byType.map((g) => (
                  <div key={g.label} className="fin-stats__row">
                    <span className="fin-stats__label">{typeLabel(g.label)}</span>
                    <span className="fin-stats__vals">
                      {g.curs.map(([cur, a]) => (
                        <span key={cur} className="fin-stats__val">
                          {fmt(a.earned)} {cur}
                          {a.outstanding > 0 && (
                            <em className="fin-neg">
                              {' '}
                              · {t.finOutstanding} {fmt(a.outstanding)}
                            </em>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="fin-stats__group">
              <h4>{t.finBySite}</h4>
              {bySite.length === 0 ? (
                <span className="muted">{t.finNoData}</span>
              ) : (
                bySite.map((g) => (
                  <div key={g.label} className="fin-stats__row">
                    <span className="fin-stats__label">{g.label}</span>
                    <span className="fin-stats__vals">
                      {g.curs.map(([cur, a]) => (
                        <span key={cur} className="fin-stats__val">
                          {fmt(a.earned)} {cur}
                          {a.outstanding > 0 && (
                            <em className="fin-neg">
                              {' '}
                              · {t.finOutstanding} {fmt(a.outstanding)}
                            </em>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="fin-filters">
          <div className="fin-chips">
            {(['all', 'lecture', 'referral', 'hospital', 'other'] as TypeFilter[]).map((tf) => (
              <button
                key={tf}
                className={'fin-chip' + (typeFilter === tf ? ' is-active' : '')}
                onClick={() => setTypeFilter(tf)}
              >
                {tf === 'all' ? t.finAll : TYPE_META[tf].icon + ' ' + TYPE_META[tf].label}
              </button>
            ))}
          </div>
          <div className="fin-filter-row">
            <input
              className="fin-search"
              placeholder={t.finSearch}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="all">{t.finAllStatus}</option>
              <option value="paid">{t.finPaid}</option>
              <option value="unpaid">{t.finUnpaid}</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="empty">{t.finLoading}</div>
        ) : sorted.length === 0 ? (
          <div className="empty">{t.finEmpty}</div>
        ) : (
          <div className="stack fin-list">
            {sorted.map((e) => (
              <div key={e.id} className="fin-item card">
                <div className="fin-item__icon">{TYPE_META[e.type].icon}</div>
                <div className="fin-item__body">
                  <div className="fin-item__top">
                    <strong className="fin-item__title">{e.title || '—'}</strong>
                    <span className="fin-item__fee">
                      {fmt(e.fee)} {e.currency}
                    </span>
                  </div>
                  <div className="fin-item__meta muted">
                    {e.site && <span>📍 {e.site}</span>}
                    <span>{e.date}</span>
                  </div>
                  {e.patientRef && <div className="fin-item__ref muted">🔖 {e.patientRef}</div>}
                  {e.notes && <div className="fin-item__notes muted">{e.notes}</div>}
                  {e.remindAt && !e.paid && (
                    <div className={'fin-item__remind' + (e.remindAt.slice(0, 10) <= today ? ' is-due' : '')}>
                      ⏰ {t.finRemindShort} {e.remindAt.slice(0, 10)}
                    </div>
                  )}
                  <div className="fin-item__actions">
                    <button
                      className={'fin-badge ' + (e.paid ? 'is-paid' : 'is-unpaid')}
                      onClick={() => togglePaid(e)}
                    >
                      {e.paid ? '✓ ' + t.finPaid : '● ' + t.finUnpaid}
                    </button>
                    <button className="fin-link" onClick={() => startEdit(e)}>
                      {t.finEdit}
                    </button>
                    <button className="fin-link fin-link--danger" onClick={() => remove(e.id)}>
                      {t.finDelete}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fin-modal" onClick={() => setEditing(null)}>
          <div className="fin-modal__panel" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="fin-modal__title">{isNew ? t.finAddTitle : t.finEditTitle}</h3>

            <div className="field">
              <label>{t.finType}</label>
              <select
                value={editing.type}
                onChange={(e) => setEditing({ ...editing, type: e.target.value as FinanceEntryType })}
              >
                <option value="lecture">{t.finTypeLecture}</option>
                <option value="referral">{t.finTypeReferral}</option>
                <option value="hospital">{t.finTypeHospital}</option>
                <option value="other">{t.finTypeOther}</option>
              </select>
            </div>

            <div className="field">
              <label>{t.finFieldTitle}</label>
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder={t.finFieldTitlePh}
              />
            </div>

            <div className="field">
              <label>{t.finSite}</label>
              <input
                value={editing.site}
                onChange={(e) => setEditing({ ...editing, site: e.target.value })}
                placeholder={t.finSitePh}
              />
            </div>

            <div className="fin-grid2">
              <div className="field">
                <label>{t.finFee}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={editing.fee}
                  onChange={(e) => setEditing({ ...editing, fee: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>{t.finCurrency}</label>
                <select
                  value={editing.currency}
                  onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
                >
                  <option value="EGP">EGP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="SAR">SAR</option>
                  <option value="AED">AED</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>{t.finDate}</label>
              <input
                type="date"
                value={editing.date}
                onChange={(e) => setEditing({ ...editing, date: e.target.value })}
              />
            </div>

            <div className="field">
              <label>{t.finPatientRef}</label>
              <input
                value={editing.patientRef ?? ''}
                onChange={(e) => setEditing({ ...editing, patientRef: e.target.value })}
                placeholder={t.finPatientRefPh}
              />
            </div>

            <div className="field">
              <label>{t.finRemind}</label>
              <input
                type="date"
                value={editing.remindAt ?? ''}
                onChange={(e) => setEditing({ ...editing, remindAt: e.target.value })}
              />
              <span className="fin-hint muted">{t.finRemindHint}</span>
            </div>

            <div className="field">
              <label>{t.finNotes}</label>
              <textarea
                rows={3}
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>

            <label className="fin-check">
              <input
                type="checkbox"
                checked={editing.paid}
                onChange={(e) => setEditing({ ...editing, paid: e.target.checked })}
              />
              <span>{t.finMarkPaid}</span>
            </label>

            <div className="fin-modal__actions">
              <button className="btn btn--outline" onClick={() => setEditing(null)}>
                {t.finCancel}
              </button>
              <button className="btn btn--primary" onClick={saveDraft}>
                {t.finSave}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
