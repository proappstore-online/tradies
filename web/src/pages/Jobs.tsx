import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, pub, q, x, CATEGORIES, type Job, type Profile } from '../api'
import { Empty, Field, Section, Status, TextArea } from '../components'
import { CustomerQuoteComparison, QuoteForm } from './Quotes'

/** Public actions return lead-safe fields only. Owner actions carry private job detail. */
export function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [mine, setMine] = useState<Job[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const publicJobs = await pub<Job>('list_jobs', { category: category || undefined, location: location.trim() || undefined })
      setJobs(publicJobs)
      if (app.auth.user) {
        const [profiles, ownJobs] = await Promise.all([q<Profile>('get_my_profile'), q<Job>('list_my_jobs')])
        setProfile(profiles[0] ?? null); setMine(ownJobs)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load jobs.') }
  }, [category, location])
  useEffect(() => { load() }, [load])
  const customer = profile?.role === 'customer'
  return <Section title="Jobs" action={customer ? <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close form' : 'Post a job'}</Button> : undefined}>
    <p className="mb-5 max-w-2xl text-sm text-[var(--muted)]">Open jobs show only the trade, work summary and broad service area. Exact addresses and contact preferences stay private until a customer authorises the next step.</p>
    {error ? <ErrorNotice error={error} retry={load} /> : null}
    {showForm ? <JobEditor onDone={async () => { setShowForm(false); await load() }} onCancel={() => setShowForm(false)} /> : null}
    {customer && mine?.length ? <MyJobs jobs={mine} /> : null}
    <form onSubmit={(e) => { e.preventDefault(); load() }} className="mb-5 grid gap-3 rounded-[var(--radius)] border border-[var(--line)] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label="Trade"><select aria-label="Filter jobs by trade" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]"><option value="">All trades</option>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
      <Field label="Location"><Input aria-label="Filter jobs by location" placeholder="Suburb, city or region" value={location} onChange={(e) => setLocation(e.target.value)} /></Field><Button type="submit">Filter jobs</Button>
    </form>
    <h2 className="display-font mb-3 text-xl font-semibold text-[var(--ink)]">Open jobs</h2>
    {jobs === null ? <p className="text-sm text-[var(--muted)]">Loading jobs…</p> : null}
    {jobs?.length === 0 ? <Empty title="No matching open jobs" description="Try another trade or service area, or check back soon." /> : null}
    <ul className="grid gap-3 sm:grid-cols-2">{(jobs ?? []).map((job) => <JobCard key={job.id} job={job} />)}</ul>
  </Section>
}

export function JobDetail({ id }: { id: string }) {
  const [publicJob, setPublicJob] = useState<Job | null | undefined>(undefined)
  const [ownJob, setOwnJob] = useState<Job | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setError('')
    try {
      const [publicRows, ownRows, profileRows] = await Promise.all([pub<Job>('get_job', { id }), app.auth.user ? q<Job>('get_my_job', { id }) : Promise.resolve([] as Job[]), app.auth.user ? q<Profile>('get_my_profile') : Promise.resolve([] as Profile[])])
      setPublicJob(publicRows[0] ?? null); setOwnJob(ownRows[0] ?? null); setProfile(profileRows[0] ?? null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this job.'); setPublicJob(null); setOwnJob(null); setProfile(null) }
  }, [id])
  useEffect(() => { load() }, [load])
  const job = ownJob ?? publicJob
  async function transition(to: 'open' | 'closed') {
    if (!ownJob) return
    setSaving(true); setError('')
    try { const changes = await x('set_job_status', { id, from: ownJob.lifecycle, to }); if (!changes) throw new Error('This job changed before it could be updated. Refresh and try again.'); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this job.') } finally { setSaving(false) }
  }
  if (publicJob === undefined || ownJob === undefined || profile === undefined) return <Section title="Job"><p className="text-sm text-[var(--muted)]">Loading job…</p></Section>
  if (!job) return <Section title="Job"><Empty title="This job is not available" description="It may be closed, saved as a draft, or no longer accepting leads." /></Section>
  return <Section title={job.title} action={<a href="#/jobs" className="text-sm font-semibold text-[var(--accent)]">← All jobs</a>}>
    {error ? <ErrorNotice error={error} retry={load} /> : null}
    {editing && ownJob ? <JobEditor key={`${ownJob.id}-${ownJob.updated_at}`} job={ownJob} onDone={async () => { setEditing(false); await load() }} onCancel={() => setEditing(false)} /> : null}
    <article className="max-w-2xl rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-5">
      <div className="flex flex-wrap items-center gap-2"><Status value={job.lifecycle} /><span className="text-sm text-[var(--muted)]">{[job.category, job.location].filter(Boolean).join(' · ')}</span></div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{job.description}</p>
      {ownJob ? <PrivateDetails job={ownJob} /> : <p className="mt-5 text-sm text-[var(--muted)]">Customer identity, exact address and contact preferences are kept private. Use a future quote or approved conversation to agree the next step.</p>}
      {ownJob ? <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
        {ownJob.lifecycle !== 'closed' ? <Button variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? 'Keep viewing' : 'Edit job'}</Button> : null}
        {ownJob.lifecycle === 'draft' ? <Button loading={saving} onClick={() => transition('open')}>Publish job</Button> : null}
        {ownJob.lifecycle === 'open' ? <Button loading={saving} variant="ghost" onClick={() => transition('closed')}>Close job</Button> : null}
        {ownJob.lifecycle === 'closed' ? <Button loading={saving} onClick={() => transition('open')}>Re-open job</Button> : null}
      </div> : null}
    </article>
    {ownJob ? <CustomerQuoteComparison targetType="job" targetId={ownJob.id} /> : null}
    {!ownJob && profile?.role === 'tradie' && publicJob ? <QuoteForm targetType="job" targetId={publicJob.id} onDone={load} /> : null}
  </Section>
}

function MyJobs({ jobs }: { jobs: Job[] }) {
  return <div className="mb-7"><h2 className="display-font mb-3 text-xl font-semibold text-[var(--ink)]">My jobs</h2><ul className="space-y-2">{jobs.map((job) => <li key={job.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-3 sm:flex-row sm:items-center sm:justify-between"><div><a href={`#/jobs/${job.id}`} className="font-semibold text-[var(--ink)] hover:text-[var(--accent)]">{job.title}</a><p className="text-xs text-[var(--muted)]">{[job.category, job.location].filter(Boolean).join(' · ')}</p></div><Status value={job.lifecycle} /></li>)}</ul></div>
}
function JobCard({ job }: { job: Job }) {
  return <li className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--panel-strong)] p-4"><a href={`#/jobs/${job.id}`} className="block"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-[var(--ink)]">{job.title}</h3><Status value="open" /></div><p className="mt-1 text-xs text-[var(--muted)]">{[job.category, job.location].filter(Boolean).join(' · ')}</p><p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-[var(--ink)]">{job.description}</p><span className="mt-4 block text-sm font-semibold text-[var(--accent)]">View job →</span></a></li>
}
function JobEditor({ job, onDone, onCancel }: { job?: Job; onDone: () => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(job?.title ?? ''); const [description, setDescription] = useState(job?.description ?? '')
  const [category, setCategory] = useState(job?.category ?? CATEGORIES[0]); const [location, setLocation] = useState(job?.location ?? '')
  const [privateAddress, setPrivateAddress] = useState(job?.private_address ?? ''); const [contactDetails, setContactDetails] = useState(job?.contact_details ?? '')
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const lifecycle = new FormData(event.currentTarget).get('intent') === 'open' ? 'open' : 'draft'; setSaving(true); setError('')
    try {
      const values = { title: title.trim(), description: description.trim(), category, location: location.trim(), private_address: privateAddress.trim(), contact_details: contactDetails.trim() }
      const changes = job ? await x('update_job', { id: job.id, ...values }) : await x('create_job', { id: crypto.randomUUID(), lifecycle, ...values })
      if (!changes) throw new Error(job ? 'Only the customer who owns an open or draft job can edit it.' : 'Complete the required public job details before saving.')
      await onDone()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this job.') } finally { setSaving(false) }
  }
  return <form onSubmit={save} className="mb-6 max-w-2xl space-y-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-4 sm:p-5">
    <h2 className="display-font text-xl font-semibold text-[var(--ink)]">{job ? 'Edit job' : 'Post a job'}</h2><p className="text-sm text-[var(--muted)]">The work summary, trade and broad service area are visible to tradies. Keep exact address and contact details in the private fields below.</p>{error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    <Field label="What do you need done?"><Input aria-label="Job title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
    <Field label="Public work details"><TextArea aria-label="Job details" required rows={5} maxLength={4000} placeholder="Describe the work without an address or contact details." value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Trade"><select aria-label="Trade" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]">{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field><Field label="Broad service area"><Input aria-label="Service area" required maxLength={120} placeholder="Suburb, city or region" value={location} onChange={(e) => setLocation(e.target.value)} /></Field></div>
    <div className="grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2"><Field label="Exact address (private)"><Input aria-label="Exact address" maxLength={500} placeholder="Visible only to you for now" value={privateAddress} onChange={(e) => setPrivateAddress(e.target.value)} /></Field><Field label="Contact preference (private)"><Input aria-label="Contact preference" maxLength={500} placeholder="e.g. message first" value={contactDetails} onChange={(e) => setContactDetails(e.target.value)} /></Field></div>
    <div className="flex flex-wrap gap-2"><Button type="submit" name="intent" value="draft" loading={saving}>{job ? 'Save changes' : 'Save draft'}</Button>{job ? null : <Button type="submit" name="intent" value="open" variant="ghost" disabled={saving}>Publish now</Button>}<Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button></div>
  </form>
}
function PrivateDetails({ job }: { job: Job }) {
  if (!job.private_address && !job.contact_details) return <p className="mt-5 text-sm text-[var(--muted)]">No private address or contact preference has been added.</p>
  return <div className="mt-5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] p-4 text-sm"><p className="font-semibold text-[var(--ink)]">Private details — visible only to you</p>{job.private_address ? <p className="mt-2 text-[var(--ink)]"><span className="font-semibold">Address:</span> {job.private_address}</p> : null}{job.contact_details ? <p className="mt-2 text-[var(--ink)]"><span className="font-semibold">Contact:</span> {job.contact_details}</p> : null}</div>
}
function ErrorNotice({ error, retry }: { error: string; retry: () => void }) {
  return <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"><span>{error}</span><Button variant="ghost" size="sm" onClick={retry}>Try again</Button></div>
}
