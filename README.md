# David Macharia Kimani Portfolio

## Requirements

- Node.js 18 or newer
- PowerShell on Windows

## Configure the admin password

From the project folder, copy the example environment file:

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

## Run locally

```powershell
npm install
npm start
```

Open the portfolio at <http://localhost:3000> and the admin panel at <http://localhost:3000/admin>. Sign in with the password configured in `.env`.

## Visitor features

- Search pages and topics from the header.
- Search projects by title or description and filter by All, Frontend, or Backend.
- Save projects locally in the current browser.
- Copy email, LinkedIn, GitHub, and WhatsApp contact links.
- Send a contact form message asynchronously to the owner's private local inbox.
- Download a CV as a Markdown file from the current portfolio content.
- Download a vCard contact file with your email, phone, and profile URLs.
- Like the profile and follow LinkedIn or GitHub.
- Create a visitor account or sign in before accessing any portfolio page.
- Recover a visitor password with the account email and its private recovery key.

## Deploy to Render

This project is deployed on Render.com. Both frontend and backend run as a single Node.js web service.

### Required environment variables

Set these in Render **Service Settings → Environment Variables**:

| Variable | Required value |
|---|---|
| `ADMIN_PASSWORD` | Unique bootstrap password, at least 12 characters and no more than 72 UTF-8 bytes. |
| `SESSION_SECRET` | Random secret of at least 32 characters. |
| `TURSO_DATABASE_URL` | The Turso database URL (`libsql://...`). |
| `TURSO_AUTH_TOKEN` | A database auth token with access to that database. |

`NODE_ENV=production` and `HOST=0.0.0.0` are configured in `render.yaml`. `PORT` is set automatically by Render.

### Prepare and migrate existing data

1. Make a separate backup of `data/portfolio.db`, `data/portfolio.json`, `data/analytics.json`, `data/visitor-accounts.json`, and `uploads/`.
2. Create a Turso database and auth token using the [Turso CLI](https://docs.turso.tech/cli/introduction).
3. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in your local `.env`.
4. Run: `npm run migrate:render`
5. The command initializes the remote schema, imports existing database rows and JSON content without removing local data.

### Verification

Run `npm test` locally. After deployment, confirm that unauthenticated access to portfolio pages redirects to `/account.html`, authenticated visitors can browse, and `/api/admin/*` rejects unauthenticated requests.