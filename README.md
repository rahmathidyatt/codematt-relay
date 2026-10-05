# codematt Relay — Phase 2

Send clearly. Reach responsibly.

Phase 2 provides contact management, consent evidence/history, tag filters, CSV/XLSX import, archive/restore, filtered CSV exports and a persistent local demo. It includes Phase 1 authentication, database and dashboard foundations. Campaigns, WhatsApp sending, webhook, scheduling and delivery analytics are future phases. **No real message can be sent by this release.**

Indonesian VS Code and upgrade instructions: **[docs/PHASE-2-GUIDE-ID.md](docs/PHASE-2-GUIDE-ID.md)**.

## Quick start

Install Node.js 24, open this folder in VS Code, then:

```sh
npm ci
npm run dev
```

Open the printed loopback URL, select **Lihat preview lokal**, then **Contacts**. Demo data persists in `.demo-data` on this computer. Use synthetic records; this unauthenticated developer preview is restricted to loopback requests and is not an operational shared server. Do not expose the Vite server or use a reverse proxy to share it. Demo code is not mounted by a production build. The production UI has no demo button or fallback that bypasses Identity.

Example imports are in `examples/`. All example names/numbers are test data with unknown consent, not real authorized recipients. Database contents and uploaded source files are not bundled.

## Implemented

- Contact creation and name/tag editing, normalization to E.164 with libphonenumber-js, duplicate number protection.
- Database pagination, name/phone search, tag/consent/archive filtering and sorting.
- Manual opt-out; explicit new consent evidence; append-only history through the app. Archived contacts and unknown/revoked consent are ineligible.
- Archive/restore and bulk tag/archive/restore. Optimistic version checks and transactions prevent silent overwrites and partial bulk changes.
- CSV UTF-8 / XLSX parsing in a bounded Web Worker, sheet selection, column mapping, preview, validation, review, progress and error CSV download.
- 100-row idempotent import transactions. Existing contacts are skipped without changing identity, consent or opt-out. Unknown consent may be stored, but cannot qualify for broadcasts.
- CSV export using cursor pages, filters, a 10,000-contact cap and formula neutralization. Exports are not transaction snapshots across pages if contacts change concurrently.
- Server authorization, same-origin mutation protection, bounded JSON bodies, persistent per-user rate limit, safe errors and audit events.

A phone number belongs to its consent identity and cannot be edited in place. Create a new contact for a new phone number. Structural validation does not prove WhatsApp account availability. No phone-account discovery request is made.

## Architecture and routes

React / TypeScript / Vite / Tailwind + Netlify Functions + Netlify Identity + Netlify Database (PostgreSQL). One Netlify site is one workspace. PGlite is development/test only and uses the same SQL migrations and contact service code.

| Endpoint | Methods | Access |
| --- | --- | --- |
| /api/session | GET | Admin / operator / viewer |
| /api/dashboard | GET | Admin / operator / viewer |
| /api/settings | GET | Admin |
| /api/contacts | GET, POST | Admin / operator |
| /api/contacts/:id | PATCH | Admin / operator |
| /api/contacts/:id/consent | POST | Admin / operator |
| /api/contacts/:id/history | GET | Admin / operator |
| /api/contacts/bulk | POST | Admin / operator |
| /api/contacts/export | GET | Admin / operator |
| /api/tags | GET | Admin / operator |
| /api/imports | POST | Admin / operator |
| /api/imports/:id | GET | Creating actor only |
| /api/imports/:id/chunks | POST | Creating actor only |

All production contact/import routes first verify Identity and trusted roles. Mutation requests require a matching Origin and JSON Content-Type. Body limit is 256 KiB and rate limit is 180 contact requests per minute per actor. No secrets or raw source files are logged. Responses are not cached. Unknown API routes return JSON 404.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for tables and future delivery design, and [docs/REQUIREMENTS.txt](docs/REQUIREMENTS.txt) for the original specification.

## Full Netlify setup

```sh
npm install -g netlify-cli
netlify login
netlify init
netlify dev
```

For an existing Netlify project use `netlify link` rather than creating another project. Choose the intended project explicitly. Open the URL printed by `netlify dev`, usually port 8888, for the real Functions backend.

Enable Netlify Identity, set **Invite Only**, invite the first admin through Netlify, and assign trusted `app_metadata.roles` (`admin`, `operator`, `viewer`). Unknown roles are denied. Disable unnecessary external login providers. Configure the site's canonical URL; invitation and recovery links are handled at the root or `/auth/callback`. Roles may require a fresh login/token refresh after changes. The app supports invitation password setup and recovery callback forms; initiating recovery uses Identity administration in this phase.

Netlify Database requires a compatible credit-based plan. Cloud account configuration, billing and provisioning are external prerequisites. No account was linked and no cloud deployment was performed by this build.

## Database migrations

Keep both migrations under `netlify/database/migrations/`:

1. `0001_foundation.sql` — unchanged Phase 1 schema.
2. `0002_contacts_imports.sql` — contact versions, import batch results/counters, rate buckets and indexes.

Netlify's native migration lifecycle applies pending files. Do not run already-applied migrations manually or edit their contents after use. Test the deployment against a preview database before production. Local demo creates/applies these migrations automatically in its own directory; tests execute them with PGlite. Managed Netlify PostgreSQL remains a separate deployment smoke test.

## Environment and secrets

`.env.example` retains future server-only Meta placeholders. Nothing in Phase 2 uses a Meta token or sends a message, even if `WHATSAPP_SEND_ENABLED` is set true. Keep it false. Never prefix credentials with VITE_, commit `.env`, or place credentials in browser storage. Use Netlify Functions runtime environment variables when the actual integration phase is implemented.

| Variable | Future purpose |
| --- | --- |
| WHATSAPP_SEND_ENABLED | Explicit production send gate; false now |
| WHATSAPP_ACCESS_TOKEN | Official Cloud API token |
| WHATSAPP_PHONE_NUMBER_ID | Sender identifier |
| WHATSAPP_BUSINESS_ACCOUNT_ID | Template account identifier |
| WHATSAPP_VERIFY_TOKEN | Webhook verification secret |
| META_APP_SECRET | Webhook HMAC verification |
| WHATSAPP_API_VERSION | Explicitly verified supported Graph API version |

Async Workloads and Scheduled Functions are planned for Phase 4. Their extension/worker/webhook are not installed or configured yet. Do not subscribe Meta webhooks to this version.

## Import limits and resume semantics

Source files: 5 MiB; 10,000 data rows; 40 columns; 10 sheets; 2,000 characters per input cell. XLSX extraction: 20 MiB, 200 entries. Formula/macro/external-link workbooks are rejected; save values in a simple XLSX first. Worker parsing expires after 20 seconds. CSV must be UTF-8; legacy XLS is not supported.

The server validates every mapped row again. Batches of 100 commit independently. The job owner and payload hash are checked before replay. Retrying an acknowledged/uncertain batch returns its stored result, not new inserts. A batch transaction that fails is rolled back. A closed/reloaded import dialog loses its client cursor; reimporting the same source uses a new job and skips existing numbers. Prior successful batches remain saved. There is no automatic rollback of an entire multi-batch import.

Consent dates accept ISO with timezone or date-only YYYY-MM-DD interpreted at midnight Asia/Jakarta. Manual forms use the operator's device local timezone. Unknown status never implies consent. Re-consent must have new evidence later than previous opt-out. Imports never reactivate existing contacts.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs TypeScript, ESLint, Vitest and production build. Unit/integration tests execute real SQL in PGlite with no Meta requests. Browser tests start an isolated demo server on port 5180 and use `.demo-test-data`; they reset only that test database. A preinstalled Chromium can optionally be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` in the test environment. See the implementation report for actual results and limitations.

## Deploy

Import the source repository into Netlify. Configuration: Node 24, `npm run build`, publish `dist`, Functions `netlify/functions`. `netlify.toml` provides SPA/API forwarding and security headers. Git deploy or Netlify CLI is required; dragging only dist cannot deploy backend code and migrations.

```sh
netlify deploy --build
```

Review the draft, configure Identity/Database, and verify the integration before intentionally publishing with `netlify deploy --build --prod`. No publishing has been done on your behalf.

Required cloud smoke checks: anonymous API access is rejected; viewer contact access is forbidden; admin/operator can create/edit/import; cross-origin mutations are rejected; the second migration applies; auth invite/login/recovery work; a duplicate import preserves opt-out; page reload routes work. Passing local checks is not proof these cloud checks passed.

## Next phase

Phase 3: official template synchronization, supported component validation, audience selection, variable mapping, personalized preview and persistent campaign drafts. Queueing, real delivery/webhooks and scheduling follow in Phase 4. Operational reporting follows in Phase 5.
