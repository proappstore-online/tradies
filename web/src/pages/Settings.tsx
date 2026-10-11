import { useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, q, x, when } from '../api'
import { Field, Section, TextArea } from '../components'

/**
 * Safety controls. Ids are platform user ids as they appear in threads and requests
 * (paste from a conversation URL). The role profile stores only a selected role and trade;
 * contact details remain platform-private and are never exposed in public actions.
 */
export function Settings() {
  const [blocks, setBlocks] = useState<{ blocked_id: string; created_at: number }[]>([])
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('spam')
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [pending, setPending] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      setBlocks(await q<{ blocked_id: string; created_at: number }>('list_blocks'))
      return true
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load your blocked users.')
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function block(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setActionError('')
    setFlash('')
    try {
      const changes = await x('block_user', { blocked_id: target.trim() })
      if (!changes) {
        setFlash('Nothing changed.')
        return
      }
      setFlash('Blocked. They can no longer message you or request your listings.')
      setTarget('')
      if (!await load()) setFlash('Blocked, but your blocked list could not be refreshed.')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not block this user.')
    } finally {
      setPending(false)
    }
  }

  async function report(e: FormEvent) {
    e.preventDefault()
    if (pending) return
    if (!target.trim()) {
      setActionError('Enter a user id before sending a report.')
      return
    }
    setPending(true)
    setActionError('')
    setFlash('')
    try {
      const changes = await x('report_user', { reported_id: target.trim(), reason, note })
      setFlash(changes ? 'Report sent to the app owner.' : 'Nothing changed.')
      if (changes) setNote('')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not send this report.')
    } finally {
      setPending(false)
    }
  }

  async function unblock(blockedId: string) {
    if (pending) return
    setPending(true)
    setActionError('')
    setFlash('')
    try {
      const changes = await x('unblock_user', { blocked_id: blockedId })
      if (!changes) {
        setFlash('Nothing changed.')
        return
      }
      setFlash('Unblocked.')
      if (!await load()) setFlash('Unblocked, but your blocked list could not be refreshed.')
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not unblock this user.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Section title="Settings">
      <p className="text-sm text-[var(--muted)]">Signed in as <strong className="text-[var(--ink)]">{app.auth.user?.name}</strong>. Your role, services, jobs and private enquiries are scoped to your account. Archive services to remove them from the directory.</p>

      <h2 className="display-font mt-8 text-xl font-semibold text-[var(--ink)]">Block or report</h2>
      <form className="mt-3 max-w-xl space-y-3" onSubmit={block}>
        <Field label="User id"><Input aria-label="User id" placeholder="From the conversation URL, e.g. gh:12345" required value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Reason">
            <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]">
              {['spam', 'scam', 'abuse', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Details"><TextArea aria-label="Details" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={pending}>Block</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={(e) => { void report(e as unknown as FormEvent) }}>Report</Button>
        </div>
      </form>
      {flash ? <p role="status" className="mt-3 text-sm text-[var(--muted)]">{flash}</p> : null}
      {actionError ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{actionError}</p> : null}
      {loadError ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{loadError} <Button type="button" variant="ghost" size="sm" disabled={loading || pending} onClick={() => { void load() }}>Retry</Button></p> : null}

      <h2 className="display-font mt-8 text-xl font-semibold text-[var(--ink)]">Blocked</h2>
      {loading ? <p className="mt-2 text-sm text-[var(--muted)]">Loading blocked users…</p> : null}
      {!loading && !loadError && blocks.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">Nobody.</p> : null}
      <ul className="mt-2 space-y-2">
        {blocks.map((b) => (
          <li key={b.blocked_id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] p-3 text-sm">
            <span className="text-[var(--ink)]">{b.blocked_id} <span className="text-[var(--muted)]">· since {when(b.created_at)}</span></span>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => { void unblock(b.blocked_id) }}>Unblock</Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
