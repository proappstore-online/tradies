# Tradies

Tradies connects customers with local tradespeople on
[ProAppStore](https://proappstore.online). Customers can publish a job and
compare private quotes, or browse the directory and send a private enquiry to a
selected tradie without first creating a public job. Tradies and customers can
then agree work and use a private conversation. Payment is arranged externally:
Tradies has no checkout, payment processing, escrow, billing or pricing claims.

## Foundation and reuse

Tradies is an adaptation of the approved `template-marketplace` baseline, not a
from-scratch marketplace rewrite. It retains the platform-cookie authentication
flow, ProShell, registered data actions, additive D1/SQLite migrations, SQL
ownership and block guards, storage uploads and keyless deployment. The generic
listing becomes a public tradie service profile, while the baseline request
becomes a participant-scoped direct enquiry.

See [REQUIREMENTS.md](REQUIREMENTS.md) for the issue #2 requirements matrix and
[ARCHITECTURE.md](ARCHITECTURE.md) for the data/privacy design.

## Product boundaries

- A signed-in person chooses one immutable app role: `customer` or `tradie`.
- Customers own their jobs and can send direct enquiries; tradies own public
  service profiles and receive enquiries.
- Directory profiles and open job leads expose a display name (for a tradie),
  trade, description and broad service area only.
- Customer identity, precise address, contact preferences, enquiries, quotes,
  messages and agreements are private to their authorised participants.
- There are no fabricated licences, verification badges, reviews or business
  policies. Reviews only arise from completed participant enquiries.

## Repository layout

- `migrations.json` — additive listings, profiles, jobs, quotes, work
  conversations, safety and review schema. Migrations run before actions
  register on deployment.
- `mcp.json` — public and authenticated registered actions. Public queries use
  explicit privacy-safe columns and literal limits; private actions use
  `:__user_id` and SQL participant/ownership guards.
- `web/src/api.ts` — `initPro` configured for `platform-cookie` auth, typed
  action helpers and API data types.
- `web/src/App.tsx` — hash routing, signed-out public discovery, role-aware
  ProShell navigation, and customer/tradie role setup.
- `web/src/pages/` — directory, tradie services, customer jobs, quotes,
  private enquiries/messages/work conversations, reviews and safety settings.
- `qa/actions.mjs` — SQLite behavioural tests for roles, ownership, privacy,
  lifecycle transitions and blocks.
- `qa/foundation-contract.mjs` — structural guard for the issue #2 baseline,
  auth, role and public/private data decisions.
- `qa/release-contract.mjs` — public shell, accessibility and marketplace
  boundary checks.
- `e2e/` — local mocked user-journey tests and live signed-out smoke tests.

## Development

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

Run the complete local quality gate:

```bash
pnpm test
pnpm build
```

`pnpm test` typechecks the web app and runs the foundation, action/privacy and
release-contract suites against the declared migrations and action manifest.

## Security model

The platform is the identity provider; the app does not create a second password
or token system. App-local profiles only record a user id, role and (for a
tradie) primary trade category. SQL guards, rather than UI checks alone, enforce
role, ownership, blocks, state transitions and participant access. The public
action surface intentionally never returns customer ids/names, precise addresses,
contact details, enquiry notes, quote terms or message bodies.

## Deployment

GitHub Actions validates the project and deploys keylessly. The deployment
workflow applies migrations, registers actions and publishes the web build; its
E2E job runs the signed-out live smoke suite independently from local mocked
journey coverage.

## License

MIT
