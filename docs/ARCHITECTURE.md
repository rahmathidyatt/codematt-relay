# codematt Relay — architecture and phased delivery

Status: Phase 1 foundation. This package is not the completed campaign product.

## Boundaries
One Netlify site represents one workspace. Every signed-in user must have a trusted Identity role: admin, operator, or viewer. Unknown roles have no access. Multi-workspace hosting requires a separate tenant isolation design before implementation. Credentials stay in Functions environment variables; there is no public registration UI. Identity must be configured Invite Only at the provider.

React + TypeScript + Vite -> authenticated Netlify Functions -> PostgreSQL. Later: transactional outbox -> Netlify Async Workloads -> official WhatsApp Cloud API. Signed webhooks update database events and aggregate statuses. The browser never receives Meta credentials or loops over recipients to send.

## Data model
- contacts: unique normalized E.164 phone, current consent evidence, opt-out and archive timestamps.
- consent_events: append-only evidence history; re-consent must explicitly supersede an opt-out.
- tags / contact_tags: many-to-many labels.
- templates: provider identity, language, category, provider status, components and synchronization time; no manual approval.
- campaigns: creator, lifecycle, immutable template/audience snapshot at launch, UTC schedule plus IANA timezone.
- campaign_recipients: unique campaign/contact, provider ID, delivery timestamps, lease and retry metadata.
- dispatch_outbox: durable intent created in the same transaction as campaign launch. A dispatcher can publish repeatedly; workers must claim each recipient atomically.
- message_events / webhook_events: deduplicated provider events. Preserve history without regressing delivered/read evidence.
- import_jobs: progress and safe row errors, no raw file content in logs.
- audit_logs: actor/action/entity plus minimal metadata.
- app_settings: singleton workspace configuration.

## Sending semantics (Phase 4)
Exactly-once external delivery cannot be assumed. A database unique key alone does not make a remote POST idempotent. If Meta accepted a send but the connection failed before the response was saved, move it to `uncertain`; do not automatically send it again. Reconcile provider evidence when possible. Retry only requests with a known retryable rejection, respecting Retry-After. Leases prevent parallel workers from dispatching the same pending row. Lost leases after a dispatch starts are uncertain, not automatically requeued.

At launch: validate role, explicit consent confirmation, fresh usable template, all variable mappings, audience, and future schedule. In one database transaction freeze recipient identities and enqueue outbox intent. Immediately before each delivery, recheck consent, archive status, opt-out, template status, and campaign pause/cancel state. Queued -> dispatching -> accepted -> sent -> delivered -> read. `accepted` means an API message ID exists; it is not proof of delivery. Provider events are authoritative for sent/delivered/read. Completion of dispatch and completion of delivery are different concepts.

STOP, UNSUBSCRIBE, BERHENTI inbound events will revoke consent transactionally. A concurrent send already handed to Meta cannot be recalled. UI will explain this limitation.

## Route plan
| UI | API | Phase |
| --- | --- | --- |
| /login, /auth/callback | /api/session | 1 |
| /dashboard | /api/dashboard | 1 summary; 5 metrics |
| /settings | /api/settings | 1 read-only; 5 updates |
| /contacts | /api/contacts, /api/tags, /api/imports | 2 |
| /templates | /api/templates, /api/templates/sync | 3 |
| /campaigns/new | /api/campaigns | 3 |
| /campaigns/:id | /api/campaigns/:id/{launch,pause,resume,cancel} | 4 |
| /analytics | /api/analytics, /api/exports | 5 |
| provider only | /api/webhooks/whatsapp | 4 |

APIs return {ok:true,data} or {ok:false,error:{code,message}}. Authentication precedes database access. No auth bypass exists for demo. The local UI preview uses synthetic data with a permanent DEMO label and never makes an API send request. Unknown API routes return JSON 404, never the SPA HTML.

## Phases and gates
1. Foundation: pinned compatible packages, responsive shell, login/callback/password setup, role authorization, database migration, read-only summary/settings, tests, configuration and setup docs.
2. Contacts: CRUD, consent history, tags, safe CSV/XLSX mapping, chunked imports, pagination, archive and export. Tests cover duplicate numbers, invalid records, opt-out preservation and formula injection.
3. Templates and builder: provider synchronization, supported-component validation, four-step wizard, variable resolution, recipient preview and draft persistence.
4. Delivery: Cloud API adapter, transactional outbox, Async Workloads extension, scheduler, leases, ambiguous-send handling, webhook signature/idempotency, opt-out events and pause/resume/cancel. Test fault windows and duplicate execution with a mocked provider.
5. Reports and release: event-derived analytics, CSV exports, audit browsing, role/settings administration, accessibility/browser QA and real account smoke tests with explicitly approved test recipients.

Every phase requires typecheck, lint, tests and production build before continuing. Deployment tests are separate from local unit tests. Never claim live integration success from a build or mocked test. No real sending until explicit production configuration, provider setup and end-to-end acceptance tests are complete.

## Verified documentation (2026-10-05)
- https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/
- https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/
- https://docs.netlify.com/build/data-and-storage/netlify-database/
- https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/
- https://docs.netlify.com/build/async-workloads/overview/

Netlify Database requires a credit-based plan. Async Workloads requires enabling the extension. Availability in docs is not evidence that either is enabled for this user's account. Package-lock records installed versions; provider runtime and billing are external configuration.
