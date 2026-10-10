import { useEffect, useState, type ReactNode } from 'react'
import { NavBar, ProShell, useAuth, type NavItem } from '@proappstore/sdk'
import { SignInButton } from '@proappstore/sdk/ui'
import { app, q, REQUEST, CATEGORIES, type Profile, type Role } from './api'
import { Browse, Saved } from './pages/Browse'
import { ListingPage } from './pages/Listing'
import { MyRequests, Inbox } from './pages/Requests'
import { OwnerDashboard, ListingForm } from './pages/Owner'
import { Conversations, Thread } from './pages/Messages'
import { Settings } from './pages/Settings'
import { JobDetail, Jobs } from './pages/Jobs'

/**
 * Hash routes. Public: browse and listing detail (rendered without a session through
 * the public catalogue tools). Everything else needs the platform session.
 */
export type Route =
  | { name: 'browse' }
  | { name: 'jobs' }
  | { name: 'job'; id: string }
  | { name: 'listing'; id: string }
  | { name: 'saved' }
  | { name: 'requests' }
  | { name: 'quotes' }
  | { name: 'inbox' }
  | { name: 'mine' }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'messages' }
  | { name: 'thread'; listingId: string; otherId: string }
  | { name: 'settings' }

const PUBLIC = new Set<Route['name']>(['browse', 'listing', 'jobs', 'job'])

function parseHash(): Route {
  const h = location.hash
  let m = h.match(/^#\/l\/([\w:-]+)$/)
  if (m) return { name: 'listing', id: m[1]! }
  m = h.match(/^#\/jobs\/([\w:-]+)$/)
  if (m) return { name: 'job', id: m[1]! }
  m = h.match(/^#\/mine\/([\w:-]+)\/edit$/)
  if (m) return { name: 'edit', id: m[1]! }
  m = h.match(/^#\/messages\/([\w:-]+)\/([\w:.@-]+)$/)
  if (m) return { name: 'thread', listingId: m[1]!, otherId: m[2]! }
  switch (h) {
    case '#/jobs': return { name: 'jobs' }
    case '#/saved': return { name: 'saved' }
    case '#/requests': return { name: 'requests' }
    case '#/quotes': return { name: 'quotes' }
    case '#/inbox': return { name: 'inbox' }
    case '#/mine': return { name: 'mine' }
    case '#/mine/new': return { name: 'new' }
    case '#/messages': return { name: 'messages' }
    case '#/settings': return { name: 'settings' }
    default: return { name: 'browse' }
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const titles: Record<Route['name'], string> = {
      browse: 'Directory', jobs: 'Jobs', job: 'Job', listing: 'Tradie', saved: 'Saved', requests: `My ${REQUEST.plural}`, quotes: 'Quotes', inbox: 'Inbox',
      mine: 'My trade profile', new: 'Add service', edit: 'Edit service', messages: 'Inbox', thread: 'Conversation', settings: 'Settings',
    }
    document.title = `${titles[route.name]} — Tradies`
    window.scrollTo(0, 0)
  }, [route])
  return route
}

export default function App() {
  const { user, loading } = useAuth(app)
  const route = useRoute()

  if (loading) return <main id="main" className="p-8 text-sm text-[var(--muted)]">Loading…</main>

  if (!user) {
    return (
      <PublicShell>
        {PUBLIC.has(route.name) ? <Page route={route} /> : (
          <div className="mx-auto max-w-md px-6 py-16 text-center">
            <h1 className="display-font text-2xl font-semibold text-[var(--ink)]">Sign in to continue</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Saving, {REQUEST.plural}, messages and your own listings need an account.</p>
            <div className="mt-6 flex justify-center"><SignInButton app={app} /></div>
          </div>
        )}
      </PublicShell>
    )
  }

  return <SignedInApp route={route} />
}

function SignedInApp({ route }: { route: Route }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [error, setError] = useState('')
  const load = () => {
    setError('')
    q<Profile>('get_my_profile').then((rows) => setProfile(rows[0] ?? null)).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Could not load your profile.')
      setProfile(null)
    })
  }
  useEffect(() => { load() }, [])
  if (profile === undefined) return <main id="main" className="p-8 text-sm text-[var(--muted)]">Loading your Tradies profile…</main>
  if (error) return <main id="main" className="p-8 text-sm text-[var(--danger)]">{error} <button type="button" className="underline" onClick={load}>Try again</button></main>
  if (profile === null) return <ProfileSetup onDone={load} />
  return (
    <ProShell app={app} appName="Tradies" nav={navFor(profile.role)} renderNav={({ items }) => <HashNav items={items} />}>
      <div className="flex-1"><Page route={route} /></div>
    </ProShell>
  )
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'browse': return <Browse />
    case 'jobs': return <Jobs />
    case 'job': return <JobDetail id={route.id} />
    case 'listing': return <ListingPage id={route.id} />
    case 'saved': return <Saved />
    case 'requests': return <MyRequests />
    case 'quotes': return <MyRequests title="Quotes" />
    case 'inbox': return <Inbox />
    case 'mine': return <OwnerDashboard />
    case 'new': return <ListingForm />
    case 'edit': return <ListingForm id={route.id} />
    case 'messages': return <Conversations />
    case 'thread': return <Thread listingId={route.listingId} otherId={route.otherId} />
    case 'settings': return <Settings />
  }
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header right={<SignInButton app={app} label="Sign in" />} />
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-[var(--line)] px-6 py-4 text-center text-xs text-[var(--muted)]">
        <a href="https://proappstore.online" className="font-semibold text-[var(--accent)] underline-offset-4 hover:underline">Built for ProAppStore</a>
      </footer>
    </div>
  )
}

/** The signed-in screens. ProShell renders these as its main navigation (<nav aria-label="Main">). */
function navFor(role: Role): NavItem[] {
  return [
    { label: 'Directory', href: '#/' },
    { label: 'Jobs', href: '#/jobs' },
    { label: 'Quotes', href: '#/quotes' },
    { label: 'Inbox', href: role === 'tradie' ? '#/inbox' : '#/messages' },
    { label: 'Saved', href: '#/saved' },
    ...(role === 'tradie' ? [{ label: 'My trade profile', href: '#/mine' }] : []),
    { label: 'Settings', href: '#/settings' },
  ]
}

/** Signed out, only browsing is public — this frame renders outside ProShell, so it carries its own landmarks. */
function Header({ right }: { right: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--panel-strong)] backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-[var(--paper)] focus:px-2 focus:py-1">Skip to content</a>
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <a href="#/" className="display-font text-lg font-bold text-[var(--ink)]">Tradies</a>
        <HashNav items={[{ label: 'Directory', href: '#/' }, { label: 'Jobs', href: '#/jobs' }]} />
        <div className="flex items-center gap-2">{right}</div>
      </div>
    </header>
  )
}

/** ProShell's NavBar, marking the current screen: this app routes by hash, the NavBar by default by path. */
function HashNav({ items }: { items: NavItem[] }) {
  const [hash, setHash] = useState(currentHash)
  useEffect(() => {
    const onHash = () => setHash(currentHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  return <NavBar items={items} currentPath={hash} />
}

function currentHash(): string {
  return (location.hash || '#/').split('?')[0]!
}

function ProfileSetup({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState<Role>('customer')
  const [tradeCategory, setTradeCategory] = useState<string>(CATEGORIES[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setSaving(true)
    setError('')
    try {
      const changes = await app.actions.call<{ meta: { changes: number } }>('create_profile', { role, trade_category: role === 'tradie' ? tradeCategory : '' })
      if (!changes.meta.changes) throw new Error('Your role could not be saved. Please try again.')
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your role.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl items-center px-6 py-12">
      <div className="w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel-strong)] p-6 shadow-[var(--shadow-card)]">
        <p className="text-sm font-semibold text-[var(--accent)]">Tradies</p>
        <h1 className="display-font mt-1 text-3xl font-semibold text-[var(--ink)]">How will you use Tradies?</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Choose one role to keep public jobs and private enquiries safely separated.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setRole('customer')} className={`rounded-[var(--radius-sm)] border p-4 text-left ${role === 'customer' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`}><strong className="text-[var(--ink)]">Customer</strong><span className="mt-1 block text-sm text-[var(--muted)]">Post a job and send private enquiries to tradies.</span></button>
          <button type="button" onClick={() => setRole('tradie')} className={`rounded-[var(--radius-sm)] border p-4 text-left ${role === 'tradie' ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'}`}><strong className="text-[var(--ink)]">Tradie</strong><span className="mt-1 block text-sm text-[var(--muted)]">Create a public service profile and respond privately.</span></button>
        </div>
        {role === 'tradie' ? <label className="mt-4 block text-sm font-semibold text-[var(--ink)]">Primary trade<select aria-label="Primary trade" value={tradeCategory} onChange={(event) => setTradeCategory(event.target.value)} className="mt-1 block w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-sm">{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        <button type="button" aria-label="Save role and continue" disabled={saving} onClick={save} className="mt-6 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    </main>
  )
}
