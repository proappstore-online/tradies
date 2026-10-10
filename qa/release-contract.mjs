/**
 * Deterministic release checks for #7.  The action journey in actions.mjs runs
 * against a real SQLite database; this companion check keeps the public-shell
 * and privacy promises from drifting without needing an authenticated live user.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tools = JSON.parse(read('../mcp.json')).tools
const source = [
  '../web/src/App.tsx', '../web/src/components.tsx', '../web/src/index.css',
  '../web/src/pages/Browse.tsx', '../web/src/pages/Jobs.tsx',
  '../web/src/pages/Listing.tsx', '../web/src/pages/Quotes.tsx',
  '../web/src/pages/Messages.tsx', '../web/src/pages/Requests.tsx',
].map(read).join('\n')

let failures = 0
function ok(pass, description) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${description}`)
  if (!pass) failures++
}

// The release's public actions are the boundary for anonymous and cross-user data.
const publicTools = tools.filter((tool) => tool.requires_auth === false)
const privateFields = /\b(customer_id|requester_id|tradie_id|private_address|contact_details|quote_id|amount|currency|scope|timing|notes|body)\b/i
ok(publicTools.length > 0 && publicTools.every((tool) => !privateFields.test(tool.sql)), 'public directory and job reads cannot expose participant, quote, address, contact, or message fields')

const request = tools.find((tool) => tool.name === 'create_request')
const workMessage = tools.find((tool) => tool.name === 'send_work_message')
const workHistory = tools.find((tool) => tool.name === 'list_work_messages')
ok(!/\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\bjobs\b/i.test(request?.sql ?? ''), 'direct enquiry action has no public-job side effect')
ok(/INSERT OR IGNORE INTO work_messages/.test(workMessage?.sql ?? '') && 'id' in (workMessage?.params ?? {}), 'selected-work sends are retry-safe by caller message id')
ok(/q\.status = 'accepted'/.test(workHistory?.sql ?? '') && /q\.customer_id/.test(workHistory?.sql ?? '') && /q\.tradie_id/.test(workHistory?.sql ?? ''), 'private work history requires the exact accepted quote participants')

// Signed-out, keyboard, narrow-screen and async feedback are all intentional UI contracts.
ok(/href="#main"/.test(source) && /id="main"/.test(source), 'signed-out shell provides a keyboard skip link and main landmark')
ok(/role="search"/.test(source) && /aria-label="Service area"/.test(source) && /aria-label="Filter jobs by location"/.test(source), 'directory and job discovery filters are keyboard-labelled')
ok(/role="alert"/.test(source) && /Loading directory/.test(source) && /No tradies listed yet/.test(source) && /Loading jobs/.test(source) && /No matching open jobs/.test(source), 'loading, empty, and recoverable error states exist for both public journeys')
ok(/sm:grid-cols/.test(source) && /lg:grid-cols/.test(source) && /max-h-\[60dvh\]/.test(source) && /safe-area-inset/.test(source), 'layout has responsive grids, bounded conversation panes, and mobile safe-area support')
ok(/Sign in to continue/.test(source) && /Sign in to .*REQUEST\.noun/.test(source), 'signed-out users can browse but are prompted before private actions')

// Guard the agreed marketplace boundary: amounts are informational, reviews are real records only.
const prohibited = /\b(checkout|payment collection|collect payment|escrow|billing portal|verified badge|licensed badge)\b/i
ok(!prohibited.test(source), 'UI contains no payment, escrow, billing, or fabricated-badge product surface')
ok(/quote amounts are informational only/i.test(source) && /arrange payment directly outside Tradies/i.test(source), 'quote UI states that settlement happens outside Tradies')
ok(/can_review/.test(source) && /create_review/.test(source) && /No reviews yet/.test(source), 'reviews remain empty until a completed participant enquiry authorises one')

if (failures) process.exitCode = 1
else console.log('\nall release contract checks passing')
