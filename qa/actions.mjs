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

const OWNER = 'gh:owner', SEEKER = 'gh:seeker', STRANGER = 'gh:stranger', L = 'listing-1'

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
ok(call('send_message', SEEKER, { listing_id: L, recipient_id: OWNER, sender_name: 'Sam', body: 'Hello' }) === 0, 'a customer cannot message before starting a private enquiry')
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
ok(call('set_request_status', OWNER, { id: 'r-1', from: 'accepted', to: 'completed' }) === 1, 'owner completes')

// --- Reviews --------------------------------------------------------------------------------
ok(call('create_review', STRANGER, { request_id: 'r-1', author_name: 'Stan', rating: 1 }) === 0, 'a stranger cannot review someone else’s request')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 9 }) === 0, 'rating outside 1–5 is refused')
ok(call('can_review', SEEKER, { listing_id: L }).length === 1, 'the seeker may review after completion')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 5, comment: 'Lovely' }) === 1, 'seeker reviews')
ok(call('create_review', SEEKER, { request_id: 'r-1', author_name: 'Sam', rating: 1 }) === 0, 'one review per request')
ok(!('author_id' in (call('list_reviews', null, { listing_id: L })[0] ?? {})), 'public reviews never expose the author id')

// --- Messages and blocks --------------------------------------------------------------------
ok(call('send_message', SEEKER, { listing_id: L, recipient_id: OWNER, sender_name: 'Sam', body: 'Still free?' }) === 1, 'seeker messages the owner')
ok(call('send_message', STRANGER, { listing_id: L, recipient_id: SEEKER, sender_name: 'Stan', body: 'Hi' }) === 0, 'a third party cannot message a seeker about a listing they do not own')
ok(call('send_message', OWNER, { listing_id: L, recipient_id: OWNER, sender_name: 'Olive', body: 'Me' }) === 0, 'messaging yourself is refused')
ok(call('list_messages', STRANGER, { listing_id: L, other_id: OWNER }).length === 0, 'a stranger reads nothing from the thread')
ok(call('block_user', SEEKER, { blocked_id: OWNER }) === 1, 'seeker blocks the owner')
ok(call('send_message', OWNER, { listing_id: L, recipient_id: SEEKER, sender_name: 'Olive', body: 'Hello?' }) === 0, 'a blocked owner cannot message')
ok(call('create_request', SEEKER, { id: 'r-3', listing_id: L, requester_name: 'Sam' }) === 0, 'blocks also close requests')
ok(call('unblock_user', STRANGER, { blocked_id: OWNER }) === 0, 'only the blocker can unblock')
ok(call('block_user', SEEKER, { blocked_id: SEEKER }) === 0 && call('report_user', SEEKER, { reported_id: SEEKER, reason: 'spam' }) === 0, 'self-block and self-report are refused')

// --- Favourites -----------------------------------------------------------------------------
ok(call('add_favorite', SEEKER, { listing_id: L }) === 1 && call('add_favorite', SEEKER, { listing_id: L }) === 0, 'favourites are idempotent')
ok(call('add_favorite', SEEKER, { listing_id: 'nope' }) === 0, 'cannot favourite a listing that does not exist')
ok(call('remove_favorite', STRANGER, { listing_id: L }) === 0, 'a stranger cannot remove someone else’s favourite')

console.log(failures ? `\n${failures} failing` : '\nall passing')
process.exit(failures ? 1 : 0)
