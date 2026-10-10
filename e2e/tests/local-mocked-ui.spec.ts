import { expect, test, type Browser, type BrowserContext, type Page, type Request as PlaywrightRequest } from '@playwright/test'

/**
 * Local-only browser acceptance coverage.  No real PAS credential, cookie, or
 * API is used here: a harmless e2e_session cookie selects one of these mock
 * identities and page.route() implements the platform-cookie endpoints.
 */
type Role = 'customer' | 'tradie' | 'rivalTradie' | 'outsider'
type User = { id: string; login: string; name: string }
type PublicListing = { id: string; owner_id: string; owner_name: string; status: 'active' | 'paused'; title: string; description: string; category: string; location: string; lat: number | null; lng: number | null; images: string; created_at: number; updated_at: number }
type Job = { id: string; lifecycle: 'draft' | 'open' | 'closed'; title: string; description: string; category: string; location: string; private_address?: string; contact_details?: string; created_at: number; updated_at: number; owner_id: string }
type Quote = { id: string; target_type: 'job' | 'request'; target_id: string; status: 'submitted' | 'accepted' | 'declined'; scope: string; amount: number; currency: string; timing: string; valid_until: number | null; notes: string; revision: number; created_at: number; updated_at: number; accepted_at: number | null; tradie_id: string }
type Request = { id: string; listing_id: string; requester_id: string; requester_name: string; status: 'pending' | 'accepted' | 'completed'; note: string; created_at: number; updated_at: number; listing_title: string; owner_id: string; owner_name: string }
type WorkMessage = { id: string; target_type: 'job' | 'request'; target_id: string; sender_id: string; sender_name: string; recipient_id: string; body: string; created_at: number }
type DirectMessage = { id: string; listing_id: string; sender_id: string; sender_name: string; recipient_id: string; body: string; created_at: number }
type Agreement = { target_type: 'job' | 'request'; target_id: string; quote_id: string; status: 'agreed' | 'customer_completed' | 'tradie_completed' | 'completed'; agreed_at: number; updated_at: number; completed_at: number | null }

const users: Record<Role, User> = {
  customer: { id: 'customer-1', login: 'casey.customer', name: 'Casey Customer' },
  tradie: { id: 'tradie-1', login: 'taylor.tradie', name: 'Taylor Tradie' },
  rivalTradie: { id: 'rival-tradie-1', login: 'riley.tradie', name: 'Riley Tradie' },
  outsider: { id: 'outsider-1', login: 'olivia.outsider', name: 'Olivia Outsider' },
}

const now = 1_700_000_000_000

function seed() {
  return {
    jobs: [] as Job[],
    quotes: [] as Quote[],
    requests: [] as Request[],
    messages: [] as WorkMessage[],
    directMessages: [] as DirectMessage[],
    agreements: [] as Agreement[],
    listing: { id: 'listing-1', owner_id: users.tradie.id, owner_name: users.tradie.name, status: 'active', title: 'Taylor Plumbing', description: 'Licensed plumbing repairs and installations.', category: 'plumber', location: 'Melbourne', lat: null, lng: null, images: '[]', created_at: now, updated_at: now } as PublicListing,
    providerListings: [] as PublicListing[],
    delayDirectory: false,
    failJobs: false,
    failQuoteLoads: 0,
    failMessageLoads: 0,
    failMessageSendAfterPersist: 0,
    delayMessageSendMs: 0,
    directSendIds: [] as string[],
  }
}

type Store = ReturnType<typeof seed>

function roleFor(request: PlaywrightRequest): Role | null {
  const session = request.headers().cookie?.match(/(?:^|;\s*)e2e_session=([^;]+)/)?.[1]
  return session === 'customer' || session === 'tradie' || session === 'rivalTradie' || session === 'outsider' ? session : null
}

function rows(rows: unknown[]) { return { rows } }
function changes(n = 1) { return { meta: { changes: n } } }
function messagePage<T extends { id: string; created_at: number }>(items: T[], params: Record<string, unknown>) {
  const beforeCreatedAt = params.before_created_at === undefined ? null : Number(params.before_created_at)
  const beforeId = params.before_id === undefined ? null : String(params.before_id)
  return items.filter((item) => beforeCreatedAt === null || item.created_at < beforeCreatedAt || (item.created_at === beforeCreatedAt && beforeId !== null && item.id < beforeId))
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id)).slice(0, 100)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

function targetOwner(store: Store, type: 'job' | 'request', id: string) {
  if (type === 'job') return store.jobs.find((job) => job.id === id)?.owner_id
  return store.requests.find((request) => request.id === id)?.requester_id
}

function selectedQuote(store: Store, type: 'job' | 'request', id: string) {
  return store.quotes.find((quote) => quote.target_type === type && quote.target_id === id && quote.status === 'accepted')
}

async function mockedContext(browser: Browser, role: Role, store: Store): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'e2e_session', value: role, url: 'http://127.0.0.1:4187', sameSite: 'Lax' }])
  const routePas = async (route: import('@playwright/test').Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const currentRole = roleFor(request)
    const currentUser = currentRole ? users[currentRole] : null
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.pathname === '/.pas/auth/me') return json(currentUser ?? { error: 'signed out' }, currentUser ? 200 : 401)
    if (url.pathname.includes('/roles/ensure-member')) return json(changes())
    const action = url.pathname.match(/\/actions\/([^/]+)$/)?.[1]
    if (!action) return json(changes())
    // callPublic reaches api.proappstore.online without the local mock cookie;
    // those actions must remain available to an anonymous browser.
    const publicAction = ['list_listings', 'get_listing', 'list_reviews', 'listing_stats', 'list_jobs', 'get_job'].includes(action)
    if (!currentUser && !publicAction) return json({ error: 'signed out' }, 401)
    const body = request.postDataJSON() as { params?: Record<string, unknown> }
    const params = body.params ?? {}
    const type = (params.target_type ?? 'job') as 'job' | 'request'
    const targetId = String(params.target_id ?? params.job_id ?? params.request_id ?? '')
    const isOwner = (targetType: 'job' | 'request', id: string) => targetOwner(store, targetType, id) === currentUser.id
    const workAllowed = (targetType: 'job' | 'request', id: string) => {
      const quote = selectedQuote(store, targetType, id)
      return !!quote && (quote.tradie_id === currentUser.id || isOwner(targetType, id))
    }
    const quoteForCustomer = (quote: Quote) => {
      const listing = [store.listing, ...store.providerListings].find((item) => item.owner_id === quote.tradie_id && item.status === 'active')
      return { ...quote, provider_user_id: quote.tradie_id, provider_trade_category: 'plumber', provider_profile_id: listing?.id ?? null, provider_display_name: listing?.title ?? null, provider_has_listing: listing ? 1 : 0 }
    }

    switch (action) {
      case 'list_listings':
        if (store.delayDirectory) await new Promise((resolve) => setTimeout(resolve, 700))
        return json(rows([store.listing, ...store.providerListings].filter((listing) => listing.status === 'active')))
      case 'get_listing': return json(rows([store.listing, ...store.providerListings].filter((listing) => String(params.id) === listing.id && listing.status === 'active')))
      case 'list_reviews': return json(rows([]))
      case 'listing_stats': return json(rows([{ review_count: 0, avg_rating: null }]))
      case 'list_my_favorite_ids': case 'list_my_favorites': return json(rows([]))
      case 'get_my_profile': return json(rows([{ user_id: currentUser.id, role: currentRole === 'tradie' || currentRole === 'rivalTradie' ? 'tradie' : 'customer', trade_category: currentRole === 'tradie' || currentRole === 'rivalTradie' ? 'plumber' : '' }]))
      case 'list_jobs':
        if (store.failJobs) return json({ error: 'mock job service unavailable' }, 500)
        return json(rows(store.jobs.filter((job) => job.lifecycle === 'open').map(({ owner_id, private_address, contact_details, ...job }) => job)))
      case 'list_my_jobs': return json(rows(store.jobs.filter((job) => job.owner_id === currentUser.id)))
      case 'get_job': {
        const job = store.jobs.find((item) => item.id === params.id && item.lifecycle === 'open')
        return json(rows(job ? [job] : []))
      }
      case 'get_my_job': return json(rows(store.jobs.filter((job) => job.id === params.id && job.owner_id === currentUser.id)))
      case 'create_job': {
        if (currentRole !== 'customer') return json(changes(0))
        const job: Job = { id: String(params.id), lifecycle: (params.lifecycle === 'open' ? 'open' : 'draft'), title: String(params.title), description: String(params.description), category: String(params.category), location: String(params.location), private_address: String(params.private_address ?? ''), contact_details: String(params.contact_details ?? ''), created_at: now, updated_at: now, owner_id: currentUser.id }
        store.jobs.push(job); return json(changes())
      }
      case 'create_job_quote': {
        const job = store.jobs.find((item) => item.id === params.job_id && item.lifecycle === 'open')
        if (currentRole !== 'tradie' || !job) return json(changes(0))
        store.quotes.push({ id: String(params.id), target_type: 'job', target_id: job.id, status: 'submitted', scope: String(params.scope), amount: Number(params.amount), currency: String(params.currency), timing: String(params.timing), valid_until: params.valid_until ? Number(params.valid_until) : null, notes: String(params.notes ?? ''), revision: 1, created_at: now, updated_at: now, accepted_at: null, tradie_id: currentUser.id })
        return json(changes())
      }
      case 'list_my_quotes':
        if (store.failQuoteLoads > 0) { store.failQuoteLoads--; return json({ error: 'mock quote service unavailable' }, 500) }
        return json(rows(store.quotes.filter((quote) => quote.tradie_id === currentUser.id)))
      case 'list_job_quotes': return json(rows(isOwner('job', String(params.job_id)) ? store.quotes.filter((quote) => quote.target_type === 'job' && quote.target_id === params.job_id).map(quoteForCustomer) : []))
      case 'revise_quote': {
        const quote = store.quotes.find((item) => item.id === params.id)
        if (!quote || quote.tradie_id !== currentUser.id || quote.status !== 'submitted' || Number(params.expected_revision) !== quote.revision) return json(changes(0))
        quote.scope = String(params.scope); quote.amount = Number(params.amount); quote.currency = String(params.currency); quote.timing = String(params.timing); quote.valid_until = params.valid_until ? Number(params.valid_until) : null; quote.notes = String(params.notes ?? ''); quote.revision += 1; quote.updated_at = now
        return json(changes())
      }
      case 'accept_quote': case 'decline_quote': {
        const quote = store.quotes.find((item) => item.id === params.id)
        if (!quote || !isOwner(quote.target_type, quote.target_id) || quote.status !== params.from || (action === 'accept_quote' && Number(params.expected_revision) !== quote.revision)) return json(changes(0))
        quote.status = action === 'accept_quote' ? 'accepted' : 'declined'; quote.accepted_at = action === 'accept_quote' ? now : null
        return json(changes())
      }
      case 'create_request': {
        if (currentRole !== 'customer' || params.listing_id !== store.listing.id) return json(changes(0))
        store.requests.push({ id: String(params.id), listing_id: store.listing.id, requester_id: currentUser.id, requester_name: currentUser.name, status: 'pending', note: String(params.note), created_at: now, updated_at: now, listing_title: store.listing.title, owner_id: store.listing.owner_id, owner_name: store.listing.owner_name })
        return json(changes())
      }
      case 'list_my_requests': return json(rows(store.requests.filter((item) => item.requester_id === currentUser.id)))
      case 'list_incoming_requests': return json(rows(store.requests.filter((item) => item.owner_id === currentUser.id)))
      case 'create_request_quote': {
        const requestRow = store.requests.find((item) => item.id === params.request_id)
        if (currentRole !== 'tradie' || requestRow?.owner_id !== currentUser.id) return json(changes(0))
        store.quotes.push({ id: String(params.id), target_type: 'request', target_id: requestRow.id, status: 'submitted', scope: String(params.scope), amount: Number(params.amount), currency: String(params.currency), timing: String(params.timing), valid_until: params.valid_until ? Number(params.valid_until) : null, notes: String(params.notes ?? ''), revision: 1, created_at: now, updated_at: now, accepted_at: null, tradie_id: currentUser.id })
        return json(changes())
      }
      case 'list_request_quotes': return json(rows(isOwner('request', String(params.request_id)) ? store.quotes.filter((quote) => quote.target_type === 'request' && quote.target_id === params.request_id).map(quoteForCustomer) : []))
      case 'list_messages': {
        if (store.failMessageLoads > 0) { store.failMessageLoads--; return json({ error: 'mock message service unavailable' }, 500) }
        return json(rows(messagePage(store.directMessages.filter((message) => message.listing_id === params.listing_id && ((message.sender_id === currentUser.id && message.recipient_id === params.other_id) || (message.sender_id === params.other_id && message.recipient_id === currentUser.id))), params)))
      }
      case 'send_message': {
        const allowed = store.requests.some((requestRow) => requestRow.listing_id === params.listing_id && ((requestRow.requester_id === currentUser.id && requestRow.owner_id === params.recipient_id) || (requestRow.owner_id === currentUser.id && requestRow.requester_id === params.recipient_id)))
        if (!allowed || params.recipient_id === currentUser.id) return json(changes(0))
        const id = String(params.id)
        store.directSendIds.push(id)
        const exists = store.directMessages.some((message) => message.id === id)
        if (!exists) store.directMessages.push({ id, listing_id: String(params.listing_id), sender_id: currentUser.id, sender_name: currentUser.name, recipient_id: String(params.recipient_id), body: String(params.body), created_at: now })
        if (store.delayMessageSendMs) await new Promise((resolve) => setTimeout(resolve, store.delayMessageSendMs))
        if (store.failMessageSendAfterPersist > 0) { store.failMessageSendAfterPersist--; return json({ error: 'mock connection dropped after persistence' }, 500) }
        return json(changes(exists ? 0 : 1))
      }
      case 'list_work_conversations': {
        const result = store.quotes.filter((quote) => quote.status === 'accepted' && (quote.tradie_id === currentUser.id || isOwner(quote.target_type, quote.target_id))).map((quote) => ({ target_type: quote.target_type, target_id: quote.target_id, quote_id: quote.id, title: quote.target_type === 'job' ? store.jobs.find((job) => job.id === quote.target_id)?.title : store.requests.find((item) => item.id === quote.target_id)?.listing_title, other_id: quote.tradie_id === currentUser.id ? targetOwner(store, quote.target_type, quote.target_id) : quote.tradie_id, other_name: quote.tradie_id === currentUser.id ? users.customer.name : users.tradie.name, last_at: now }))
        return json(rows(result))
      }
      case 'list_work_messages': return json(rows(workAllowed(type, targetId) ? messagePage(store.messages.filter((item) => item.target_type === type && item.target_id === targetId), params) : []))
      case 'get_work_agreement': return json(rows(workAllowed(type, targetId) ? store.agreements.filter((item) => item.target_type === type && item.target_id === targetId) : []))
      case 'send_work_message': {
        if (!workAllowed(type, targetId) || params.recipient_id === currentUser.id) return json(changes(0))
        store.messages.push({ id: String(params.id), target_type: type, target_id: targetId, sender_id: currentUser.id, sender_name: currentUser.name, recipient_id: String(params.recipient_id), body: String(params.body), created_at: now }); return json(changes())
      }
      case 'agree_work': {
        const quote = store.quotes.find((item) => item.id === params.quote_id)
        if (!quote || !isOwner(quote.target_type, quote.target_id) || quote.status !== 'accepted') return json(changes(0))
        if (!store.agreements.some((item) => item.quote_id === quote.id)) store.agreements.push({ target_type: quote.target_type, target_id: quote.target_id, quote_id: quote.id, status: 'agreed', agreed_at: now, updated_at: now, completed_at: null })
        return json(changes())
      }
      case 'complete_work': {
        const agreement = store.agreements.find((item) => item.target_type === type && item.target_id === targetId)
        if (!agreement || !workAllowed(type, targetId)) return json(changes(0))
        agreement.status = 'completed'; agreement.updated_at = now; agreement.completed_at = now; return json(changes())
      }
      default: return json(rows([]))
    }
  }
  // Authenticated calls are mediated through /.pas/api; callPublic deliberately
  // uses the public API origin, so both are part of the local SDK boundary.
  await context.route('**/.pas/**', routePas)
  await context.route('https://api.proappstore.online/**', routePas)
  return { context, page: await context.newPage() }
}

async function fillQuote(page: Page, amount = '850') {
  await page.getByLabel('Quote work scope').fill('Replace the leaking kitchen tap and test fittings.')
  await page.getByLabel('Quote amount').fill(amount)
  await page.getByLabel('Quote timing').fill('Next week, one day')
  await page.getByRole('button', { name: 'Submit quote' }).click()
}

test('customer job post, tradie quote, selected-work discussion, agreement and completion', async ({ browser }) => {
  const store = seed()
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/#/jobs')
  await customer.page.getByRole('button', { name: 'Post a job' }).click()
  await customer.page.getByLabel('Job title').fill('Repair leaking kitchen tap')
  await customer.page.getByLabel('Job details').fill('Kitchen mixer tap leaks at the base.')
  await customer.page.getByLabel('Service area').fill('Fitzroy')
  await customer.page.getByRole('button', { name: 'Publish now' }).click()
  await expect(customer.page.getByRole('link', { name: 'Repair leaking kitchen tap', exact: true })).toBeVisible()
  const job = store.jobs[0]!

  const tradie = await mockedContext(browser, 'tradie', store)
  await tradie.page.goto(`/#/jobs/${job.id}`)
  await expect(tradie.page.getByRole('heading', { name: 'Repair leaking kitchen tap' })).toBeVisible()
  await fillQuote(tradie.page)
  await expect(tradie.page.getByText('Private quotes')).toHaveCount(0)

  await customer.page.goto('/#/quotes')
  await expect(customer.page.getByText('Replace the leaking kitchen tap and test fittings.')).toBeVisible()
  await customer.page.getByRole('button', { name: 'Accept quote' }).click()
  await expect(customer.page.getByText('accepted', { exact: true })).toBeVisible()
  await customer.page.goto(`/#/work/job/${job.id}/${users.tradie.id}`)
  await customer.page.getByLabel('Work message').fill('Please arrive after 9am.')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByText('Please arrive after 9am.')).toBeVisible()
  await customer.page.getByRole('button', { name: 'Agree to work' }).click()
  await expect(customer.page.getByText('Work status: agreed')).toBeVisible()
  await customer.page.getByRole('button', { name: 'Confirm completion' }).click()
  await expect(customer.page.getByText('Work status: completed')).toBeVisible()
  await customer.context.close(); await tradie.context.close()
})

test('directory direct enquiry reaches tradie quote and agreement flow without a public job', async ({ browser }) => {
  const store = seed()
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/')
  await customer.page.getByRole('link', { name: /Taylor Plumbing/ }).click()
  await customer.page.getByRole('button', { name: 'Send enquiry' }).click()
  await customer.page.getByLabel('Note to the tradie').fill('Could you inspect a slow-draining bathroom sink?')
  await customer.page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(customer.page.getByText('Send enquiry sent privately.')).toBeVisible()
  expect(store.jobs).toHaveLength(0)

  const tradie = await mockedContext(browser, 'tradie', store)
  await tradie.page.goto('/#/inbox')
  await expect(tradie.page.getByText('Casey Customer')).toBeVisible()
  await fillQuote(tradie.page, '240')
  const request = store.requests[0]!
  await customer.page.goto('/#/quotes')
  await expect(customer.page.getByRole('link', { name: 'Taylor Plumbing' })).toHaveAttribute('href', '#/l/listing-1')
  await customer.page.getByRole('button', { name: 'Accept quote' }).click()
  await customer.page.goto(`/#/work/request/${request.id}/${users.tradie.id}`)
  await customer.page.getByRole('button', { name: 'Agree to work' }).click()
  await expect(customer.page.getByText('Work status: agreed')).toBeVisible()
  await customer.context.close(); await tradie.context.close()
})

test('customer sees distinct published provider labels and profile links before selecting a quote', async ({ browser }) => {
  const store = seed()
  store.providerListings.push({ id: 'rival-listing', owner_id: users.rivalTradie.id, owner_name: users.rivalTradie.name, status: 'active', title: 'Riley Plumbing', description: 'Emergency and scheduled plumbing.', category: 'plumber', location: 'Melbourne', lat: null, lng: null, images: '[]', created_at: now, updated_at: now })
  store.jobs.push({ id: 'comparison-job', lifecycle: 'open', title: 'Compare two providers', description: 'Customer needs two distinct quotes.', category: 'plumber', location: 'Melbourne', owner_id: users.customer.id, created_at: now, updated_at: now })
  store.quotes.push(
    { id: 'taylor-quote', target_type: 'job', target_id: 'comparison-job', status: 'submitted', scope: 'Taylor quote scope', amount: 300, currency: 'AUD', timing: 'Tomorrow', valid_until: null, notes: '', revision: 1, created_at: now, updated_at: now, accepted_at: null, tradie_id: users.tradie.id },
    { id: 'riley-quote', target_type: 'job', target_id: 'comparison-job', status: 'submitted', scope: 'Riley quote scope', amount: 280, currency: 'AUD', timing: 'Friday', valid_until: null, notes: '', revision: 1, created_at: now, updated_at: now, accepted_at: null, tradie_id: users.rivalTradie.id },
  )
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/#/quotes')
  await expect(customer.page.getByText('From: Taylor Plumbing · plumber tradie')).toBeVisible()
  await expect(customer.page.getByText('From: Riley Plumbing · plumber tradie')).toBeVisible()
  await expect(customer.page.getByRole('link', { name: 'Taylor Plumbing' })).toHaveAttribute('href', '#/l/listing-1')
  await expect(customer.page.getByRole('link', { name: 'Riley Plumbing' })).toHaveAttribute('href', '#/l/rival-listing')
  await expect(customer.page.getByRole('button', { name: 'Accept quote' })).toHaveCount(2)
  await customer.context.close()
})

test('quotes initial load failure presents Retry and recovers', async ({ browser }) => {
  const store = seed()
  // React StrictMode invokes the initial effect twice in this local dev build.
  store.failQuoteLoads = 2
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/#/quotes')
  await expect(customer.page.getByRole('alert')).toContainText('mock quote service unavailable')
  await expect(customer.page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await customer.page.getByRole('button', { name: 'Retry' }).click()
  await expect(customer.page.getByText('No quotes yet')).toBeVisible()
  await expect(customer.page.getByRole('alert')).toHaveCount(0)
  await customer.context.close()
})

test('direct enquiry thread retries failed loads and uncertain sends without duplicate messages', async ({ browser }) => {
  const store = seed()
  store.requests.push({ id: 'message-request', listing_id: store.listing.id, requester_id: users.customer.id, requester_name: users.customer.name, status: 'pending', note: 'Please message me privately.', created_at: now, updated_at: now, listing_title: store.listing.title, owner_id: users.tradie.id, owner_name: users.tradie.name })
  // Keep both StrictMode initial loads failing so the rendered recovery state is stable.
  store.failMessageLoads = 2
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto(`/#/messages/${store.listing.id}/${users.tradie.id}`)
  await expect(customer.page.getByRole('alert')).toContainText('mock message service unavailable')
  await customer.page.getByRole('button', { name: 'Retry' }).click()
  await expect(customer.page.getByText('Say hello.')).toBeVisible()

  store.delayMessageSendMs = 200
  await customer.page.getByLabel('Message').fill('Please confirm the booking time.')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByRole('button', { name: 'Send' })).toBeDisabled()
  await expect(customer.page.getByText('Please confirm the booking time.')).toBeVisible()

  store.delayMessageSendMs = 0
  store.failMessageSendAfterPersist = 1
  await customer.page.getByLabel('Message').fill('This is safe to retry.')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByRole('alert')).toContainText('Your draft was kept; retrying will use the same message id.')
  await expect(customer.page.getByLabel('Message')).toHaveValue('This is safe to retry.')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByText('This is safe to retry.')).toBeVisible()
  await expect(customer.page.getByLabel('Message')).toHaveValue('')
  expect(store.directMessages.filter((message) => message.body === 'This is safe to retry.')).toHaveLength(1)
  expect(store.directSendIds.slice(-2)[0]).toBe(store.directSendIds.slice(-1)[0])
  await customer.context.close()
})

test('direct and selected-work threads page tied timestamps without losing history or scroll position', async ({ browser }) => {
  const store = seed()
  store.requests.push({ id: 'paged-enquiry', listing_id: store.listing.id, requester_id: users.customer.id, requester_name: users.customer.name, status: 'pending', note: 'Paged private enquiry.', created_at: now, updated_at: now, listing_title: store.listing.title, owner_id: users.tradie.id, owner_name: users.tradie.name })
  for (let index = 0; index < 505; index++) store.directMessages.push({ id: `direct-${String(index).padStart(3, '0')}`, listing_id: store.listing.id, sender_id: users.customer.id, sender_name: users.customer.name, recipient_id: users.tradie.id, body: `Direct history ${index}`, created_at: now - 1 })
  store.jobs.push({ id: 'paged-job', lifecycle: 'open', title: 'Paged work history', description: 'Selected work with a long history.', category: 'plumber', location: 'Melbourne', owner_id: users.customer.id, created_at: now, updated_at: now })
  store.quotes.push({ id: 'paged-quote', target_type: 'job', target_id: 'paged-job', status: 'accepted', scope: 'Paged scope', amount: 100, currency: 'AUD', timing: 'Tomorrow', valid_until: null, notes: '', revision: 1, created_at: now, updated_at: now, accepted_at: now, tradie_id: users.tradie.id })
  for (let index = 0; index < 505; index++) store.messages.push({ id: `work-${String(index).padStart(3, '0')}`, target_type: 'job', target_id: 'paged-job', sender_id: users.customer.id, sender_name: users.customer.name, recipient_id: users.tradie.id, body: `Work history ${index}`, created_at: now - 1 })

  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto(`/#/messages/${store.listing.id}/${users.tradie.id}`)
  await expect(customer.page.getByText('Direct history 405')).toBeVisible()
  await expect(customer.page.getByText('Direct history 404')).toHaveCount(0)
  const directBox = customer.page.getByText('Direct history 405').locator('..').locator('..')
  await directBox.evaluate((node) => { node.scrollTop = 40 })
  for (let page = 0; page < 5; page++) {
    const older = customer.page.getByRole('button', { name: 'Load older messages' })
    await older.focus()
    await older.press('Enter')
  }
  await expect(customer.page.getByText('Direct history 0')).toBeVisible()
  await expect(customer.page.getByText('Direct history 504')).toBeVisible()
  expect(await directBox.evaluate((node) => node.scrollTop)).toBeGreaterThan(40)
  await customer.page.getByLabel('Message').fill('Newest direct message')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByText('Newest direct message')).toBeVisible()

  await customer.page.goto('/#/work/job/paged-job/tradie-1')
  await expect(customer.page.getByText('Work history 405')).toBeVisible()
  await expect(customer.page.getByText('Work history 404')).toHaveCount(0)
  for (let page = 0; page < 5; page++) await customer.page.getByRole('button', { name: 'Load older messages' }).click()
  await expect(customer.page.getByText('Work history 0')).toBeVisible()
  await expect(customer.page.getByText('Work history 504')).toBeVisible()
  await customer.page.getByLabel('Work message').fill('Newest work message')
  await customer.page.getByRole('button', { name: 'Send' }).click()
  await expect(customer.page.getByText('Newest work message')).toBeVisible()
  await customer.context.close()
})

test('polling preserves a reader anchor while older pages compensate for prepended height in direct and selected-work threads', async ({ browser }) => {
  const store = seed()
  store.requests.push({ id: 'scroll-enquiry', listing_id: store.listing.id, requester_id: users.customer.id, requester_name: users.customer.name, status: 'pending', note: 'Scroll preservation fixture.', created_at: now, updated_at: now, listing_title: store.listing.title, owner_id: users.tradie.id, owner_name: users.tradie.name })
  for (let index = 0; index < 201; index++) store.directMessages.push({ id: `scroll-direct-${String(index).padStart(3, '0')}`, listing_id: store.listing.id, sender_id: users.customer.id, sender_name: users.customer.name, recipient_id: users.tradie.id, body: `Direct scroll ${index}`, created_at: now - 1 })
  store.jobs.push({ id: 'scroll-work-job', lifecycle: 'open', title: 'Scroll work fixture', description: 'Selected-work scroll preservation fixture.', category: 'plumber', location: 'Melbourne', owner_id: users.customer.id, created_at: now, updated_at: now })
  store.quotes.push({ id: 'scroll-work-quote', target_type: 'job', target_id: 'scroll-work-job', status: 'accepted', scope: 'Scroll fixture', amount: 100, currency: 'AUD', timing: 'Tomorrow', valid_until: null, notes: '', revision: 1, created_at: now, updated_at: now, accepted_at: now, tradie_id: users.tradie.id })
  for (let index = 0; index < 201; index++) store.messages.push({ id: `scroll-work-${String(index).padStart(3, '0')}`, target_type: 'job', target_id: 'scroll-work-job', sender_id: users.customer.id, sender_name: users.customer.name, recipient_id: users.tradie.id, body: `Work scroll ${index}`, created_at: now - 1 })

  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.clock.install()

  const assertScrollLifecycle = async (route: string, messagePrefix: 'Direct scroll' | 'Work scroll', append: (body: string) => void) => {
    await customer.page.goto(route)
    await expect(customer.page.getByText(`${messagePrefix} 101`)).toBeVisible()
    const box = customer.page.getByText(`${messagePrefix} 101`).locator('..').locator('..')
    const readingState = () => box.evaluate((node, prefix) => {
      node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2)
      const boxRect = node.getBoundingClientRect()
      const anchor = [...node.querySelectorAll<HTMLElement>(':scope > div')].find((row) => row.getBoundingClientRect().bottom > boxRect.top && row.textContent?.includes(prefix))
      return { top: node.scrollTop, anchor: anchor?.textContent?.split('\n')[0] ?? '' }
    }, messagePrefix)

    const beforePolling = await readingState()
    const incoming = `${messagePrefix} incoming while reading`
    append(incoming)
    await customer.page.clock.fastForward(15_000)
    await expect(customer.page.getByText(incoming)).toBeAttached()
    expect(await box.evaluate((node) => node.scrollTop)).toBe(beforePolling.top)
    expect(await box.evaluate((node, prefix) => {
      const boxRect = node.getBoundingClientRect()
      return [...node.querySelectorAll<HTMLElement>(':scope > div')].find((row) => row.getBoundingClientRect().bottom > boxRect.top && row.textContent?.includes(prefix))?.textContent?.split('\n')[0] ?? ''
    }, messagePrefix)).toBe(beforePolling.anchor)

    await customer.page.getByRole('button', { name: 'Load older messages' }).evaluate((button: HTMLButtonElement) => button.click())
    // The polling row makes the cursor start at 101, so the first older
    // 100-row page reaches 1; a second click would fetch the final row 0.
    await expect(customer.page.getByText(`${messagePrefix} 1`, { exact: true })).toBeAttached()
    expect(await box.evaluate((node, prefix) => {
      const boxRect = node.getBoundingClientRect()
      return [...node.querySelectorAll<HTMLElement>(':scope > div')].find((row) => row.getBoundingClientRect().bottom > boxRect.top && row.textContent?.includes(prefix))?.textContent?.split('\n')[0] ?? ''
    }, messagePrefix)).toBe(beforePolling.anchor)

    await box.evaluate((node) => { node.scrollTop = node.scrollHeight })
    const latest = `${messagePrefix} incoming at bottom`
    append(latest)
    await customer.page.clock.fastForward(15_000)
    await expect(customer.page.getByText(latest)).toBeAttached()
    expect(await box.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1)
  }

  await assertScrollLifecycle(`/#/messages/${store.listing.id}/${users.tradie.id}`, 'Direct scroll', (body) => store.directMessages.push({ id: `scroll-direct-incoming-${store.directMessages.length}`, listing_id: store.listing.id, sender_id: users.tradie.id, sender_name: users.tradie.name, recipient_id: users.customer.id, body, created_at: now + store.directMessages.length }))
  await assertScrollLifecycle('/#/work/job/scroll-work-job/tradie-1', 'Work scroll', (body) => store.messages.push({ id: `scroll-work-incoming-${store.messages.length}`, target_type: 'job', target_id: 'scroll-work-job', sender_id: users.tradie.id, sender_name: users.tradie.name, recipient_id: users.customer.id, body, created_at: now + store.messages.length }))
  await customer.context.close()
})

test('customer cannot accept an unseen revised quote and is shown its latest terms', async ({ browser }) => {
  const store = seed()
  store.jobs.push({ id: 'revision-job', lifecycle: 'open', title: 'Revision guard repair', description: 'A quote must be reviewed at its current revision.', category: 'plumber', location: 'Melbourne', owner_id: users.customer.id, created_at: now, updated_at: now })
  store.quotes.push({ id: 'revision-quote', target_type: 'job', target_id: 'revision-job', status: 'submitted', scope: 'Initial scope at revision one', amount: 100, currency: 'AUD', timing: 'Next week', valid_until: null, notes: '', revision: 1, created_at: now, updated_at: now, accepted_at: null, tradie_id: users.tradie.id })
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/#/quotes')
  await expect(customer.page.getByText('Initial scope at revision one')).toBeVisible()

  const quote = store.quotes[0]!
  quote.scope = 'Revised scope at revision two'; quote.amount = 1000; quote.revision = 2; quote.updated_at = now + 1

  await customer.page.getByRole('button', { name: 'Accept quote' }).click()
  await expect(customer.page.getByRole('alert')).toHaveText('This quote was revised before you could accept it. Please review the updated terms below.')
  await expect(customer.page.getByText('Revised scope at revision two')).toBeVisible()
  expect(quote.status).toBe('submitted')
  expect(store.agreements).toHaveLength(0)
  await customer.context.close()
})

test('direct enquiry controls are role-gated and private to its participants', async ({ browser }) => {
  const store = seed()
  const note = 'Please keep this bathroom-sink enquiry private.'
  const customer = await mockedContext(browser, 'customer', store)
  await customer.page.goto('/#/l/listing-1')
  await customer.page.getByRole('button', { name: 'Send enquiry' }).click()
  await customer.page.getByLabel('Note to the tradie').fill(note)
  await customer.page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(customer.page.getByText('Send enquiry sent privately.')).toBeVisible()
  expect(store.jobs).toHaveLength(0)

  const owner = await mockedContext(browser, 'tradie', store)
  await owner.page.goto('/#/inbox')
  await expect(owner.page.getByText(note)).toBeVisible()

  const rivalTradie = await mockedContext(browser, 'rivalTradie', store)
  await rivalTradie.page.goto('/#/l/listing-1')
  await expect(rivalTradie.page.getByRole('button', { name: 'Send enquiry' })).toHaveCount(0)
  await expect(rivalTradie.page.getByText('Only customers can send direct enquiries.')).toBeVisible()
  await rivalTradie.page.goto('/#/inbox')
  await expect(rivalTradie.page.getByText('No incoming enquiries')).toBeVisible()
  await expect(rivalTradie.page.getByText(note)).toHaveCount(0)

  const outsider = await mockedContext(browser, 'outsider', store)
  await outsider.page.goto('/#/inbox')
  await expect(outsider.page.getByText('No incoming enquiries')).toBeVisible()
  await expect(outsider.page.getByText(note)).toHaveCount(0)
  await expect(outsider.page.getByText('Casey Customer')).toHaveCount(0)
  await customer.context.close(); await owner.context.close(); await rivalTradie.context.close(); await outsider.context.close()
})

test('unrelated user cannot read selected-work quotes or private messages', async ({ browser }) => {
  const store = seed()
  store.jobs.push({ id: 'private-job', lifecycle: 'open', title: 'Private repair', description: 'Only the parties may see the quote.', category: 'plumber', location: 'Melbourne', owner_id: users.customer.id, created_at: now, updated_at: now })
  store.quotes.push({ id: 'private-quote', target_type: 'job', target_id: 'private-job', status: 'accepted', scope: 'Secret quote scope', amount: 999, currency: 'AUD', timing: 'Tomorrow', valid_until: null, notes: 'Secret quote note', revision: 1, created_at: now, updated_at: now, accepted_at: now, tradie_id: users.tradie.id })
  store.messages.push({ id: 'secret-message', target_type: 'job', target_id: 'private-job', sender_id: users.customer.id, sender_name: users.customer.name, recipient_id: users.tradie.id, body: 'Secret work message', created_at: now })
  const outsider = await mockedContext(browser, 'outsider', store)
  await outsider.page.goto('/#/quotes')
  await expect(outsider.page.getByText('No quotes yet')).toBeVisible()
  await outsider.page.goto(`/#/work/job/private-job/${users.tradie.id}`)
  await expect(outsider.page.getByText('Secret work message')).toHaveCount(0)
  await expect(outsider.page.getByText('Secret quote scope')).toHaveCount(0)
  await expect(outsider.page.getByText('Discuss the scope and timing here.')).toBeVisible()
  await outsider.context.close()
})

test('keyboard filtering and mobile layout remain usable', async ({ browser }) => {
  const store = seed()
  const session = await mockedContext(browser, 'customer', store)
  await session.page.goto('/')
  const serviceArea = session.page.getByLabel('Service area')
  await serviceArea.focus()
  await expect(serviceArea).toBeFocused()
  await serviceArea.fill('Melbourne')
  await serviceArea.press('Enter')
  await expect(session.page.getByRole('heading', { name: 'Directory' })).toBeVisible()
  await session.page.setViewportSize({ width: 375, height: 667 })
  await session.page.goto('/#/jobs')
  await expect(session.page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible()
  expect(await session.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await session.context.close()
})

test('directory loading plus jobs empty and error states are rendered', async ({ browser }) => {
  const loading = seed(); loading.delayDirectory = true
  const loadingSession = await mockedContext(browser, 'customer', loading)
  await loadingSession.page.goto('/')
  await expect(loadingSession.page.getByText('Loading directory…')).toBeVisible()
  await expect(loadingSession.page.getByRole('heading', { name: 'Directory' })).toBeVisible()
  await loadingSession.context.close()

  const empty = seed()
  const emptySession = await mockedContext(browser, 'customer', empty)
  await emptySession.page.goto('/#/jobs')
  await expect(emptySession.page.getByText('No matching open jobs')).toBeVisible()
  await emptySession.context.close()

  const failed = seed(); failed.failJobs = true
  const failedSession = await mockedContext(browser, 'customer', failed)
  await failedSession.page.goto('/#/jobs')
  await expect(failedSession.page.getByRole('alert')).toContainText('actions.list_jobs failed: 500')
  await failedSession.context.close()
})
