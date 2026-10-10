import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { q, x, when, type Job, type Quote, type Request } from '../api'
import { Empty, Field, Section, Status, TextArea } from '../components'

type TargetType = 'job' | 'request'

function isExpired(quote: Quote) {
  return quote.status === 'submitted' && quote.valid_until !== null && quote.valid_until <= Date.now()
}

function formatAmount(quote: Quote) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: quote.currency }).format(quote.amount) } catch { return `${quote.currency} ${quote.amount}` }
}

export function QuoteForm({ targetType, targetId, onDone }: { targetType: TargetType; targetId: string; onDone?: () => Promise<void> | void }) {
  const [scope, setScope] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('AUD')
  const [timing, setTiming] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const expiry = validUntil ? new Date(`${validUntil}T23:59:59.999`).getTime() : undefined
    try {
      const changes = await x(targetType === 'job' ? 'create_job_quote' : 'create_request_quote', {
        id: crypto.randomUUID(), [targetType === 'job' ? 'job_id' : 'request_id']: targetId,
        scope: scope.trim(), amount: Number(amount), currency: currency.trim().toUpperCase(), timing: timing.trim(), valid_until: expiry, notes: notes.trim(),
      })
      if (!changes) throw new Error('This quote could not be submitted. It may already exist, be expired, or no longer be available.')
      setScope(''); setAmount(''); setTiming(''); setValidUntil(''); setNotes(''); await onDone?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit the quote.') } finally { setSaving(false) }
  }
  return <form onSubmit={submit} className="mt-5 max-w-2xl space-y-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel-strong)] p-4">
    <div><h2 className="font-semibold text-[var(--ink)]">Send a private quote</h2><p className="mt-1 text-sm text-[var(--muted)]">Amounts are informational only. Arrange any payment directly outside Tradies.</p></div>
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <Field label="Work scope"><TextArea aria-label="Quote work scope" required maxLength={4000} rows={4} value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Informational amount"><Input aria-label="Quote amount" required type="number" min="0" max="100000000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Currency"><Input aria-label="Quote currency" required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field></div>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Indicative timing"><Input aria-label="Quote timing" required maxLength={500} placeholder="e.g. Next week, 1–2 days" value={timing} onChange={(e) => setTiming(e.target.value)} /></Field><Field label="Valid until (optional)"><Input aria-label="Quote valid until" type="date" min={new Date().toISOString().slice(0, 10)} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field></div>
    <Field label="Notes (optional)"><TextArea aria-label="Quote notes" maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    <Button type="submit" loading={saving}>Submit quote</Button>
  </form>
}

export function CustomerQuoteComparison({ targetType, targetId }: { targetType: TargetType; targetId: string }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null); const [error, setError] = useState(''); const [saving, setSaving] = useState('')
  const load = useCallback(async () => { try { setError(''); setQuotes(await q<Quote>(targetType === 'job' ? 'list_job_quotes' : 'list_request_quotes', { [targetType === 'job' ? 'job_id' : 'request_id']: targetId })) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load private quotes.') } }, [targetId, targetType])
  useEffect(() => { load() }, [load])
  async function move(quote: Quote, action: 'accept_quote' | 'decline_quote') {
    setSaving(quote.id); setError('')
    try {
      const changes = await x(action, action === 'accept_quote' ? { id: quote.id, from: quote.status, expected_revision: quote.revision } : { id: quote.id, from: quote.status })
      if (!changes) {
        if (action === 'accept_quote') {
          await load()
          throw new Error('This quote was revised before you could accept it. Please review the updated terms below.')
        }
        throw new Error('This quote changed before it could be declined.')
      }
      await load()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this quote.') } finally { setSaving('') }
  }
  return <section className="mt-6 max-w-2xl"><div className="flex items-end justify-between gap-3"><h2 className="display-font text-xl font-semibold text-[var(--ink)]">Private quotes</h2><Button variant="ghost" size="sm" onClick={load}>Refresh</Button></div><p className="mt-1 text-sm text-[var(--muted)]">Only you can compare these quotes. Amounts are informational; arrange payment directly with your chosen tradie.</p>{error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}{quotes === null ? <p className="mt-3 text-sm text-[var(--muted)]">Loading quotes…</p> : null}{quotes?.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">No quotes yet.</p> : null}<ul className="mt-3 space-y-3">{(quotes ?? []).map((quote) => <QuoteCard key={quote.id} quote={quote} customer onMove={move} saving={saving === quote.id} />)}</ul></section>
}

function QuoteCard({ quote, customer, onMove, saving }: { quote: Quote; customer?: boolean; onMove?: (quote: Quote, action: 'accept_quote' | 'decline_quote') => void; saving?: boolean }) {
  const expired = isExpired(quote); const state = expired ? 'expired' : quote.status
  return <li className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel-strong)] p-4">{customer ? <p className="mb-3 text-sm text-[var(--ink)]">From: {quote.provider_has_listing === 1 && quote.provider_profile_id && quote.provider_display_name ? <><a href={`#/l/${quote.provider_profile_id}`} className="text-[var(--accent)] underline-offset-4 hover:underline">{quote.provider_display_name}</a><span className="text-[var(--muted)]"> · {quote.provider_trade_category || 'provider'} tradie</span></> : <span>{quote.provider_trade_category || 'Provider'} tradie</span>}{quote.provider_has_listing === 0 ? <span className="ml-1 text-[var(--muted)]">(no active public listing)</span> : null}</p> : null}<div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-[var(--ink)]">{formatAmount(quote)}</p><p className="text-xs text-[var(--muted)]">{quote.currency} · {quote.timing} · revision {quote.revision}</p></div><Status value={state} /></div><p className="mt-3 whitespace-pre-wrap text-sm text-[var(--ink)]">{quote.scope}</p>{quote.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted)]">{quote.notes}</p> : null}<p className="mt-3 text-xs text-[var(--muted)]">{quote.valid_until ? `Valid until ${when(quote.valid_until)}` : 'No stated expiry'} · updated {when(quote.updated_at)}</p>{customer && quote.status === 'submitted' && !expired && onMove ? <div className="mt-4 flex gap-2"><Button size="sm" loading={saving} onClick={() => onMove(quote, 'accept_quote')}>Accept quote</Button><Button size="sm" variant="danger" disabled={saving} onClick={() => onMove(quote, 'decline_quote')}>Decline</Button></div> : null}</li>
}

export function Quotes() {
  const [tradieQuotes, setTradieQuotes] = useState<Quote[] | null>(null); const [jobs, setJobs] = useState<Job[]>([]); const [requests, setRequests] = useState<Request[]>([]); const [error, setError] = useState('')
  const load = useCallback(async () => { try { setError(''); const [mine, myJobs, myRequests] = await Promise.all([q<Quote>('list_my_quotes'), q<Job>('list_my_jobs'), q<Request>('list_my_requests')]); setTradieQuotes(mine); setJobs(myJobs); setRequests(myRequests) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load quotes.') } }, [])
  useEffect(() => { load() }, [load])
  // Only tradies have rows from list_my_quotes; customers compare quotes in target-specific cards below.
  if (tradieQuotes === null) return <Section title="Quotes"><p className="text-sm text-[var(--muted)]">Loading quotes…</p></Section>
  return <Section title="Quotes" action={<Button variant="ghost" size="sm" onClick={load}>Refresh</Button>}><p className="mb-5 max-w-2xl text-sm text-[var(--muted)]">Quotes are private and informational only. Tradies submit terms; customers compare and select them here, while any payment is arranged outside Tradies.</p>{error ? <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p> : null}{tradieQuotes.length ? <><h2 className="display-font mb-3 text-xl font-semibold text-[var(--ink)]">Quotes I submitted</h2><ul className="space-y-3">{tradieQuotes.map((quote) => <TradieQuoteCard key={quote.id} quote={quote} onDone={load} />)}</ul></> : null}{jobs.map((job) => <TargetQuotes key={`job-${job.id}`} title={job.title} type="job" id={job.id} />)}{requests.map((request) => <TargetQuotes key={`request-${request.id}`} title={request.listing_title} type="request" id={request.id} />)}{!tradieQuotes.length && !jobs.length && !requests.length ? <Empty title="No quotes yet" description="Quotes appear after you submit one or receive one on a job or direct enquiry." /> : null}</Section>
}

function TargetQuotes({ title, type, id }: { title: string; type: TargetType; id: string }) { return <div className="mb-8 border-t border-[var(--line)] pt-5"><h2 className="font-semibold text-[var(--ink)]">{title}</h2><CustomerQuoteComparison targetType={type} targetId={id} /></div> }

function TradieQuoteCard({ quote, onDone }: { quote: Quote; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  async function withdraw() { setSaving(true); setError(''); try { const changes = await x('withdraw_quote', { id: quote.id, from: quote.status }); if (!changes) throw new Error('This quote is no longer available to withdraw.'); await onDone() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not withdraw quote.') } finally { setSaving(false) } }
  return <li className="rounded-[var(--radius-sm)] border border-[var(--line)] p-4"><QuoteCard quote={quote} />{error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}{quote.status === 'submitted' && !isExpired(quote) ? <div className="mt-4 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>Revise</Button><Button size="sm" variant="danger" loading={saving} onClick={withdraw}>Withdraw</Button></div> : null}{editing ? <QuoteRevision quote={quote} onDone={async () => { setEditing(false); await onDone() }} /> : null}</li>
}

function QuoteRevision({ quote, onDone }: { quote: Quote; onDone: () => Promise<void> }) {
  const [scope, setScope] = useState(quote.scope); const [amount, setAmount] = useState(String(quote.amount)); const [currency, setCurrency] = useState(quote.currency); const [timing, setTiming] = useState(quote.timing); const [validUntil, setValidUntil] = useState(quote.valid_until ? new Date(quote.valid_until).toISOString().slice(0, 10) : ''); const [notes, setNotes] = useState(quote.notes); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(''); const expiry = validUntil ? new Date(`${validUntil}T23:59:59.999`).getTime() : undefined; try { const changes = await x('revise_quote', { id: quote.id, expected_revision: quote.revision, scope: scope.trim(), amount: Number(amount), currency: currency.trim().toUpperCase(), timing: timing.trim(), valid_until: expiry, notes: notes.trim() }); if (!changes) throw new Error('This quote was updated by someone else. Please refresh to see the latest version.'); await onDone() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revise quote.') } finally { setSaving(false) } }
  return <form onSubmit={save} className="mt-4 space-y-3 border-t border-[var(--line)] pt-4"><p className="font-semibold text-[var(--ink)]">Revise quote</p>{error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}<Field label="Work scope"><TextArea aria-label="Revised work scope" required maxLength={4000} rows={3} value={scope} onChange={(e) => setScope(e.target.value)} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Amount"><Input aria-label="Revised amount" required type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Currency"><Input aria-label="Revised currency" required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Timing"><Input aria-label="Revised timing" required maxLength={500} value={timing} onChange={(e) => setTiming(e.target.value)} /></Field><Field label="Valid until (optional)"><Input aria-label="Revised valid until" type="date" min={new Date().toISOString().slice(0, 10)} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field></div><Field label="Notes"><TextArea aria-label="Revised notes" maxLength={2000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><Button size="sm" type="submit" loading={saving}>Save revision</Button></form>
}
