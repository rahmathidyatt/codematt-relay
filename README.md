# codematt Relay

Send clearly. Reach responsibly.

**Delivery: Phase 1 foundation, not a finished broadcast application.** Includes a responsive Indonesian shell, local UI demo, Netlify Identity login/invitation/recovery flows, server-side roles, read-only database summary, a PostgreSQL foundation migration, Netlify configuration and tests. Contacts/imports, template sync, campaigns, queue, WhatsApp/webhooks, scheduling, reports and export remain subsequent phases. Their navigation pages state this explicitly. There is no send endpoint in this release.

## Start in VS Code (Windows, macOS or Linux)

1. Extract this ZIP, then open the **codematt-relay** folder in VS Code using File > Open Folder. The Explorer must show `package.json` directly inside that folder.
2. Install Node.js 24 LTS if needed. Open a new VS Code terminal using Terminal > New Terminal.
3. Check `node --version` (must show v24.x) and `npm --version`.
4. In that terminal run:

```sh
npm ci
npm run dev
```

5. Open the local URL printed by Vite, normally `http://localhost:5173`. Select **Lihat preview lokal**. This is an empty synthetic workspace, clearly labeled DEMO. It does not log into Netlify, persist contacts or send messages. Changes of page work on desktop/mobile.
6. Stop the server with Ctrl+C. Use `npm run dev` to reopen it. No .bat file is required.

If PowerShell blocks npm.ps1, use `npm.cmd ci` and `npm.cmd run dev`, or select the Command Prompt terminal profile in VS Code. If Vite reports a network-interface error in a restricted container, use `npm run dev -- --host 127.0.0.1`.

## Full local backend / Netlify setup

Use a Netlify account with a credit-based plan for Netlify Database. Costs and resource quotas are account-specific; this project does not promise free bulk messaging.

```sh
npm install -g netlify-cli
netlify login
netlify init
netlify dev
```

Choose/create the intended Netlify project during init. Open `http://localhost:8888` for Functions; port 5173 alone is the UI development server. Identity must be enabled for the linked Netlify project. No credentials or account setup have been performed on your behalf.

In the Netlify project:

- Enable Identity; set registration to **Invite Only** before inviting users. Disable unneeded external authentication providers.
- Invite yourself through the Netlify UI and assign `admin` in the user's trusted app metadata roles. Never grant roles from user-editable metadata. Other roles: `operator` and `viewer`.
- Set the Identity site URL to the deployed URL. Invitation/recovery links may land on `/auth/callback` (or the root); the application reads the callback token before rendering the workspace.
- An invite opens a password setup form; recovery opens a new password form. Password recovery requests can be initiated from Identity administration in this phase. There is no public signup or recovery-request UI.
- Roles are enforced again inside Functions. A user with no supported role is denied. Role changes may require token refresh or a fresh login.

The exact installed package APIs were inspected. Provider login, email callbacks and role behavior still require an end-to-end test on your linked site. Do not treat local mocked tests as a live account test.

## Database and migrations

`@netlify/database` is used only on the server. Netlify manages the connection for a linked project. The native migration is `netlify/database/migrations/0001_foundation.sql`. Netlify detects this directory during deployment; no database credentials belong in the frontend.

Migration constraints were executed using PGlite's embedded PostgreSQL engine. Deployment against Netlify-managed PostgreSQL remains to be tested. Do not re-run the migration manually after the platform has applied it. Future changes must use new numbered migration files. Do not rename or edit an already-applied migration.

This is one workspace per Netlify site. It is not a multi-tenant SaaS. See `docs/ARCHITECTURE.md` for tables, route plan, authorization, dispatch semantics and remaining phases.

## Environment variables

`.env.example` contains placeholders for the later WhatsApp integration. Copy it to `.env` only if needed locally. Never commit `.env` or any credentials. There are no required VITE_* secrets.

| Variable | Use |
| --- | --- |
| WHATSAPP_SEND_ENABLED | Keep false. Phase 1 has no sending code, even if set true. |
| WHATSAPP_ACCESS_TOKEN | Future server-only Cloud API token. |
| WHATSAPP_PHONE_NUMBER_ID | Future sender phone identifier. |
| WHATSAPP_BUSINESS_ACCOUNT_ID | Future template synchronization account. |
| WHATSAPP_VERIFY_TOKEN | Future webhook subscription verification secret. |
| META_APP_SECRET | Future webhook HMAC verification key. |
| WHATSAPP_API_VERSION | Future explicitly pinned supported Graph API version. |

Add secrets only to Netlify Functions runtime scope when Phase 4 is ready. Preview/dev deployments must never receive production sending authorization. This release stores no Meta token and performs no Meta request.

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

Or run `npm run check`. All dependencies are pinned and the lockfile is included. Tests cover server role boundaries, safe errors, no auth/database access through unknown send endpoints, consent evidence constraints, E.164 shape constraints, unique contact phones, and unique campaign recipients/provider IDs. No real messages are sent. Phone normalization and CSV/XLSX processing are Phase 2 work; the database shape check does not prove a number uses WhatsApp.

## Deploy Phase 1 to Netlify

Push the source to a new repository, excluding files listed in `.gitignore`, and import that repository in Netlify. The build command is `npm run build`, publish directory is `dist`, Functions directory is `netlify/functions`, and Node major is 24. `netlify.toml` includes SPA fallback and API forwarding. Prefer Git deployment or the Netlify CLI; uploading only `dist` does not deliver the Functions/database project.

Alternatively, after linking and reviewing account configuration:

```sh
netlify deploy --build
```

Review the draft deploy first. Use `netlify deploy --build --prod` only when you intend to publish it. Verify Identity redirects against the appropriate site URL; a preview's database/auth availability must be checked separately. Production does not expose the local demo button.

Acceptance smoke test on the linked site: unauthenticated API request returns 401; viewer can see summary but settings returns 403; admin can see settings; missing database returns a safe 503; login/invite/recovery work; `/contacts` survives reload; `/api/unknown` returns JSON 404. There is no working campaign send flow yet.

## WhatsApp / Async Workloads preparation (Phase 4)

Use only official Meta WhatsApp Business Platform. Prepare a business account, registered sender, token with appropriate permissions, and approved templates. Do not paste tokens into chat or frontend configuration. Before implementing, verify the then-current Meta API version, template components, webhook signature rules, account limits and permissions in official documentation. This phase does not supply a working webhook endpoint, so do not subscribe Meta to it yet.

The Async Workloads extension must be enabled on the target Netlify site when the worker is implemented. Its package is intentionally not installed in Phase 1 because no worker uses it yet. Scheduler will only claim due campaigns and publish small identifiers; actual sends run asynchronously. Detailed decisions, including uncertain responses that cannot safely retry, are in the architecture document.

## Troubleshooting

- Preview works but login does not: port 5173 is UI only. Enable Identity and use linked `netlify dev` or the deployed site.
- Access denied after login: assign a trusted role in Identity, then sign out and in.
- Database unavailable: confirm the plan, project link, provisioned database and successful migration in the Netlify deploy logs. Do not place credentials in the browser to fix it.
- No contacts/import/send button: those operational flows are not in Phase 1; the UI deliberately shows their planned phase.
- A callback expired: request a new invitation or recovery link through Identity administration.

## Next work

Continue Phase 2: contact API, consent events, tagging, opt-out/renewed-consent rules, CSV/XLSX import wizard, pagination, archive, safe exports and tests. Then proceed through the phases in `docs/ARCHITECTURE.md`. The complete original requirements are retained in `docs/REQUIREMENTS.txt`.
