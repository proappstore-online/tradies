/**
 * Guard the issue #2 foundation decisions that make later marketplace features
 * safe to extend. Behavioural ownership and privacy probes live in actions.mjs;
 * this companion catches accidental removal of the baseline's structural guards.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const manifest = JSON.parse(read('../mcp.json'))
const migrations = JSON.parse(read('../migrations.json')).migrations
const api = read('../web/src/api.ts')
const shell = read('../web/src/App.tsx')
const requirements = read('../REQUIREMENTS.md')
const tools = Object.fromEntries(manifest.tools.map((tool) => [tool.name, tool]))

let failures = 0
function ok(pass, description) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${description}`)
  if (!pass) failures++
}

const foundation = migrations.find((migration) => migration.name === '0007_tradies_roles_and_jobs')?.sql ?? ''
ok(/authMode:\s*'platform-cookie'/.test(api), 'platform-cookie remains the only app auth mode')
ok(/CREATE TABLE IF NOT EXISTS profiles/.test(foundation) && /CHECK \(role IN \('customer', 'tradie'\)\)/.test(foundation), 'additive foundation migration defines constrained customer/tradie roles')
ok(/CREATE TABLE IF NOT EXISTS jobs/.test(foundation) && /customer_id TEXT NOT NULL/.test(foundation), 'foundation migration records customer ownership for jobs')

const profile = tools.create_profile?.sql ?? ''
ok(/INSERT OR IGNORE INTO profiles/.test(profile) && /:role IN \('customer', 'tradie'\)/.test(profile), 'role selection is idempotent and constrained in SQL')
ok(/:role = 'customer' OR length\(trim\(:trade_category\)\) > 0/.test(profile), 'tradie role requires a primary trade category')
ok(/WHERE user_id = :__user_id/.test(tools.get_my_profile?.sql ?? ''), 'a role record is readable only by its owner')
ok(/p\.role = 'tradie'/.test(tools.create_listing?.sql ?? '') && /p\.role = 'tradie'/.test(tools.update_listing?.sql ?? ''), 'only tradies can create or edit public service profiles')
ok(/p\.role = 'customer'/.test(tools.create_job?.sql ?? '') && /customer_id = :__user_id/.test(tools.update_job?.sql ?? ''), 'only customers can create and own jobs')
ok(/customer\.role = 'customer'/.test(tools.create_request?.sql ?? '') && /tradie\.role = 'tradie'/.test(tools.create_request?.sql ?? ''), 'direct enquiries require a customer-to-tradie pair')
ok(/requests r JOIN listings l/.test(tools.list_messages?.sql ?? '') && /r\.requester_id = :__user_id/.test(tools.list_messages?.sql ?? '') && /participant_listing/.test(tools.list_conversations?.sql ?? ''), 'direct history and inbox re-check the underlying customer-to-tradie enquiry relationship')
ok(/q\.status = 'accepted'/.test(tools.send_work_message?.sql ?? '') && /q\.customer_id = :__user_id/.test(tools.send_work_message?.sql ?? '') && /q\.tradie_id = :recipient_id/.test(tools.send_work_message?.sql ?? '') && /NOT EXISTS \(SELECT 1 FROM blocks/.test(tools.send_work_message?.sql ?? ''), 'selected-work sends require exact accepted-quote participants and preserve block guards')
ok(/INSERT OR IGNORE INTO work_agreements/.test(tools.agree_work?.sql ?? '') && /q\.status = 'accepted'/.test(tools.agree_work?.sql ?? '') && /q\.customer_id = :__user_id/.test(tools.agree_work?.sql ?? '') && /customer_completed/.test(tools.complete_work?.sql ?? '') && /tradie_completed/.test(tools.complete_work?.sql ?? ''), 'work agreement creation is retry-safe and completion remains a two-participant forward-only state machine')

const privateFields = /\b(customer_id|requester_id|tradie_id|private_address|contact_details|note|body|amount|currency|scope|timing)\b/i
const publicTools = manifest.tools.filter((tool) => tool.requires_auth === false)
ok(publicTools.length > 0 && publicTools.every((tool) => !/SELECT\s+\*/i.test(tool.sql) && !privateFields.test(tool.sql)), 'public actions use explicit safe columns and exclude private participant data')
ok(/<ProShell[\s\S]*nav=\{navFor\(profile\.role\)\}/.test(shell) && /label: 'Directory'/.test(shell) && /label: 'Jobs'/.test(shell) && /label: 'Quotes'/.test(shell) && /label: 'Inbox'/.test(shell), 'role-aware ProShell navigation exposes the agreed marketplace screens')
ok(/approved\s+`template-marketplace` baseline/i.test(requirements) && /not a from-scratch marketplace/i.test(requirements), 'requirements preserve the approved baseline reuse decision')

if (failures) process.exitCode = 1
else console.log('\nall foundation contract checks passing')
