import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, pub, q, x, CATEGORIES, type Listing } from '../api'
import { Empty, ListingCard, Section } from '../components'

/** Saved ids for the signed-in user; empty and inert when signed out. */
export function useSaved() {
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const signedIn = !!app.auth.user
  useEffect(() => {
    if (!signedIn) return
    q<{ listing_id: string }>('list_my_favorite_ids').then((rows) => setSaved(new Set(rows.map((r) => r.listing_id)))).catch(() => {})
  }, [signedIn])
  const toggle = useCallback(async (id: string) => {
    if (!signedIn) { location.hash = '#/saved'; return }
    const has = saved.has(id)
    const next = new Set(saved)
    if (has) next.delete(id); else next.add(id)
    setSaved(next)
    await x(has ? 'remove_favorite' : 'add_favorite', { listing_id: id })
  }, [saved, signedIn])
  return { saved, toggle, signedIn }
}

export function Browse() {
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const [rows, setRows] = useState<Listing[]>([])
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const { saved, toggle, signedIn } = useSaved()

  const load = useCallback(async (before?: number) => {
    setBusy(true)
    setError('')
    try {
      const page = await pub<Listing>('list_listings', {
        category: category || null,
        location: location.trim() || null,
        before: before ?? null,
      })
      setRows((prev) => (before ? [...prev, ...page] : page))
      setDone(page.length < 24)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the directory.')
    } finally {
      setBusy(false)
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
      {busy && rows.length === 0 ? <p className="mb-4 text-sm text-[var(--muted)]">Loading directory…</p> : null}
      {rows.length === 0 && !busy && !error ? <Empty title="No tradies listed yet" description="Tradies can sign in and add a service profile." /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((l) => <ListingCard key={l.id} listing={l} saved={saved.has(l.id)} onToggleSave={signedIn ? () => toggle(l.id) : undefined} />)}
      </div>
      {!done ? <div className="mt-6 text-center"><Button variant="ghost" loading={busy} onClick={() => load(rows[rows.length - 1]?.created_at)}>Load more</Button></div> : null}
    </Section>
  )
}

export function Saved() {
  const [rows, setRows] = useState<Listing[] | null>(null)
  const { saved, toggle } = useSaved()
  useEffect(() => { q<Listing>('list_my_favorites').then(setRows) }, [saved.size])
  return (
    <Section title="Saved">
      {rows && rows.length === 0 ? <Empty title="Nothing saved" description="Tap the heart on a listing to keep it here." /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(rows ?? []).map((l) => <ListingCard key={l.id} listing={l} saved onToggleSave={() => toggle(l.id)} />)}
      </div>
    </Section>
  )
}
