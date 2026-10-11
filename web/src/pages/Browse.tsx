import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@proappstore/sdk'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, pub, q, x, CATEGORIES, type Listing } from '../api'
import { Empty, ListingCard, Section } from '../components'

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

export function SavedAlert({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"><span>{error}</span><Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button></div>
}

/**
 * Saved ids for the signed-in user; empty and inert when signed out. Keyed on the user id so
 * an account change starts from an empty set and late responses for the previous user are dropped.
 */
export function useSaved() {
  const { user } = useAuth(app)
  const userId = user?.id ?? null
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const current = useRef({ userId, saved })
  current.current = { userId, saved }
  const pending = useRef(new Set<string>())

  useEffect(() => {
    setSaved(new Set())
    setError('')
    pending.current = new Set()
    if (!userId) return
    let live = true
    q<{ listing_id: string }>('list_my_favorite_ids')
      .then((rows) => { if (live) setSaved(new Set(rows.map((r) => r.listing_id))) })
      .catch((cause) => { if (live) setError(message(cause, 'Could not load your saved tradies.')) })
    return () => { live = false }
  }, [userId, attempt])

  /** Resolves true once the server accepted the change; a failure rolls the heart back. */
  const toggle = useCallback(async (id: string, has = current.current.saved.has(id)) => {
    const owner = current.current.userId
    if (!owner) { location.hash = '#/saved'; return false }
    if (pending.current.has(id)) return false
    const ids = pending.current
    ids.add(id)
    const flip = (on: boolean) => setSaved((prev) => {
      const next = new Set(prev)
      if (on) next.add(id); else next.delete(id)
      return next
    })
    setError('')
    flip(!has)
    try {
      await x(has ? 'remove_favorite' : 'add_favorite', { listing_id: id })
      return true
    } catch (cause) {
      if (current.current.userId === owner) {
        flip(has)
        setError(message(cause, has ? 'Could not remove this from saved.' : 'Could not save this tradie.'))
      }
      return false
    } finally {
      ids.delete(id)
    }
  }, [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { saved, toggle, signedIn: !!userId, userId, error, retry }
}

export function Browse() {
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const [rows, setRows] = useState<Listing[]>([])
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const { saved, toggle, signedIn, error: savedError, retry: retrySaved } = useSaved()

  const generation = useRef(0)
  const inFlight = useRef(false)

  /** No cursor = a fresh first page; a cursor appends the next keyset page unless a newer load started. */
  const load = useCallback(async (cursor?: { created_at: number; id: string }) => {
    if (cursor && inFlight.current) return
    const run = ++generation.current
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const page = await pub<Listing>('list_listings', {
        category: category || null,
        location: location.trim() || null,
        before: cursor?.created_at ?? null,
        before_id: cursor?.id ?? null,
      })
      if (run !== generation.current) return
      setRows((prev) => {
        if (!cursor) return page
        const seen = new Set(prev.map((r) => r.id))
        return [...prev, ...page.filter((r) => !seen.has(r.id))]
      })
      setDone(page.length < 24)
    } catch (cause) {
      if (run === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load the directory.')
    } finally {
      if (run === generation.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }, [category, location])

  useEffect(() => { load() }, [load])

  return (
    <Section title="Directory">
      <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">Find local tradies by trade and broad service area. Contact details stay private until you start an enquiry.</p>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); load() }} role="search">
        <select aria-label="Trade" value={category} onChange={(e) => setCategory(e.target.value)} className="min-w-40 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]">
          <option value="">All trades</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="min-w-48 flex-1"><Input aria-label="Service area" placeholder="Suburb, city or region" maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {error ? <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => load()}>Try again</Button></div> : null}
      {savedError ? <SavedAlert error={savedError} onRetry={retrySaved} /> : null}
      {busy && rows.length === 0 ? <p className="mb-4 text-sm text-[var(--muted)]">Loading directory…</p> : null}
      {rows.length === 0 && !busy && !error ? <Empty title="No tradies listed yet" description="Tradies can sign in and add a service profile." /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((l) => <ListingCard key={l.id} listing={l} saved={saved.has(l.id)} onToggleSave={signedIn ? () => { void toggle(l.id) } : undefined} />)}
      </div>
      {!done ? <div className="mt-6 text-center"><Button variant="ghost" loading={busy} onClick={() => { const last = rows[rows.length - 1]; if (last) void load({ created_at: last.created_at, id: last.id }) }}>Load more</Button></div> : null}
    </Section>
  )
}

export function Saved() {
  const [rows, setRows] = useState<Listing[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { toggle, userId, error: savedError, retry: retrySaved } = useSaved()

  useEffect(() => { setRows(null) }, [userId])
  useEffect(() => {
    if (!userId) return
    let live = true
    setError('')
    q<Listing>('list_my_favorites')
      .then((next) => { if (live) setRows(next) })
      .catch((cause) => { if (live) setError(message(cause, 'Could not load your saved tradies.')) })
    return () => { live = false }
  }, [userId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const remove = async (id: string) => { if (await toggle(id, true)) reload() }

  return (
    <Section title="Saved">
      {error ? <SavedAlert error={error} onRetry={reload} /> : null}
      {savedError && !error ? <SavedAlert error={savedError} onRetry={() => { retrySaved(); reload() }} /> : null}
      {rows === null && !error ? <p className="mb-4 text-sm text-[var(--muted)]">Loading saved tradies…</p> : null}
      {rows && rows.length === 0 && !error ? <Empty title="Nothing saved" description="Tap the heart on a listing to keep it here." /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(rows ?? []).map((l) => <ListingCard key={l.id} listing={l} saved onToggleSave={() => { void remove(l.id) }} />)}
      </div>
    </Section>
  )
}
