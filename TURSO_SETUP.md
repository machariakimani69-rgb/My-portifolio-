# Turso Database Setup Guide for Render Deployment

## Prerequisites
- [ ] Turso CLI installed: `npm install -g @turso/cli` or `brew install turso`
- [ ] Turso account created: `turso auth signup`
- [ ] GitHub repository pushed: `git push origin main`

## Step 1: Create Turso Database

```bash
# Create a new database
turso db create david-kimani-portfolio

# Show database URL
turso db show --url david-kimani-portfolio

# Create an authentication token
turso db tokens create david-kimani-portfolio
```

## Step 2: Configure Render Environment Variables

Go to your Render dashboard at https://dashboard.render.com and configure the following environment variables for your web service:

### Required Variables

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Already set in render.yaml |
| `HOST` | `0.0.0.0` | Already set in render.yaml |
| `SESSION_SECRET` | (generate) | Use `generateValue: true` in render.yaml or set manually |
| `ADMIN_PASSWORD` | Your new password | Must be 12+ chars, 72 UTF-8 bytes max |
| `TURSO_DATABASE_URL` | `libsql://david-kimani-portfolio.turso.io` | From `turso db show --url` |
| `TURSO_AUTH_TOKEN` | Your token | From `turso db tokens create` |

### Optional Variables

| Variable | Notes |
|---|---|
| `ADMIN_RECOVERY_KEY` | For password recovery (32+ chars) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated HTTPS origins |

## Step 3: Migrate Data to Turso

After configuring environment variables, run the migration:

```bash
npm run migrate:render
```

This will:
1. Initialize the Turso database schema
2. Copy all table data from local SQLite to Turso
3. Migrate portfolio JSON data
4. Migrate visitor accounts (preserving password hashes)
5. Report row counts for verification

## Step 4: Verify Deployment

After deployment, verify:
- [ ] Health check returns 200
- [ ] Admin login works
- [ ] Portfolio data displays correctly
- [ ] Visitor registration works
- [ ] Data persists across restarts

## Environment Variable Reference

### Required for Production
- `NODE_ENV=production`
- `ADMIN_PASSWORD` (12+ chars)
- `SESSION_SECRET` (32+ random chars)
- `TURSO_DATABASE_URL` (libsql://...)
- `TURSO_AUTH_TOKEN`

### Required for Development
- `NODE_ENV=development`
- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`

### Optional
- `ADMIN_RECOVERY_KEY` (32+ chars)
- `CORS_ALLOWED_ORIGINS` (comma-separated URLs)
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob only)
- `PORT` (default: 3000)
- `HOST` (default: 0.0.0.0)