# Tradies foundation requirements

This document records the scope and reuse decision for the marketplace foundation
(issue #2). It is deliberately a constrained adaptation of the approved
`template-marketplace` baseline, not a from-scratch marketplace implementation.

## Reuse decision

Keep the baseline's platform-cookie identity integration, `ProShell`, registered
data actions, additive SQLite/D1 migrations, SQL ownership and block guards,
storage uploads, keyless deployment, and public/signed-in shell split. Adapt
the generic listing vocabulary into a Tradies service profile and retain the
baseline request model for private direct enquiries.

The implementation must not introduce a parallel authentication system, a new
server, or copied marketplace assets. It uses original Tradies copy and visual
identity, and makes no licence, verification, review, price, payment, checkout,
escrow, or billing claim.

## Functional requirements

| Requirement | Foundation decision | Verification |
| --- | --- | --- |
| Identity | The platform cookie is the sole authenticated identity; the app creates no password or token flow. | `api.ts`, `qa/foundation-contract.mjs` |
| Roles | Each platform user can choose exactly one immutable `customer` or `tradie` role. A tradie provides a primary trade category. | `profiles`, `create_profile`, action tests |
| Customer ownership | A customer can own jobs and direct enquiries, but cannot publish a service profile. | SQL role guards and action tests |
| Tradie ownership | A tradie can own public service profiles and receive direct enquiries, but cannot create a customer job. | SQL role guards and action tests |
| Public discovery | The directory and job board return named safe columns only: selected service/job details and a broad service area. | public action checks |
| Private data | Customer identity, precise address, contact details, enquiries, quotes and messages are never public. Private records are scoped in SQL to their participants. | action and release-contract tests |
| Navigation | Signed-in navigation exposes Directory, Jobs, Quotes and Inbox through `ProShell`; public browsing remains available while signed out. | app shell and release-contract tests |
| States | Loading, empty, error and signed-out states are intentional user-facing states, including on mobile layouts. | UI/release contract and browser tests |

## Data boundary

`profiles` stores only the platform user id, role and a tradie's primary trade
category. The public `listings` table is a tradie-controlled service profile.
Jobs store a broad public service area, while a precise address and contact
preference remain owner-private. A direct enquiry belongs only to its requesting
customer and the profile-owning tradie. Follow-on quote and work-conversation
tables preserve the same participant boundary.

All schema evolution is additive. `0007_tradies_roles_and_jobs` establishes the
role and job foundation; later migrations extend that schema without altering
the applied migration.
