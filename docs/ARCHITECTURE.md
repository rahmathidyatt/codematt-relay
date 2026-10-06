# codematt Relay — architecture and phased delivery

Status: Phase 4 delivery implemented and locally tested. Live cloud integration and browser verification remain outstanding.

## Boundaries
One Netlify site represents one workspace. Every signed-in user must have a trusted Identity role: admin, operator, or viewer. Unknown roles have no access. Multi-workspace hosting requires a separate tenant isolation design before implementation. Credentials stay in Functions environment variables; there is no public registration UI. Identity must be configured Invite Only at the provider.

React + TypeScript + Vite -> authenticated Netlify Functions -> PostgreSQL. Transactional outbox -> Netlify Async Workloads -> official WhatsApp Cloud API. Signed webhooks update database events and aggregate statuses. The browser never receives Meta credentials or loops over recipients to send.

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

STOP, UNSUBSCRIBE, BERHENTI inbound events revoke consent transactionally. A concurrent send already handed to Meta cannot be recalled. UI explains this limitation.

## Route plan
| UI | API | Phase |
| --- | --- | --- |
| /login, /auth/callback | /api/session | 1 |
| /dashboard | /api/dashboard | 1 summary; 5 metrics |
| /settings | /api/settings | 1 read-only; 5 updates |
| /contacts | /api/contacts, /api/tags, /api/imports | 2 |
| /templates | /api/templates, /api/templates/sync | 3 |
| /campaigns (draft dialog) | /api/campaigns, /api/campaigns/:id, /api/campaigns/preview | 3 |
| /campaigns (review/monitor dialogs) | /api/campaigns/:id/{review,delivery,launch,test,pause,resume,cancel} | 4 |
| /analytics | /api/analytics, /api/exports | 5 |
| provider only | /api/webhooks/whatsapp | 4 |

APIs return {ok:true,data} or {ok:false,error:{code,message}}. Authentication precedes database access. No auth bypass exists for demo. The local demo uses a separate loopback-only /__demo/api namespace backed by PGlite, with a permanent DEMO label and no send request. Production API authentication is never bypassed. Unknown API routes return JSON 404, never the SPA HTML.

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

## Phase 2 implementation decisions
- Contact phone numbers are immutable identities. Editing a name or tag never changes consent. To use another number, create a separate contact with its own consent evidence.
- All contact, tag and import endpoints require admin/operator; viewer is limited to reports. Mutations reject absent or cross-origin Origin headers, non-JSON requests, and bodies above 256 KiB. Production contact requests have a durable 180/minute per-actor fixed-window limit.
- A version integer and FOR UPDATE lock prevent stale updates. Bulk changes are atomic; one stale selection rolls back the entire bulk action.
- Consent grant/revoke and evidence history share one transaction. Grant requires explicit confirmation and source/date, after any previous opt-out. Archives cannot receive new consent until restored; restoring does not grant consent.
- Import runs in sequential 100-row transactions. Job IDs and chunk hashes provide replay safety. Duplicates, including archived/opted-out contacts, are never updated by import. A rejected transaction creates no partial chunk. Client can resume the same chunk while its dialog remains open. Closing/reloading loses the client cursor; reimport creates a new job but duplicate phones remain protected.
- Source files are parsed in a Web Worker, bounded to 5 MiB, 10,000 data rows and 40 columns. XLSX uncompressed contents are capped at 20 MiB; XML formulas, unsafe archive paths, external-link parts and macros are rejected. Only validated, rebuilt ZIP data is passed to the spreadsheet parser. Worker is terminated after 20 seconds. Server revalidates all mapped contact records.
- Table data is paginated in the database; exports use 500-row UUID cursor pages and a creation cutoff. Export is capped at 10,000 contacts. It is not a repeatable-read snapshot across requests: concurrent edits may appear in later pages. Formula-like CSV cells are escaped.
- Demo routes exist only inside Vite development middleware and only accept loopback Host with same-origin mutation requests. Data is in .demo-data, isolated from Netlify. E2E uses .demo-test-data. Both are excluded from Git and delivery ZIP.
- Initial segment support is tag + consent + archive filtering. Saved named segments are not included. Tags are normalized lowercase and limited to 20 per contact. Tag filter suggestions are capped at 100 and narrowed by typed input.

## Phase 3 decisions
- Sync uses a server-only bearer token and fixed Graph host; only cursor values are reused from provider pagination. Complete fetch and database changes are all-or-nothing under a singleton sync-row lock. Failed sync leaves the cache unchanged; missing entries become UNAVAILABLE only after full success. Current WABA provenance, APPROVED status, supported components and a 24-hour freshness limit determine builder usability.
- Shared workspace drafts use optimistic integer versions. The name is required, while missing template/variables are allowed until review. Draft snapshots record template content and currently eligible contact IDs/counts, but preview always re-reads current records. No recipients or outbox entries are created in Phase 3.
- Audience rules support all, tag/search segment, or manual IDs. Exclusive skip counts prioritize archive, opt-out, missing consent, then invalid phone. Matching audience is capped at 10,000 before exclusions; manual IDs are deduplicated/capped at 1,000.
- Text header/body positional and named placeholders are scoped by component. Footer is static; common static buttons are display-only. Unsupported media/dynamic/OTP/complex formats remain visible in the catalogue with reasons.
- Production templates/drafts require admin or operator, synchronization requires admin, and viewer sees aggregate dashboard only. Same-origin, request size and existing persistent per-actor rate guards apply.
- Draft creation uses a client UUID so an uncertain response can be reconciled by reopening the existing draft rather than generating a new one. A repeated create cannot overwrite an existing record.

## Phase 4 implementation decisions
- Launch review binds draft version, fresh template, frozen parameters and contact versions to a confirmation hash. Launch atomically creates unique recipients and one outbox intent per campaign. Test sends use a separate child campaign and client-generated idempotency ID.
- A production scheduler publishes due outbox rows through the official Async Workloads SDK. Generation and lease checks prevent stale publisher acknowledgements from erasing newly requested work. The authenticated workload wrapper rejects direct unauthenticated requests.
- One database lease serializes sending across the workspace. Every provider request follows a durable dispatching marker; an expired dispatch claim becomes uncertain. Explicit rate-limit rejections alone can retry, with a global Retry-After delay and five-attempt cap.
- Worker checks current consent, suppression, archive, sender/account and template before every recipient. Parameters remain the launch snapshot. Template cache expiry or provider quality/authentication errors pause work.
- Raw-body HMAC authenticates webhook POSTs before parsing/storage. WABA and phone identity scope events. Deduplicated status evidence can arrive before the response ID; reconciliation preserves read/delivered evidence against older events. Missing response IDs may remain unmatched.
- Suppressions preserve opt-outs for unknown numbers. New consent must postdate opt-out evidence. Exact STOP/UNSUBSCRIBE/BERHENTI messages are processed; this is not an inbox.
- Local simulation uses the same delivery services with a deterministic adapter and explicit manual batch/event controls. No Meta request or autonomous demo scheduler runs.
- Migration 0004 adds delivery_control and contact_suppressions plus account/sender snapshots and outbox lease/generation fields. No changes to prior migration contents.

Operational setup: PHASE-4-GUIDE-ID.md. Verification and remaining limits: IMPLEMENTATION-REPORT.md.
