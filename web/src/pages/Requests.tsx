import { useEffect, useState } from 'react'
import { Button } from '@proappstore/sdk/ui'
import { q, x, when, REQUEST, type Request } from '../api'
import { Empty, Section, Status } from '../components'

export function MyRequests({ title = 'My enquiries' }: { title?: string }) {
  const [rows, setRows] = useState<Request[] | null>(null)
  const [error, setError] = useState('')
  const load = async () => {
    try { setError(''); setRows(await q<Request>('list_my_requests')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your enquiries.') }
  }
  useEffect(() => { load() }, [])

  async function cancel(r: Request) {
    await x('cancel_request', { id: r.id, from: r.status })
    await load()
  }

  return (
    <Section title={title}>
      {error ? <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {rows && rows.length === 0 ? <Empty title={`No ${REQUEST.plural} yet`} description={`Find a tradie in the directory and press ${REQUEST.verb}.`} /> : null}
      <ul className="space-y-3">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] p-3">
            <div>
              <a href={`#/l/${r.listing_id}`} className="font-semibold text-[var(--ink)] hover:underline">{r.listing_title}</a>
              <p className="text-xs text-[var(--muted)]">{when(r.created_at)}{r.note ? ` · “${r.note}”` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <Status value={r.status} />
              {r.owner_id ? <Button variant="ghost" size="sm" onClick={() => { location.hash = `#/messages/${r.listing_id}/${r.owner_id}` }}>Message</Button> : null}
              {r.status === 'pending' || r.status === 'accepted' ? <Button variant="danger" size="sm" onClick={() => cancel(r)}>Cancel</Button> : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function Inbox() {
  const [rows, setRows] = useState<Request[] | null>(null)
  const [error, setError] = useState('')
  const load = async () => {
    try { setError(''); setRows(await q<Request>('list_incoming_requests')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load incoming enquiries.') }
  }
  useEffect(() => { load() }, [])

  async function move(r: Request, to: string) {
    // Guarded transition: `from` is the status this screen last saw, so a stale
    // client changes nothing (meta.changes = 0) instead of skipping a state.
    await x('set_request_status', { id: r.id, from: r.status, to })
    await load()
  }

  return (
    <Section title="Inbox">
      {error ? <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {rows && rows.length === 0 ? <Empty title="No incoming enquiries" description="Private enquiries on your services show up here." /> : null}
      <ul className="space-y-3">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] p-3">
            <div>
              <p className="font-semibold text-[var(--ink)]">{r.requester_name || 'Someone'} · <a href={`#/l/${r.listing_id}`} className="hover:underline">{r.listing_title}</a></p>
              <p className="text-xs text-[var(--muted)]">{when(r.created_at)}{r.note ? ` · “${r.note}”` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <Status value={r.status} />
              <Button variant="ghost" size="sm" onClick={() => { location.hash = `#/messages/${r.listing_id}/${r.requester_id}` }}>Message</Button>
              {r.status === 'pending' ? <><Button size="sm" onClick={() => move(r, 'accepted')}>Accept</Button><Button variant="danger" size="sm" onClick={() => move(r, 'declined')}>Decline</Button></> : null}
              {r.status === 'accepted' ? <><Button size="sm" onClick={() => move(r, 'completed')}>Mark completed</Button><Button variant="danger" size="sm" onClick={() => move(r, 'declined')}>Decline</Button></> : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}
