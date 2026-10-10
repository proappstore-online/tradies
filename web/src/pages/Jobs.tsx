import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Input } from '@proappstore/sdk/ui'
import { app, pub, q, x, CATEGORIES, type Job, type Profile } from '../api'
import { Empty, Field, Section, Status, TextArea } from '../components'

/** Public job board. Customer identity, contact details and exact addresses never leave scoped actions. */
export function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [mine, setMine] = useState<Job[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const publicJobs = await pub<Job>('list_jobs')
      setJobs(publicJobs)
      if (app.auth.user) {
        const [profiles, ownJobs] = await Promise.all([q<Profile>('get_my_profile'), q<Job>('list_my_jobs')])
        setProfile(profiles[0] ?? null)
        setMine(ownJobs)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load jobs.')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function post(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      const changes = await x('create_job', {
        id: crypto.randomUUID(), title: title.trim(), description: description.trim(), category, location: location.trim(),
      })
      if (!changes) throw new Error('Only a customer can post a job.')
      setTitle('')
      setDescription('')
      setLocation('')
      setShowForm(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not post the job.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(job: Job) {
    await x('set_job_status', { id: job.id, from: job.status, to: job.status === 'open' ? 'closed' : 'open' })
    await load()
  }

  const customer = profile?.role === 'customer'
  return (
    <Section title="Jobs" action={customer ? <Button onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Post a job'}</Button> : undefined}>
      <p className="mb-5 max-w-2xl text-sm text-[var(--muted)]">Jobs show a broad service area only. Customers and tradies agree precise details privately in an enquiry.</p>
      {error ? <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"><span>{error}</span><Button variant="ghost" size="sm" onClick={load}>Try again</Button></div> : null}
      {showForm ? (
        <form onSubmit={post} className="mb-6 max-w-xl space-y-3 rounded-[var(--radius)] border border-[var(--line)] p-4">
          <Field label="What do you need done?"><Input aria-label="Job title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Job details"><TextArea aria-label="Job details" rows={5} maxLength={4000} placeholder="Describe the work. Do not include an address or contact details here." value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Trade"><select aria-label="Trade" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--ink)]">{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Service area"><Input aria-label="Service area" placeholder="Suburb, city or region" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          </div>
          <Button type="submit" loading={saving}>Publish job</Button>
        </form>
      ) : null}
      {customer && mine?.length ? (
        <div className="mb-6">
          <h2 className="display-font mb-2 text-xl font-semibold text-[var(--ink)]">My jobs</h2>
          <ul className="space-y-2">{mine.map((job) => <li key={job.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] p-3"><div><p className="font-semibold text-[var(--ink)]">{job.title}</p><p className="text-xs text-[var(--muted)]">{[job.category, job.location].filter(Boolean).join(' · ')}</p></div><div className="flex items-center gap-2"><Status value={job.status} /><Button variant="ghost" size="sm" onClick={() => toggle(job)}>{job.status === 'open' ? 'Close' : 'Re-open'}</Button></div></li>)}</ul>
        </div>
      ) : null}
      <h2 className="display-font mb-3 text-xl font-semibold text-[var(--ink)]">Open jobs</h2>
      {jobs === null ? <p className="text-sm text-[var(--muted)]">Loading jobs…</p> : null}
      {jobs?.length === 0 ? <Empty title="No open jobs yet" description="Customers can post a job when they need a local tradie." /> : null}
      <ul className="space-y-3">{(jobs ?? []).map((job) => <li key={job.id} className="rounded-[var(--radius-sm)] border border-[var(--line)] p-4"><p className="font-semibold text-[var(--ink)]">{job.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{[job.category, job.location].filter(Boolean).join(' · ')}</p>{job.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{job.description}</p> : null}</li>)}</ul>
    </Section>
  )
}
