# Phase 4 implementation report

## Delivered

This release includes all Phase 1–3 source plus migration 0004 and delivery features:

- Launch review bound to current draft/template/contact versions, explicit consent confirmation, typed campaign name for 100+ recipients, immutable recipient/parameter snapshots and transactional outbox creation.
- Immediate queued launch, timezone-aware future schedules, idempotent one-contact child test campaigns, pause/resume/cancel and paginated recipient monitoring.
- Official WhatsApp Cloud API template adapter with bounded responses, timeout, server-only credentials and conservative error classification. Accepted is distinguished from delivered/read.
- Durable database queue, generation-checked outbox publication, official Netlify Async Workloads SDK wrapper, minute scheduler, one global sending lease and rate interval.
- Revalidation of consent, opt-out, archive, account/sender and template before each request. Explicit rate-limit rejection retries honor global Retry-After and stop after five attempts. Ambiguous responses, timeout, 5xx or expired dispatch claims become uncertain and are not automatically resent.
- Raw-body HMAC webhook verification, verification handshake, account/sender filtering, event deduplication, early-event reconciliation and non-regressing delivery evidence.
- Exact STOP/UNSUBSCRIBE/BERHENTI opt-out handling, including unknown-number suppression and protection against importing stale consent. Later explicit consent can supersede older opt-out evidence.
- Manual local simulation using shared services without network sends. Separate demo batch and webhook controls, health timestamps and clear status explanations.
- Indonesian upgrade/demo/activation guide and updated environment examples. Real sending defaults to disabled.

## Verification completed

`npm run check` passed on 2026-10-06: TypeScript, ESLint, **71 Vitest tests across 8 files**, and Vite production build.

Tests execute all four SQL migrations in PGlite and cover review invalidation, launch/test idempotency, schedule validation, large-audience confirmation, duplicate/concurrent workers, consent changes, pause/resume/cancel, provider classification, retry delay/cap, ambiguous dispatch recovery, outbox generations, signed/duplicate/early/out-of-order/foreign webhooks, unknown-number suppression, delayed old opt-out and role/origin controls.

Fault-window tests include a database failure after provider acceptance and cancellation during an in-flight request. The actual installed Async Workloads wrapper is tested for rejecting unauthenticated direct requests. Real local Vite HTTP routes are exercised through campaign creation, review, launch, simulated dispatch and status update. Provider sends are mocked; no real WhatsApp messages were sent.

The four function entry points also bundled successfully with esbuild for Node ESM and external packages. This checks local module resolution, not a deployed Netlify runtime or extension installation.

## Browser and external limitations

The included Phase 4 Playwright scenario was attempted with the available Chromium executable, but the browser closed during launch before any UI step. Desktop/mobile layout, keyboard/focus behavior and complete click-through flows are not visually verified. No successful screenshots are claimed. Phase 2–4 browser scenarios are included for local execution.

No Netlify account was linked or deployed. Identity invitation/login/recovery, managed PostgreSQL migrations, extension/router installation, scheduled invocation, workload delivery, Meta token/permissions/version validity, template sync, message acceptance and real webhook delivery have not been tested against the user's accounts. The setup guide identifies these remaining activation checks.

## Operational limits

- One site/workspace; global serialized sender. Audience limit 10,000 matched contacts; manual selection 1,000. Recipient monitor pages contain 25 records and test selection shows the first 100 eligible review records.
- Supported text header/body parameters and common static components only; media, OTP and complex/dynamic components remain blocked. Named and positional payload support still needs live account acceptance testing.
- Template cache expires after 24 hours; no automatic template refresh. Changed content requires a new campaign for remaining recipients.
- Exactly-once remote delivery is not guaranteed. An accepted response lost before the provider ID is stored may leave unmatched webhook evidence and an uncertain recipient. There is no forced retry for uncertain rows.
- Campaign completion describes dispatch completion, not confirmed delivery. Pause/cancel cannot recall requests already in flight. Scheduler/queue/rate limits mean a schedule is an earliest start, not an exact delivery deadline.
- SDK installation does not provision the Async Workloads extension. Production context, complete credentials and both explicit send gates are required. Configuration availability is structural, not proof of working connectivity.
- No inbox, advanced analytics, report exports, audit browser, automatic retention or live production acceptance tests in this phase. These remain Phase 5/release work.

## Design references

- https://docs.netlify.com/build/async-workloads/get-started/
- https://docs.netlify.com/build/async-workloads/writing-workloads/
- https://docs.netlify.com/build/async-workloads/sending-events/
- https://docs.netlify.com/build/functions/scheduled-functions/
- https://www.postman.com/meta/whatsapp-business-platform/overview
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

The source ZIP excludes credentials, demo/runtime databases, node_modules, build outputs and browser binaries. The historical Phase 3 report is retained separately as PHASE-3-REPORT.md.
