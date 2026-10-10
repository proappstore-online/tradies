import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, pub, q, x, when, type Conversation, type Listing, type Message, type WorkAgreement, type WorkConversation, type WorkMessage } from '../api'
import { Empty, Section } from '../components'

const MESSAGE_PAGE_SIZE = 100

type ThreadRow = { id: string; created_at: number }

function chronological<T extends ThreadRow>(...pages: T[][]): T[] {
  const unique = new Map<string, T>()
  for (const page of pages) for (const row of page) unique.set(row.id, row)
  return [...unique.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

function useThreadScroll(rowCount: number) {
  const box = useRef<HTMLDivElement>(null)
  const pending = useRef<{ mode: 'bottom' | 'preserve' | 'older'; top: number; height: number } | null>(null)
  const snapshot = useCallback((mode: 'bottom' | 'preserve' | 'older') => {
    const node = box.current
    if (node) pending.current = { mode, top: node.scrollTop, height: node.scrollHeight }
  }, [])
  const snapshotForLatest = useCallback(() => {
    const node = box.current
    if (!node) return
    snapshot(node.scrollHeight - node.scrollTop - node.clientHeight < 48 ? 'bottom' : 'preserve')
  }, [snapshot])
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const saved = pending.current
    pending.current = null
    if (!saved || saved.mode === 'bottom') node.scrollTop = node.scrollHeight
    else node.scrollTop = saved.top + node.scrollHeight - saved.height
  }, [rowCount])
  return { box, snapshot, snapshotForLatest }
}

function OlderButton({ hasOlder, loading, onClick }: { hasOlder: boolean; loading: boolean; onClick: () => void }) {
  return hasOlder ? <div className="pb-2 text-center"><Button variant="ghost" size="sm" onClick={onClick} loading={loading} disabled={loading}>Load older messages</Button></div> : null
}

export function Conversations() {
  const [rows, setRows] = useState<Conversation[] | null>(null)
  const [workRows, setWorkRows] = useState<WorkConversation[] | null>(null)
  const [error, setError] = useState('')
  const load = () => Promise.all([q<Conversation>('list_conversations'), q<WorkConversation>('list_work_conversations')]).then(([conversations, work]) => { setRows(conversations); setWorkRows(work) }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load your inbox.'))
  useEffect(() => { load() }, [])
  return (
    <Section title="Inbox">
      {error ? <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p> : null}
      {rows && workRows && rows.length + workRows.length === 0 ? <Empty title="No conversations" description="Private work conversations appear after a quote is selected." /> : null}
      {workRows?.length ? <><h2 className="mb-2 text-sm font-semibold text-[var(--ink)]">Selected work</h2><ul className="space-y-2">{workRows.map((c) => (
        <li key={`${c.target_type}:${c.target_id}`}><a href={`#/work/${c.target_type}/${c.target_id}/${c.other_id}`} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] p-3 hover:bg-[var(--panel)]"><span><span className="font-semibold text-[var(--ink)]">{c.other_name || 'Selected tradie'}</span> <span className="text-sm text-[var(--muted)]">· {c.title}</span></span><span className="text-xs text-[var(--muted)]">{when(c.last_at)}</span></a></li>
      ))}</ul></> : null}
      {rows?.length ? <h2 className="mb-2 mt-6 text-sm font-semibold text-[var(--ink)]">Enquiry messages</h2> : null}
      <ul className="space-y-2">
        {(rows ?? []).map((c) => (
          <li key={`${c.listing_id}:${c.other_id}`}>
            <a href={`#/messages/${c.listing_id}/${c.other_id}`} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] p-3 hover:bg-[var(--panel)]">
              <span><span className="font-semibold text-[var(--ink)]">{c.other_name || 'User'}</span> <span className="text-sm text-[var(--muted)]">· {c.listing_title}</span></span>
              <span className="text-xs text-[var(--muted)]">{when(c.last_at)}</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function WorkThread({ targetType, targetId, otherId }: { targetType: 'job' | 'request'; targetId: string; otherId: string }) {
  const [rows, setRows] = useState<WorkMessage[]>([])
  const [agreement, setAgreement] = useState<WorkAgreement | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const { box, snapshot, snapshotForLatest } = useThreadScroll(rows.length)
  const me = app.auth.user
  const loadLatest = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    const [messages, agreements] = await Promise.all([
      q<WorkMessage>('list_work_messages', { target_type: targetType, target_id: targetId, other_id: otherId }),
      q<WorkAgreement>('get_work_agreement', { target_type: targetType, target_id: targetId }),
    ])
    snapshotForLatest()
    setRows((current) => reset ? chronological(messages) : chronological(current, messages))
    setAgreement(agreements[0] ?? null)
    if (reset) setHasOlder(messages.length === MESSAGE_PAGE_SIZE)
    return messages
  }, [otherId, snapshotForLatest, targetId, targetType])
  const loadOlder = async () => {
    const oldest = rows[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true); setError('')
    try {
      const messages = await q<WorkMessage>('list_work_messages', { target_type: targetType, target_id: targetId, other_id: otherId, before_created_at: oldest.created_at, before_id: oldest.id })
      snapshot('older')
      setRows((current) => chronological(messages, current))
      setHasOlder(messages.length === MESSAGE_PAGE_SIZE)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older messages.') } finally { setLoadingOlder(false) }
  }
  useEffect(() => {
    void loadLatest({ reset: true }).then(() => setError('')).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load this private work conversation.'))
    const timer = setInterval(() => { void loadLatest().catch(() => undefined) }, 15_000)
    return () => clearInterval(timer)
  }, [loadLatest])
  async function send(event: FormEvent) {
    event.preventDefault(); if (!me || !body.trim()) return
    setSaving(true); setError('')
    try {
      const changes = await x('send_work_message', { id: crypto.randomUUID(), target_type: targetType, target_id: targetId, recipient_id: otherId, sender_name: me.name, body: body.trim() })
      if (!changes) throw new Error('Message not delivered. Only the selected customer and tradie can use this thread, and blocks are respected.')
      setBody(''); await loadLatest()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send this message.') } finally { setSaving(false) }
  }
  async function agree() {
    setSaving(true); setError('')
    try {
      const conversations = await q<WorkConversation>('list_work_conversations')
      const conversation = conversations.find((c) => c.target_type === targetType && c.target_id === targetId)
      if (!conversation) throw new Error('This selected quote is no longer available.')
      const changes = await x('agree_work', { quote_id: conversation.quote_id })
      if (!changes) throw new Error('Only the customer can agree to work, and it may already be agreed.')
      await loadLatest()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not agree to work.') } finally { setSaving(false) }
  }
  async function complete() {
    if (!agreement) return
    setSaving(true); setError('')
    try {
      const changes = await x('complete_work', { target_type: targetType, target_id: targetId, from: agreement.status })
      if (!changes) throw new Error('Completion could not be confirmed. Refresh and try again.')
      await loadLatest()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not confirm completion.') } finally { setSaving(false) }
  }
  const otherName = rows.find((m) => m.sender_id === otherId)?.sender_name ?? 'Work participant'
  return <Section title={otherName} action={<a href="#/messages" className="text-sm text-[var(--accent)] underline-offset-4 hover:underline">← Inbox</a>}>
    <p className="mb-3 text-sm text-[var(--muted)]">Private selected-work conversation. Quote amounts are informational only; arrange payment directly outside Tradies.</p>
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] p-3 text-sm text-[var(--ink)]"><span>{agreement ? `Work status: ${agreement.status.replace('_', ' ')}` : 'Quote selected — customer can agree to work.'}</span>{!agreement ? <Button size="sm" loading={saving} onClick={agree}>Agree to work</Button> : agreement.status !== 'completed' ? <Button size="sm" loading={saving} onClick={complete}>Confirm completion</Button> : null}</div>
    <div ref={box} className="max-h-[60dvh] space-y-2 overflow-y-auto rounded-[var(--radius)] border border-[var(--line)] p-3"><OlderButton hasOlder={hasOlder} loading={loadingOlder} onClick={() => { void loadOlder() }} />{rows.length === 0 ? <p className="text-sm text-[var(--muted)]">Discuss the scope and timing here.</p> : null}{rows.map((m) => <div key={m.id} className={`max-w-[80%] rounded-[var(--radius-sm)] px-3 py-2 text-sm ${m.sender_id === me?.id ? 'ml-auto bg-[var(--accent-soft)] text-[var(--accent-deep)]' : 'bg-[var(--paper-deep)] text-[var(--ink)]'}`}><p className="whitespace-pre-wrap">{m.body}</p><p className="mt-1 text-[10px] opacity-70">{when(m.created_at)}</p></div>)}</div>
    <form onSubmit={send} className="mt-3 flex gap-2"><div className="flex-1"><Input aria-label="Work message" placeholder="Write a message" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></div><Button type="submit" loading={saving}>Send</Button></form>
    {error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}<p className="mt-3 text-xs text-[var(--muted)]"><a href="#/settings" className="underline-offset-4 hover:underline">Block or report</a> this person from Settings.</p>
  </Section>
}

export function Thread({ listingId, otherId }: { listingId: string; otherId: string }) {
  const [rows, setRows] = useState<Message[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const { box, snapshot, snapshotForLatest } = useThreadScroll(rows.length)
  const pendingMessage = useRef<{ id: string; body: string } | null>(null)
  const me = app.auth.user

  const loadLatest = useCallback(async ({ reportFailure = false, clearError = false, reset = false }: { reportFailure?: boolean; clearError?: boolean; reset?: boolean } = {}) => {
    try {
      const [messages, listings] = await Promise.all([
        q<Message>('list_messages', { listing_id: listingId, other_id: otherId }),
        pub<Listing>('get_listing', { id: listingId }),
      ])
      snapshotForLatest()
      setRows((current) => reset ? chronological(messages) : chronological(current, messages))
      setListing(listings[0] ?? null)
      if (reset) setHasOlder(messages.length === MESSAGE_PAGE_SIZE)
      if (clearError) setError('')
      return messages
    } catch (cause) {
      if (reportFailure) setError(cause instanceof Error ? cause.message : 'Could not load this conversation.')
      return null
    }
  }, [listingId, otherId, snapshotForLatest])
  const loadOlder = async () => {
    const oldest = rows[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true); setError('')
    try {
      const messages = await q<Message>('list_messages', { listing_id: listingId, other_id: otherId, before_created_at: oldest.created_at, before_id: oldest.id })
      snapshot('older')
      setRows((current) => chronological(messages, current))
      setHasOlder(messages.length === MESSAGE_PAGE_SIZE)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older messages.') } finally { setLoadingOlder(false) }
  }
  useEffect(() => {
    void loadLatest({ reportFailure: true, clearError: true, reset: true })
    const t = setInterval(() => { void loadLatest() }, 15_000)
    return () => clearInterval(t)
  }, [loadLatest])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (saving || !me || !body.trim()) return
    const draft = body.trim()
    const id = pendingMessage.current?.body === draft ? pendingMessage.current.id : crypto.randomUUID()
    pendingMessage.current = { id, body: draft }
    setSaving(true); setError('')
    try {
      const changes = await x('send_message', { id, listing_id: listingId, recipient_id: otherId, sender_name: me.name, body: draft })
      const messages = await loadLatest()
      if (!changes && !messages?.some((message) => message.id === id)) throw new Error('Message not delivered: this thread is closed (blocked, or not your listing).')
      pendingMessage.current = null
      setBody('')
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message} Your draft was kept; retrying will use the same message id.` : 'Could not send this message. Your draft was kept; retrying is safe.')
    } finally { setSaving(false) }
  }

  const otherName = rows.find((m) => m.sender_id === otherId)?.sender_name ?? (listing?.owner_id === otherId ? listing.owner_name : 'User')
  return (
    <Section title={otherName || 'Conversation'} action={<><a href={`#/l/${listingId}`} className="text-sm text-[var(--accent)] underline-offset-4 hover:underline">{listing?.title ?? 'View listing'}</a><Button variant="ghost" size="sm" onClick={() => { void loadLatest({ reportFailure: true, clearError: true }) }}>Retry</Button></>}>
      <div ref={box} className="max-h-[60dvh] space-y-2 overflow-y-auto rounded-[var(--radius)] border border-[var(--line)] p-3">
        <OlderButton hasOlder={hasOlder} loading={loadingOlder} onClick={() => { void loadOlder() }} />
        {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">Say hello.</p> : null}
        {rows.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-[var(--radius-sm)] px-3 py-2 text-sm ${m.sender_id === me?.id ? 'ml-auto bg-[var(--accent-soft)] text-[var(--accent-deep)]' : 'bg-[var(--paper-deep)] text-[var(--ink)]'}`}>
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className="mt-1 text-[10px] opacity-70">{when(m.created_at)}</p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <div className="flex-1"><Input aria-label="Message" placeholder="Write a message" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <Button type="submit" loading={saving} disabled={saving}>Send</Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}
      <p className="mt-3 text-xs text-[var(--muted)]"><a href="#/settings" className="underline-offset-4 hover:underline">Block or report</a> this person from Settings.</p>
    </Section>
  )
}
