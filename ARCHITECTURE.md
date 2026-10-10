# Tradies foundation

Tradies is an adaptation of the approved `template-marketplace` baseline, not a
replacement for it. It retains platform-cookie authentication, ProShell, registered
actions, additive D1 migrations, SQL ownership guards, SQL block checks, storage uploads,
and keyless deployment. The former generic `listings` table is reused as a public tradie
service profile: it intentionally exposes only the tradie's selected display name, trade,
description, broad service area, and public images.

## Roles and privacy

`0007_tradies_roles_and_jobs` adds an app-local `profiles` record keyed by the platform
user id. A person selects one immutable role:

- **Customer** — may create public jobs and send private enquiries to a tradie profile.
- **Tradie** — may publish and maintain public service profiles, and receive enquiries.

The role is created with `INSERT OR IGNORE`, so a setup retry is safe and cannot silently
change an established role. The platform remains the identity provider; this profile holds
only role and a tradie's primary trade category, never contact information.

Public directory and job actions name their columns and use literal limits. They never
return a customer id, customer name, address, contact details, enquiry, quote, or message.
Jobs collect a broad service area only. Exact work details and contact information belong in
participant-scoped enquiries/messages. Customer-to-tradie enquiries require the expected
roles and reject blocked pairs in SQL; messaging retains the template's SQL block guard.

## Product boundary for this increment

The ProShell navigation establishes Directory, Jobs, Quotes, and Inbox. Directory profile
and public-job foundations are live in this increment; quote negotiation and richer job
responses remain later issue work. Tradies does not publish licence, verification, review,
price, payment, checkout, escrow, or billing claims. Existing template review records are
only available after a completed, participant-scoped enquiry and are never fabricated.
