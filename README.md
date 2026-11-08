# David Macharia Kimani Portfolio

## Requirements

- Node.js 18 or newer
- PowerShell on Windows

## Configure the admin password

From the `Mycoding` folder, copy the example environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and set `ADMIN_PASSWORD` to a unique password with at least 12 characters. Do not commit or share `.env`.

Generate a session secret in PowerShell:

```powershell
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the generated value into `SESSION_SECRET` in `.env`. Keep this value private. `.env` is excluded by `.gitignore`.

For admin password recovery, generate a different random secret of at least 32 characters and set it as `ADMIN_RECOVERY_KEY` in `.env`. Keep it somewhere secure and separate from the server; anyone with this key can issue a password reset. The admin sign-in page uses this key to issue a one-time reset token valid for 15 minutes. Recovery is rate-limited and same-origin protected. Email-based recovery is not available because this project does not send email. If `ADMIN_RECOVERY_KEY` is not configured, password recovery is disabled.

```powershell
$recoveryBytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($recoveryBytes)
[Convert]::ToBase64String($recoveryBytes)
```

## Run locally

```powershell
npm install
npm start
```

Open the portfolio at <http://localhost:3000> and the admin panel at <http://localhost:3000/admin>. Sign in with the password configured in `.env`.

The portfolio has ten public pages: Home, About, Skills, Education, Projects, Athletics, Coding, Academic Record, Professional Focus, and Contact. Use the icon navigation to move between them.

## Visitor features

- Search pages and topics from the header.
- Search projects by title or description and filter by All, Frontend, or Backend.
- Search projects and filter them instantly into All, Frontend, or Backend categories.
- Sort projects alphabetically by title.
- Save projects locally in the current browser.
- Copy email, LinkedIn, GitHub, and WhatsApp contact links.
- Send a contact form message asynchronously to the owner's private local inbox; email and WhatsApp links remain available for direct contact.
- Download a CV as a Markdown file from the current portfolio content.
- Download a vCard contact file with your email, phone, and profile URLs.
- Increase text size with a preference saved in the current browser.
- Enable reading mode to reduce visual background distractions.
- Like the profile and follow LinkedIn or GitHub.
- View original coding and athletics illustrations.
- Review private page, skill, follow, Like, daily trend, and engagement charts in Admin Insights.
- Maintain certificates and badges, page-specific SEO titles/descriptions, and a site-wide accent color/default theme in Admin → Site tools.
- Upload JPEG, PNG, WebP, or PDF portfolio files (up to 5 MB each) to private local storage; uploaded links require visitor sign-in.
- Follow the portfolio, submit comments for owner moderation, and send contact messages to the private local inbox.
- Create a visitor account or sign in before accessing any portfolio page. Review account details and delete the account from the visitor dashboard.
- Recover a visitor password with the account email and its private recovery key; set or replace the key from the signed-in dashboard.
- Browse all provided portfolio photos in a responsive gallery without a 3D carousel or background image.
- Share the current page with native sharing or a copied link.
- Print a page or save it to PDF from the browser.
- View reading progress while scrolling.
- Return to the top of a long page with one control.
- Switch between light and dark themes.

Project bookmarks are device-local. Email and WhatsApp contact links open the selected app; the contact form sends its message asynchronously to the local admin inbox and does not send email automatically. Contact form submission requires a signed-in visitor account and is protected by same-origin checks and the shared community-action rate limit.

Visitor accounts are required before any portfolio page or portfolio content API can be accessed. Unauthenticated visitors are redirected to the sign-up/sign-in page and returned to their requested page after authentication. The account page and owner admin sign-in remain available without a visitor session. Registration stores a display name, email address, one-way password and recovery-key hashes, and account creation and data-notice timestamps in the database. Passwords must be 8–128 characters and recovery keys 12–128 characters; choose separate unique passphrases and keep the recovery key somewhere private. Neither is stored as plain text. Visitors can set or replace their recovery key from the signed-in dashboard after confirming their current password, and can request a one-time password-reset token using their email plus that recovery key. Reset tokens are stored hashed, expire after 15 minutes, and successful resets invalidate all active sessions. Email addresses are not verified and reset links are not emailed. Existing users should set a recovery key from their dashboard before signing out if they have not already registered one. Visitors can delete their account from their dashboard; copies in backups must be handled under the site's backup-retention policy. Login and registration rate limits use hashed connection identifiers, while community-action limits use the visitor account ID; the limits are shared across serverless instances and do not store raw IP addresses. Visitor accounts are not shown publicly or included in analytics.

Page-view, skill-interest, follow-click, and engagement analytics are sent only after a visitor opts in. Likes require an explicit click; a random browser token is hashed server-side only to prevent repeated likes from inflating the count. Runtime analytics are excluded from version control. Visitors can decline analytics or withdraw consent from the portfolio footer; withdrawal deletes that browser's pseudonymous events and sessions.

The admin panel edits profile copy, focus areas, education, skills, projects, and contact links. Initial content is loaded from `data/portfolio.json`; published content and drafts are then stored in the database and shared across application instances. Keep backups of both the source JSON and database.

The owner dashboard also shows real server/database/API health, response time, application errors, failed and rate-limited administrator sign-ins, registered-account and project counts, and recent administrator activity. It supports unsaved previews, drafts, explicit publishing, the 20 most recent published revisions, and filtered JSON, CSV, and PDF analytics exports. Restoring a revision replaces the draft only; publish it separately to change the public portfolio. Project and other repeatable content can be added, removed with confirmation, and reordered before saving.

On first startup, the configured `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` is hashed and saved in the database. Use the dashboard's Security section to change it afterward; the database credential then takes precedence over the bootstrap environment value. If locked out, use the configured `ADMIN_RECOVERY_KEY` on the admin sign-in page; recovery invalidates existing admin sessions and does not send email. Administrator and visitor sessions and rate limits are stored in the database and shared across serverless instances. Sessions expire after 30 minutes. Keep database credentials and backups private: the database contains visitor account data and the administrator password hash. Local SQLite files, drafts, and revision history are excluded from version control.

## Website analytics and privacy

The Analytics tab extends the existing consent choice. Tracking begins only after the visitor accepts the updated notice. A random browser identifier is HMAC-hashed by the server; session IDs are temporary and no visitor account ID, display name, email, IP address, exact location, or full referrer URL is stored in analytics. Detailed events and sessions are automatically pruned after 365 days. Visitors can withdraw consent; their identifiable pseudonymous event/session rows are deleted and daily aggregates are recalculated from the remaining events.

The dashboard reports visits (sessions), pseudonymous unique and returning browsers, currently active consented sessions (heartbeat within two minutes), page views, approximate session duration, bounce rate, CV-download clicks, successful local contact-inbox submissions, referrer hostnames/categories, device/browser/OS categories, landing/exit pages, popular projects/sections, engagement, and a ranking with only an anonymous/signed-in flag. The public live-visitor badge exposes only the aggregate count of sessions active within the same two-minute heartbeat window. Normal page navigation in the same tab remains within one session; a session becomes inactive after its heartbeat expires. Visitor rankings never include names, account IDs, or stable visitor identifiers. Portfolio pages currently require visitor sign-in, so ordinary portfolio traffic is expected to appear as signed-in; this does not link analytics to the account record. CV counts represent a download-button click, not confirmation that the browser saved the file. Email/WhatsApp launches are interactions, not confirmed messages.

The site does not use IP geolocation, so country analytics are unavailable unless a trusted external provider is configured later. Search/social/referral categories are inferred from the referring hostname only. Date filters use UTC; the custom range is limited to one year. Chart intervals can be daily, weekly, or monthly. The live activity feed and summary poll every 30 seconds only while the Analytics tab is open. Chart.js is installed and served locally; no analytics data is sent to a chart provider or third-party analytics service. Existing aggregate data from `data/analytics.json` is retained in the persistent database during migration where its original date detail is unavailable.

Analytics schema changes are additive and initialize automatically. Local development uses SQLite at `data/portfolio.db`; the Vercel deployment uses Turso/libSQL. Back up the local database before migration. To verify tracking, sign in as a visitor, accept the updated analytics notice, browse multiple pages, click a project/CV/contact action, then sign in at `/admin` and choose Analytics. Declined visitors must not create analytics rows; withdrawing consent should remove that browser’s session/event records.

Admin → Site tools manages certificates/badges, per-page SEO metadata, local appearance settings, uploaded files, comment moderation, and contact messages. Comments remain private until approved; approved comments display the account's chosen display name. Visitor deletion removes that account's comments, follows, and messages from the live database.

Uploads accept JPEG, PNG, WebP, and PDF files up to 5 MB. Local development stores files under `uploads/`; Vercel uses a private Blob store and serves each file through the authenticated application, not a public Blob URL. The migration command copies local upload files to private Blob storage. Keep backups until the remote migration and deployment have been verified.

Contact submissions are stored in the administrator's local database inbox. No email is delivered or sent automatically: outbound email requires an SMTP/provider account and credentials, which are intentionally not configured for this local-only setup. The owner can review and delete messages in Admin → Site tools and contact the sender using the reply address.

## Deploy to Vercel

The root project uses Vercel Node.js Functions to run the existing custom Node HTTP handler. All page and API requests pass through the handler so visitor-only page access is not bypassed by static hosting. Local development continues to use SQLite and the local `uploads/` directory; production requires Turso/libSQL and a **private** Vercel Blob store. Published content, drafts, revisions, sessions, rate limits, visitor data, administrator credentials, and analytics are persisted in the database. Uploaded files are stored in private Blob and proxied through the authenticated server.

### Required environment variables

Set these in Vercel **Project → Settings → Environment Variables**. Use **Production** and **Preview** as appropriate; never put these values in HTML, JavaScript, README files, or Git:

| Variable | Required value |
|---|---|
| `ADMIN_PASSWORD` | Unique bootstrap password, at least 12 characters and no more than 72 UTF-8 bytes. Set either this or `ADMIN_PASSWORD_HASH`, not both. |
| `SESSION_SECRET` | Random secret of at least 32 characters; use a new value for this deployment. |
| `TURSO_DATABASE_URL` | The Turso database URL (`libsql://...`). |
| `TURSO_AUTH_TOKEN` | A database auth token with access to that database. |
| `BLOB_READ_WRITE_TOKEN` | Read/write token for the connected **private** Vercel Blob store; client uploads use it to create upload tokens. |

`NODE_ENV=production` is supplied by Vercel. `PORT` and `HOST` are only needed for local server operation. Do not set real values in `.env.example` or commit `.env`/`.env.local`; those files are ignored by Git.

### Prepare and migrate existing data

1. Make a separate backup of `data/portfolio.db`, `data/portfolio.json`, `data/portfolio.draft.json` if present, `data/portfolio-revisions/`, `data/analytics.json`, `data/visitor-accounts.json`, and `uploads/`. The migration script does not delete or modify these local files.
2. Create a Turso database and auth token using the [Turso CLI](https://docs.turso.tech/cli/introduction):

   ```powershell
   turso db create david-kimani-portfolio
   turso db show --url david-kimani-portfolio
   turso db tokens create david-kimani-portfolio
   ```

3. In Vercel, create a **private** Blob store and connect it to the project. Copy its `BLOB_READ_WRITE_TOKEN` into the local `.env` (or `.env.local`) for migration and into Vercel's environment variables.
4. Put `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `BLOB_READ_WRITE_TOKEN` in the local ignored environment file. Set `ADMIN_PASSWORD` and `SESSION_SECRET` there as well. Never paste secrets into source files or terminal output.
5. Before the first production request, run:

   ```powershell
   npm install
   npm run migrate:vercel
   ```

   The command initializes the remote schema, imports existing database rows and JSON content without removing local data, and transfers uploaded files to private Blob storage. It stops with an explicit error if a file referenced by the database is missing. Run it once against the new, otherwise-unused Turso database. Review its row-count summary before deploying.

### GitHub and Vercel setup

1. Confirm `.env`, `.env.local`, `node_modules/`, `.vercel/`, and `dist/` are ignored. Review `git status` and ensure no credentials, local database, visitor records, or uploaded files are staged.
2. Initialize and push this project to a private or public GitHub repository from the project root (the current workspace is not yet a Git repository):

   ```powershell
   git init
   git add .
   git commit -m "Prepare portfolio for Vercel"
   git branch -M main
   git remote add origin https://github.com/<your-account>/<your-repository>.git
   git push -u origin main
   ```

3. In Vercel, select **Add New → Project**, import that GitHub repository, and keep the project root at the repository root. The framework is **Other**; the build command is `npm run build`. Vercel runs production builds automatically for pushes and creates Preview Deployments for branches and pull requests.
4. Add the required environment variables above to the project before the first deployment. Ensure your private Blob store is connected to the project and its read/write token is present for the environments where uploads are enabled.
5. Deploy to Preview first. Verify the homepage and mobile layout, visitor registration/login, access redirects, admin login/dashboard, content draft/publish/revision flows, analytics consent and reports, and a private document upload/download/delete. Then review the Preview changes before promoting or merging to Production. No deployment has been run from this workspace.

### Verification

Run `npm test` and `npm run build` locally. `npm test` uses Node's test runner; add tests as features are expanded. To check a deployed Preview, confirm that unauthenticated access to portfolio pages redirects to `/account.html`, authenticated visitors can browse, and `/api/admin/*` rejects unauthenticated requests. Never test with production visitor data.

Contact submissions remain in the admin inbox; they do not send email. Country-level analytics remain unavailable without a separately reviewed geo provider.
