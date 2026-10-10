/**
 * Negative tests per scoped action (PAS-DATA-022), run against a real SQLite built from
 * migrations.json with parameters bound the way the platform binds them. No browser, no
 * dependencies beyond Node 22's built-in sqlite.
 *
 *   node --no-warnings qa/actions.mjs          (part of `pnpm test`)
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'))
const TOOLS = Object.fromEntries(read('../mcp.json').tools.map((t) => [t.name, t]))

const db = new DatabaseSync(':memory:')
for (const m of read('../migrations.json').migrations) db.exec(m.sql)

/** Defaults, optionals and types, as the backend resolves them before binding. */
function resolve(tool, params) {
  const out = {}
  for (const [name, schema] of Object.entries(tool.params ?? {})) {
    let value = params[name]
    if (value === undefined || value === null) {
      if (schema.default !== undefined) value = schema.default
      else if (schema.optional) value = null
      else throw new Error(`${tool.name}: missing required parameter ${name}`)
    }
    if (value !== null && schema.type === 'integer') value = Number(value)
    out[name] = value
  }
  for (const name of Object.keys(params)) {
    if (!(name in (tool.params ?? {}))) throw new Error(`${tool.name}: unknown parameter ${name}`)
  }
  return out
}

/** Every `:name` becomes one positional `?`, magic values included — exactly like the platform. */
function bind(sql, resolved, user) {
  const values = []
  const bound = sql.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    if (name === '__user_id') { if (user === null) throw new Error('a public tool must not bind :__user_id'); values.push(user) }
    else if (name === '__now') values.push(Date.now())
    else if (name === '__uuid') values.push(randomUUID())
    else if (name in resolved) values.push(resolved[name])
    else throw new Error(`unresolved parameter: ${name}`)
    return '?'
  })
  return [bound, values]
}

/** `user === null` calls the tool the way the public path does (no session). */
export function call(name, user, params = {}) {
  const tool = TOOLS[name]
  if (!tool) throw new Error(`no such action: ${name}`)
  if (user === null && tool.requires_auth !== false) throw new Error(`${name} requires auth`)
  const [sql, values] = bind(tool.sql, resolve(tool, params), user)
  const stmt = db.prepare(sql)
  return tool.operation === 'query' ? stmt.all(...values) : stmt.run(...values).changes
}

let failures = 0
const ok = (pass, what) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${what}`)
  if (!pass) failures++
}

const OWNER = 'gh:owner', SEEKER = 'gh:seeker', STRANGER = 'gh:stranger', RIVAL = 'gh:rival', THIRD = 'gh:third', L = 'listing-1'

// --- Every public tool prepares without a session and names its columns ---------------------
for (const t of Object.values(TOOLS).filter((t) => t.requires_auth === false)) {
  ok(!/SELECT\s+\*/i.test(t.sql) && /\bLIMIT\s+\d+\b/i.test(t.sql), `${t.name}: public, column-explicit, literal LIMIT`)
}

// Every scoped action rejects the public call path before it can resolve user input.
for (const t of Object.values(TOOLS).filter((t) => t.requires_auth !== false)) {
  let denied = false
  try { call(t.name, null) } catch { denied = true }
  ok(denied, `${t.name}: requires an authenticated caller`)
}

// --- Roles and customer jobs ---------------------------------------------------------------
ok(call('create_profile', OWNER, { role: 'tradie', trade_category: 'plumber' }) === 1, 'owner chooses the tradie role')
ok(call('create_profile', OWNER, { role: 'customer' }) === 0, 'role selection is immutable and idempotent')
ok(call('create_profile', SEEKER, { role: 'customer' }) === 1, 'seeker chooses the customer role')
ok(call('create_profile', STRANGER, { role: 'customer' }) === 1, 'stranger chooses the customer role')
ok(call('create_profile', 'gh:invalid', { role: 'tradie' }) === 0, 'a tradie cannot omit a trade category')
ok(call('get_my_profile', STRANGER)[0]?.role === 'customer' && call('get_my_profile', STRANGER)[0]?.user_id === STRANGER, 'a caller only reads their own role')
ok(call('create_job', OWNER, { id: 'job-owner', title: 'Nope', category: 'plumber' }) === 0, 'a tradie cannot post a customer job')
ok(call('create_listing', SEEKER, { id: 'customer-service', owner_name: 'Sam', title: 'Not a tradie', category: 'plumber' }) === 0, 'a customer cannot publish a tradie service')
ok(call('create_job', SEEKER, { id: 'job-1', title: 'Fix tap', description: 'Kitchen tap is leaking.', category: 'plumber', location: 'Northside', private_address: '12 Private Lane', contact_details: 'Sam, 0400 000 000' }) === 1, 'customer saves a validated draft with private details')
ok(call('create_job', SEEKER, { id: 'job-1', title: 'Retry', description: 'Retry', category: 'plumber', location: 'Northside' }) === 0, 'create_job is idempotent by client id')
ok(call('list_jobs', null).length === 0 && call('get_job', null, { id: 'job-1' }).length === 0, 'draft jobs are never public leads')
const ownDraft = call('get_my_job', SEEKER, { id: 'job-1' })[0]
ok(ownDraft?.private_address === '12 Private Lane' && ownDraft?.contact_details === 'Sam, 0400 000 000', 'only the customer owner reads precise address and contact data')
ok(call('get_my_job', OWNER, { id: 'job-1' }).length === 0 && call('get_my_job', STRANGER, { id: 'job-1' }).length === 0, 'tradies and other customers cannot read job private details')
ok(call('update_job', STRANGER, { id: 'job-1', title: 'Hijacked', description: 'No', category: 'plumber', location: 'Northside' }) === 0, 'a non-owner cannot edit a customer job')
ok(call('update_job', SEEKER, { id: 'job-1', title: 'Repair leaking kitchen tap', description: 'Kitchen tap is leaking and needs repair.', category: 'plumber', location: 'Northside', private_address: '12 Private Lane', contact_details: 'Message first' }) === 1, 'owner edits a draft with validation')
ok(call('set_job_status', SEEKER, { id: 'job-1', from: 'draft', to: 'open' }) === 1, 'owner publishes a draft job')
const publicJob = call('get_job', null, { id: 'job-1' })[0]
ok(publicJob?.lifecycle === 'open' && !('customer_id' in publicJob) && !('private_address' in publicJob) && !('contact_details' in publicJob), 'public job detail exposes only safe lead fields')
ok(call('list_jobs', null, { category: 'plumber', location: 'north' }).length === 1 && call('list_jobs', null, { category: 'electrician', location: 'north' }).length === 0, 'tradies can filter open jobs by trade and broad area')
ok(call('list_my_jobs', STRANGER).length === 0, 'a stranger sees none of another customer’s jobs')
ok(call('set_job_status', STRANGER, { id: 'job-1', from: 'open', to: 'closed' }) === 0, 'a stranger cannot close a customer job')
ok(call('set_job_status', SEEKER, { id: 'job-1', from: 'open', to: 'draft' }) === 0, 'invalid lifecycle transitions are refused')
ok(call('set_job_status', SEEKER, { id: 'job-1', from: 'open', to: 'closed' }) === 1 && call('get_job', null, { id: 'job-1' }).length === 0, 'closed jobs are removed from public leads')
ok(call('update_job', SEEKER, { id: 'job-1', title: 'Too late', description: 'No', category: 'plumber', location: 'Northside' }) === 0, 'closed jobs cannot be edited until re-opened')
ok(call('set_job_status', SEEKER, { id: 'job-1', from: 'closed', to: 'open' }) === 1 && call('get_job', null, { id: 'job-1' }).length === 1, 'owner can re-open a closed job')

// --- Quotes: public job route --------------------------------------------------------------
ok(call('create_profile', RIVAL, { role: 'tradie', trade_category: 'plumber' }) === 1, 'a second tradie chooses a role')
ok(call('create_profile', THIRD, { role: 'tradie', trade_category: 'plumber' }) === 1, 'a third tradie chooses a role')
ok(call('create_listing', RIVAL, { id: 'rival-profile', owner_name: 'Riley', title: 'Riley Plumbing', description: 'Independent plumbing repairs.', category: 'plumber', location: 'Southside' }) === 1, 'a second provider publishes a distinct active profile')
ok(call('create_listing', RIVAL, { id: 'rival-profile-alt', owner_name: 'Riley', title: 'Riley Plumbing North', description: 'A second published service profile.', category: 'plumber', location: 'Northside' }) === 1, 'the provider can have a second active profile without duplicating a quote row')
db.prepare("UPDATE listings SET updated_at = 1700000000000 WHERE id IN ('rival-profile', 'rival-profile-alt')").run()
const quoteTerms = { scope: 'Replace the leaking mixer and test the new fittings.', amount: 245, currency: 'AUD', timing: 'Next week', notes: 'Parts and labour included.' }
ok(call('create_job_quote', OWNER, { id: 'quote-job-owner', job_id: 'job-1', ...quoteTerms }) === 1, 'a tradie submits a private quote on an open job')
ok(call('create_job_quote', OWNER, { id: 'quote-job-owner', job_id: 'job-1', ...quoteTerms }) === 0, 'job quote submission is idempotent by client id')
ok(call('create_job_quote', RIVAL, { id: 'quote-job-rival', job_id: 'job-1', ...quoteTerms, amount: 210 }) === 1, 'a second tradie may submit a competing private quote')
ok(call('create_job_quote', RIVAL, { id: 'quote-job-expired', job_id: 'job-1', ...quoteTerms, valid_until: Date.now() - 1 }) === 0, 'an already-expired quote cannot be submitted')
const customerJobQuotes = call('list_job_quotes', SEEKER, { job_id: 'job-1' })
ok(customerJobQuotes.length === 2 && customerJobQuotes.every((quote) => typeof quote.provider_user_id === 'string' && quote.provider_user_id.length > 0 && quote.provider_trade_category === 'plumber' && [0, 1].includes(quote.provider_has_listing)), 'the customer receives server-sourced provider identity and public-listing availability for each job quote')
ok(new Set(customerJobQuotes.map((quote) => quote.provider_user_id)).size === 2 && customerJobQuotes.some((quote) => quote.provider_profile_id === 'rival-profile' && quote.provider_display_name === 'Riley Plumbing' && quote.provider_has_listing === 1) && customerJobQuotes.some((quote) => quote.provider_profile_id === null && quote.provider_display_name === null && quote.provider_has_listing === 0), 'two competing job quotes preserve one row each and deterministically expose the active provider’s real profile label and id')
ok(call('set_listing_status', RIVAL, { id: 'rival-profile', from: 'active', status: 'paused' }) === 1, 'the isolated competing provider fixture is paused after identity coverage')
ok(call('set_listing_status', RIVAL, { id: 'rival-profile-alt', from: 'active', status: 'paused' }) === 1, 'the competing provider’s alternate profile is paused after identity coverage')
ok(call('list_job_quotes', STRANGER, { job_id: 'job-1' }).length === 0 && call('list_job_quotes', OWNER, { job_id: 'job-1' }).length === 0, 'other customers and tradies cannot inspect private competing job quotes')
ok(call('list_my_quotes', OWNER).length === 1 && call('list_my_quotes', RIVAL).length === 1, 'each tradie can inspect only their own quotes')
ok(call('revise_quote', SEEKER, { id: 'quote-job-owner', expected_revision: 1, ...quoteTerms, amount: 260 }) === 0, 'a customer cannot revise a tradie quote')
ok(call('revise_quote', OWNER, { id: 'quote-job-owner', expected_revision: 1, ...quoteTerms, amount: 260, timing: 'This Friday' }) === 1, 'a tradie revises their submitted quote')
ok(call('revise_quote', OWNER, { id: 'quote-job-owner', expected_revision: 1, ...quoteTerms, amount: 999, timing: 'Never' }) === 0 && call('list_my_quotes', OWNER)[0]?.amount === 260 && call('list_my_quotes', OWNER)[0]?.revision === 2, 'a stale job revision changes zero rows and cannot overwrite newer terms')
ok(call('accept_quote', SEEKER, { id: 'quote-job-owner', from: 'submitted', expected_revision: 1 }) === 0 && call('agree_work', SEEKER, { quote_id: 'quote-job-owner' }) === 0 && call('get_work_agreement', SEEKER, { target_type: 'job', target_id: 'job-1' }).length === 0, 'a stale job acceptance changes zero rows and creates no work agreement')
ok(call('withdraw_quote', RIVAL, { id: 'quote-job-owner', from: 'submitted' }) === 0, 'a rival cannot withdraw another tradie quote')
ok(call('withdraw_quote', OWNER, { id: 'quote-job-owner', from: 'submitted' }) === 1, 'a tradie withdraws their own quote')
ok(call('accept_quote', SEEKER, { id: 'quote-job-owner', from: 'withdrawn', expected_revision: 2 }) === 0, 'a withdrawn quote cannot be newly accepted')
ok(call('accept_quote', SEEKER, { id: 'quote-job-rival', from: 'submitted', expected_revision: 1 }) === 1, 'customer accepts one current job quote with its observed revision')
ok(call('accept_quote', SEEKER, { id: 'quote-job-rival', from: 'submitted', expected_revision: 1 }) === 0, 'a stale double accept changes nothing')
ok(call('create_job_quote', THIRD, { id: 'quote-job-late', job_id: 'job-1', ...quoteTerms, amount: 190 }) === 1 && call('accept_quote', SEEKER, { id: 'quote-job-late', from: 'submitted', expected_revision: 1 }) === 0, 'atomic selected-quote guard prevents contradictory concurrent selections')
ok(call('decline_quote', SEEKER, { id: 'quote-job-late', from: 'submitted' }) === 1 && call('decline_quote', SEEKER, { id: 'quote-job-late', from: 'submitted' }) === 0, 'customer can decline one submitted quote and stale retries are safe')
db.prepare("INSERT INTO quotes (id, target_type, target_id, customer_id, tradie_id, status, scope, amount, currency, timing, valid_until, notes, created_at, updated_at) VALUES ('quote-expired-seeded', 'job', 'job-1', ?, ?, 'submitted', 'Scope', 1, 'AUD', 'Tomorrow', ?, '', ?, ?)").run(SEEKER, 'gh:expired', Date.now() - 1, Date.now(), Date.now())
ok(call('accept_quote', SEEKER, { id: 'quote-expired-seeded', from: 'submitted', expected_revision: 1 }) === 0, 'an expired quote cannot be newly accepted')

// --- Selected public-job work: selected tradie and customer only ----------------------------
ok(call('list_work_conversations', SEEKER).some((c) => c.target_type === 'job' && c.target_id === 'job-1') && call('list_work_conversations', RIVAL).some((c) => c.target_type === 'job' && c.target_id === 'job-1'), 'selected job quote creates a private work thread for exactly its participants')
ok(call('list_work_messages', OWNER, { target_type: 'job', target_id: 'job-1', other_id: SEEKER }).length === 0 && call('list_work_messages', STRANGER, { target_type: 'job', target_id: 'job-1', other_id: RIVAL }).length === 0, 'other tradies and unrelated users cannot read selected job work history')
ok(call('send_work_message', OWNER, { id: 'job-other-tradie-message', target_type: 'job', target_id: 'job-1', recipient_id: SEEKER, sender_name: 'Olive', body: 'Pick me instead' }) === 0 && call('send_work_message', STRANGER, { id: 'job-stranger-message', target_type: 'job', target_id: 'job-1', recipient_id: RIVAL, sender_name: 'Stan', body: 'Hello' }) === 0, 'other tradies and unrelated users cannot send to selected job work thread')
const jobMessage = { id: 'job-message-1', target_type: 'job', target_id: 'job-1', recipient_id: RIVAL, sender_name: 'Sam', body: 'Can we confirm the timing?' }
ok(call('send_work_message', SEEKER, jobMessage) === 1 && call('send_work_message', SEEKER, jobMessage) === 0 && call('list_work_messages', RIVAL, { target_type: 'job', target_id: 'job-1', other_id: SEEKER }).length === 1, 'selected job messages persist, are visible to both participants, and client-id retries do not duplicate them')
ok(call('agree_work', RIVAL, { quote_id: 'quote-job-rival' }) === 0 && call('agree_work', STRANGER, { quote_id: 'quote-job-rival' }) === 0, 'only the job customer can agree to selected work')
ok(call('agree_work', SEEKER, { quote_id: 'quote-job-rival' }) === 1 && call('agree_work', SEEKER, { quote_id: 'quote-job-rival' }) === 0, 'job agreement is created once and safe on retry')
ok(call('complete_work', STRANGER, { target_type: 'job', target_id: 'job-1', from: 'agreed' }) === 0 && call('complete_work', OWNER, { target_type: 'job', target_id: 'job-1', from: 'agreed' }) === 0, 'non-participants cannot confirm selected job completion')
ok(call('complete_work', SEEKER, { target_type: 'job', target_id: 'job-1', from: 'agreed' }) === 1 && call('complete_work', SEEKER, { target_type: 'job', target_id: 'job-1', from: 'customer_completed' }) === 0 && call('complete_work', RIVAL, { target_type: 'job', target_id: 'job-1', from: 'customer_completed' }) === 1 && call('get_work_agreement', SEEKER, { target_type: 'job', target_id: 'job-1' })[0]?.status === 'completed', 'job completion requires each participant once and cannot be duplicated or skipped')

// --- Listings -------------------------------------------------------------------------------
ok(call('create_listing', OWNER, { id: 'invalid-service', owner_name: 'Olive', title: 'Missing details', category: 'plumber' }) === 0, 'a profile needs a trade, service area and description')
ok(call('create_listing', OWNER, { id: L, owner_name: 'Olive', title: 'Olive Plumbing', description: 'Licensed plumbing repairs and installations.', category: 'plumber', location: 'Northside' }) === 1, 'tradie publishes a validated service profile')
ok(call('create_listing', OWNER, { id: L, owner_name: 'Olive', title: 'Olive Plumbing', description: 'Licensed plumbing repairs and installations.', category: 'plumber', location: 'Northside' }) === 0, 'create_listing is idempotent by client id')
ok(call('update_listing', STRANGER, { id: L, title: 'Hijacked' }) === 0, 'a stranger cannot edit it')
ok(call('update_listing', OWNER, { id: L, title: 'Olive Plumbing', description: '', category: 'plumber', location: 'Northside' }) === 0, 'a tradie cannot erase their required profile description')
ok(call('set_listing_status', STRANGER, { id: L, from: 'active', status: 'archived' }) === 0, 'a stranger cannot archive it')
ok(call('get_my_listing', STRANGER, { id: L }).length === 0, 'a stranger cannot load it for editing')
ok(call('get_listing', null, { id: L }).length === 1, 'the public sees an active listing')
ok(call('set_listing_status', OWNER, { id: L, from: 'active', status: 'paused' }) === 1, 'owner pauses')
ok(call('get_listing', null, { id: L }).length === 0 && call('list_listings', null).length === 0, 'the public no longer sees a paused listing')
ok(call('set_listing_status', OWNER, { id: L, from: 'paused', status: 'deleted' }) === 0, 'unknown status is refused')
ok(call('set_listing_status', OWNER, { id: L, from: 'active', status: 'archived' }) === 0, 'a stale service status changes nothing')
call('set_listing_status', OWNER, { id: L, from: 'paused', status: 'active' })
ok(call('search_listings', null, { q: 'OLIVE' }).length === 1, 'public search is case-insensitive')
ok(call('list_listings', null, { category: 'plumber', location: 'north' }).length === 1, 'directory filters profiles by trade and broad service area')
ok(call('list_listings', null, { category: 'electrician', location: 'north' }).length === 0, 'directory filter excludes another trade')

// --- Requests -------------------------------------------------------------------------------
ok(call('create_request', OWNER, { id: 'r-own', listing_id: L, requester_name: 'Olive' }) === 0, 'tradie cannot enquire on their own service')
ok(call('send_message', SEEKER, { id: 'before-enquiry-message', listing_id: L, recipient_id: OWNER, sender_name: 'Sam', body: 'Hello' }) === 0, 'a customer cannot message before starting a private enquiry')
const publicJobCountBeforeDirectEnquiry = call('list_jobs', null).length
ok(call('create_request', SEEKER, { id: 'r-1', listing_id: L, requester_name: 'Sam', note: 'Can you help?' }) === 1, 'customer sends a private enquiry')
ok(call('list_incoming_requests', OWNER).some((r) => r.id === 'r-1' && r.requester_name === 'Sam'), 'tradie sees the direct enquiry in their private inbox')
ok(call('list_my_requests', SEEKER).some((r) => r.id === 'r-1' && r.note === 'Can you help?'), 'customer sees their private enquiry without creating a job')
ok(call('list_jobs', null).length === publicJobCountBeforeDirectEnquiry, 'direct enquiry creates no public job')
ok(call('create_request', SEEKER, { id: 'r-empty', listing_id: L, requester_name: 'Sam', note: ' ' }) === 0, 'an enquiry requires a private message')
ok(call('create_request', SEEKER, { id: 'r-1', listing_id: L, requester_name: 'Sam', note: 'Can you help?' }) === 0, 'create_request is idempotent by client id')
ok(call('create_request', SEEKER, { id: 'r-2', listing_id: L, requester_name: 'Sam', note: 'A second enquiry' }) === 0, 'one open enquiry per service per customer')
ok(call('set_request_status', SEEKER, { id: 'r-1', from: 'pending', to: 'accepted' }) === 0, 'the requester cannot accept their own request')
ok(call('set_request_status', STRANGER, { id: 'r-1', from: 'pending', to: 'accepted' }) === 0, 'a stranger cannot transition it')
ok(call('set_request_status', OWNER, { id: 'r-1', from: 'pending', to: 'completed' }) === 0, 'pending cannot jump to completed')
ok(call('set_request_status', OWNER, { id: 'r-1', from: 'pending', to: 'accepted' }) === 1, 'owner accepts')
ok(call('set_request_status', OWNER, { id: 'r-1', from: 'pending', to: 'accepted' }) === 0, 'a stale client changes nothing')
ok(call('cancel_request', STRANGER, { id: 'r-1', from: 'accepted' }) === 0, 'a stranger cannot cancel it')
ok(call('list_incoming_requests', STRANGER).length === 0 && call('list_my_requests', STRANGER).length === 0, 'another customer sees no private enquiries')
ok(call('create_request_quote', RIVAL, { id: 'quote-request-rival', request_id: 'r-1', ...quoteTerms }) === 0, 'a non-participant tradie cannot quote on a direct enquiry')
ok(call('create_request_quote', OWNER, { id: 'quote-request-owner', request_id: 'r-1', ...quoteTerms, amount: 180 }) === 1, 'the enquiry tradie submits a private direct-enquiry quote')
const customerRequestQuotes = call('list_request_quotes', SEEKER, { request_id: 'r-1' })
ok(customerRequestQuotes.length === 1 && customerRequestQuotes[0]?.provider_user_id === OWNER && customerRequestQuotes[0]?.provider_trade_category === 'plumber' && customerRequestQuotes[0]?.provider_profile_id === L && customerRequestQuotes[0]?.provider_display_name === 'Olive Plumbing' && customerRequestQuotes[0]?.provider_has_listing === 1, 'the requesting customer receives the direct-enquiry provider’s real active-profile label and id')
ok(call('list_request_quotes', STRANGER, { request_id: 'r-1' }).length === 0 && call('list_request_quotes', OWNER, { request_id: 'r-1' }).length === 0, 'direct-enquiry quotes remain private from strangers and the tradie comparison route')
ok(call('decline_quote', STRANGER, { id: 'quote-request-owner', from: 'submitted' }) === 0, 'a stranger cannot decline another customer’s quote')
ok(call('revise_quote', OWNER, { id: 'quote-request-owner', expected_revision: 1, ...quoteTerms, amount: 220, timing: 'Tomorrow' }) === 1, 'a tradie revises their direct-enquiry quote with its observed revision')
ok(call('revise_quote', OWNER, { id: 'quote-request-owner', expected_revision: 1, ...quoteTerms, amount: 999, timing: 'Never' }) === 0 && call('list_my_quotes', OWNER).find((quote) => quote.id === 'quote-request-owner')?.amount === 220, 'a stale direct-enquiry revision changes zero rows and cannot overwrite newer terms')
ok(call('accept_quote', SEEKER, { id: 'quote-request-owner', from: 'submitted', expected_revision: 1 }) === 0 && call('agree_work', SEEKER, { quote_id: 'quote-request-owner' }) === 0 && call('get_work_agreement', SEEKER, { target_type: 'request', target_id: 'r-1' }).length === 0, 'a stale direct-enquiry acceptance changes zero rows and creates no work agreement')
ok(call('accept_quote', STRANGER, { id: 'quote-request-owner', from: 'submitted', expected_revision: 2 }) === 0, 'an unauthorised user cannot accept a direct-enquiry quote')
ok(call('accept_quote', SEEKER, { id: 'quote-request-owner', from: 'submitted', expected_revision: 2 }) === 1, 'customer accepts a direct-enquiry quote with its observed revision')
ok(call('withdraw_quote', OWNER, { id: 'quote-request-owner', from: 'accepted' }) === 0 && call('revise_quote', OWNER, { id: 'quote-request-owner', expected_revision: 2, ...quoteTerms }) === 0, 'accepted quotes cannot be withdrawn or revised')
ok(call('list_work_messages', RIVAL, { target_type: 'request', target_id: 'r-1', other_id: SEEKER }).length === 0 && call('send_work_message', RIVAL, { id: 'request-rival-message', target_type: 'request', target_id: 'r-1', recipient_id: SEEKER, sender_name: 'Riley', body: 'Not my enquiry' }) === 0, 'other tradies cannot access a direct-enquiry selected-work thread')
const requestMessage = { id: 'request-message-1', target_type: 'request', target_id: 'r-1', recipient_id: OWNER, sender_name: 'Sam', body: 'The scope looks good.' }
ok(call('send_work_message', SEEKER, requestMessage) === 1 && call('send_work_message', SEEKER, requestMessage) === 0 && call('list_work_messages', OWNER, { target_type: 'request', target_id: 'r-1', other_id: SEEKER }).length === 1, 'direct-enquiry participants retain one refresh-persistent message history without retry duplicates')
ok(call('agree_work', SEEKER, { quote_id: 'quote-request-owner' }) === 1 && call('complete_work', OWNER, { target_type: 'request', target_id: 'r-1', from: 'agreed' }) === 1 && call('complete_work', SEEKER, { target_type: 'request', target_id: 'r-1', from: 'tradie_completed' }) === 1 && call('get_work_agreement', OWNER, { target_type: 'request', target_id: 'r-1' })[0]?.status === 'completed', 'direct-enquiry participants can agree then confirm completion in either order')
ok(call('get_work_agreement', STRANGER, { target_type: 'request', target_id: 'r-1' }).length === 0 && call('complete_work', STRANGER, { target_type: 'request', target_id: 'r-1', from: 'completed' }) === 0, 'unrelated users cannot read or transition direct-enquiry agreements')
ok(call('set_request_status', OWNER, { id: 'r-1', from: 'accepted', to: 'completed' }) === 1, 'owner completes')

// --- Reviews --------------------------------------------------------------------------------
ok(call('create_review', STRANGER, { request_id: 'r-1', author_name: 'Stan', rating: 1 }) === 0, 'a stranger cannot review someone else’s request')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 9 }) === 0, 'rating outside 1–5 is refused')
ok(call('can_review', SEEKER, { listing_id: L }).length === 1, 'the seeker may review after completion')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 5, comment: 'Lovely' }) === 1, 'seeker reviews')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 1 }) === 0, 'one review per request')
ok(!('author_id' in (call('list_reviews', null, { listing_id: L })[0] ?? {})), 'public reviews never expose the author id')

// --- Messages and blocks --------------------------------------------------------------------
ok(call('send_message', SEEKER, { id: 'direct-message-retry', listing_id: L, recipient_id: OWNER, sender_name: 'Sam', body: 'Still free?' }) === 1 && call('send_message', SEEKER, { id: 'direct-message-retry', listing_id: L, recipient_id: OWNER, sender_name: 'Sam', body: 'Still free?' }) === 0 && call('list_messages', SEEKER, { listing_id: L, other_id: OWNER }).filter((message) => message.id === 'direct-message-retry').length === 1, 'direct messages are idempotent by client id for uncertain retry')
ok(call('send_message', STRANGER, { id: 'stranger-message', listing_id: L, recipient_id: SEEKER, sender_name: 'Stan', body: 'Hi' }) === 0, 'a third party cannot message a seeker about a listing they do not own')
ok(call('send_message', OWNER, { id: 'self-message', listing_id: L, recipient_id: OWNER, sender_name: 'Olive', body: 'Me' }) === 0, 'messaging yourself is refused')
ok(call('list_messages', STRANGER, { listing_id: L, other_id: OWNER }).length === 0, 'a stranger reads nothing from the thread')
const PAGED_LISTING = 'paging-listing'
ok(call('create_listing', OWNER, { id: PAGED_LISTING, owner_name: 'Olive', title: 'Olive Paging Plumbing', description: 'A fixture used only to verify private thread paging.', category: 'plumber', location: 'Northside' }) === 1 && call('create_request', SEEKER, { id: 'paging-request', listing_id: PAGED_LISTING, requester_name: 'Sam', note: 'Please keep this thread private.' }) === 1, 'pagination fixture has a private direct enquiry')
const TIED_TIME = 1_700_000_000_000
const insertDirectPage = db.prepare('INSERT INTO messages (id, listing_id, sender_id, sender_name, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
for (let index = 0; index < 505; index++) insertDirectPage.run(`page-direct-${String(index).padStart(3, '0')}`, PAGED_LISTING, SEEKER, 'Sam', OWNER, `Direct page ${index}`, TIED_TIME)
const newestDirectPage = call('list_messages', SEEKER, { listing_id: PAGED_LISTING, other_id: OWNER })
let directHistory = [...newestDirectPage]
let directCursor = newestDirectPage[0]
while (directCursor) {
  const page = call('list_messages', SEEKER, { listing_id: PAGED_LISTING, other_id: OWNER, before_created_at: directCursor.created_at, before_id: directCursor.id })
  directHistory.push(...page)
  directCursor = page[0]
}
const chronologicalDirectHistory = [...directHistory].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
ok(newestDirectPage.length === 100 && newestDirectPage[0]?.id === 'page-direct-405' && newestDirectPage.at(-1)?.id === 'page-direct-504' && directHistory.length === 505 && new Set(directHistory.map((message) => message.id)).size === 505 && chronologicalDirectHistory.every((message, index, all) => index === 0 || message.created_at > all[index - 1].created_at || (message.created_at === all[index - 1].created_at && message.id > all[index - 1].id)), 'direct history returns the latest tied-timestamp page first and every older page exactly once in chronological id order')
db.prepare("INSERT INTO quotes (id, target_type, target_id, customer_id, tradie_id, status, scope, amount, currency, timing, valid_until, notes, revision, created_at, updated_at, accepted_at) VALUES ('paging-work-quote', 'job', 'paging-work-target', ?, ?, 'accepted', 'Paged work scope', 1, 'AUD', 'Now', NULL, '', 1, ?, ?, ?)").run(SEEKER, OWNER, TIED_TIME, TIED_TIME, TIED_TIME)
const insertWorkPage = db.prepare('INSERT INTO work_messages (id, target_type, target_id, sender_id, sender_name, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
for (let index = 0; index < 505; index++) insertWorkPage.run(`page-work-${String(index).padStart(3, '0')}`, 'job', 'paging-work-target', SEEKER, 'Sam', OWNER, `Work page ${index}`, TIED_TIME)
const newestWorkPage = call('list_work_messages', SEEKER, { target_type: 'job', target_id: 'paging-work-target', other_id: OWNER })
let workHistory = [...newestWorkPage]
let workCursor = newestWorkPage[0]
while (workCursor) {
  const page = call('list_work_messages', SEEKER, { target_type: 'job', target_id: 'paging-work-target', other_id: OWNER, before_created_at: workCursor.created_at, before_id: workCursor.id })
  workHistory.push(...page)
  workCursor = page[0]
}
ok(newestWorkPage.length === 100 && newestWorkPage[0]?.id === 'page-work-405' && newestWorkPage.at(-1)?.id === 'page-work-504' && workHistory.length === 505 && new Set(workHistory.map((message) => message.id)).size === 505 && call('list_work_messages', STRANGER, { target_type: 'job', target_id: 'paging-work-target', other_id: OWNER }).length === 0, 'selected-work history has deterministic tied-timestamp pages without duplicates and remains participant-only')
ok(call('block_user', SEEKER, { blocked_id: OWNER }) === 1, 'seeker blocks the owner')
ok(call('send_message', OWNER, { id: 'blocked-direct-message', listing_id: L, recipient_id: SEEKER, sender_name: 'Olive', body: 'Hello?' }) === 0 && call('send_work_message', OWNER, { id: 'blocked-work-message', target_type: 'request', target_id: 'r-1', recipient_id: SEEKER, sender_name: 'Olive', body: 'Hello?' }) === 0, 'a blocked owner cannot send listing or selected-work messages')
ok(call('create_request', SEEKER, { id: 'r-3', listing_id: L, requester_name: 'Sam' }) === 0, 'blocks also close requests')
ok(call('unblock_user', STRANGER, { blocked_id: OWNER }) === 0, 'only the blocker can unblock')
ok(call('block_user', SEEKER, { blocked_id: SEEKER }) === 0 && call('report_user', SEEKER, { reported_id: SEEKER, reason: 'spam' }) === 0, 'self-block and self-report are refused')

// --- Favourites -----------------------------------------------------------------------------
ok(call('add_favorite', SEEKER, { listing_id: L }) === 1 && call('add_favorite', SEEKER, { listing_id: L }) === 0, 'favourites are idempotent')
ok(call('add_favorite', SEEKER, { listing_id: 'nope' }) === 0, 'cannot favourite a listing that does not exist')
ok(call('remove_favorite', STRANGER, { listing_id: L }) === 0, 'a stranger cannot remove someone else’s favourite')

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
