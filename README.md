# Smartrack OJT Monitoring

## Local development

Run API and client in two terminals. The Vite dev server proxies `/api` to `http://localhost:5000`.

```bash
cd server
npm ci
npm run migrate
npm run dev
```

```bash
cd client
npm ci
npm run dev
```

Open `http://localhost:5173`. Before `npm run migrate` and `npm run dev`, run `server/sql/app_query_rpc.sql` once in the Supabase SQL Editor.

Complete [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) before opening the system to students.

## Production deployment (Vercel)

After local testing, import this GitHub repository in Vercel. Keep **Root Directory** empty (repository root), not `client`. Vercel builds the Vite app and serves Express from `api/index.js` on the same origin (`/api`).

### Required environment variables

Set these in the Vercel project (Production and Preview). `VITE_*` values are baked in at build time.

```env
NODE_ENV=production
TRUST_PROXY=true
COOKIE_SAME_SITE=lax
FRONTEND_URL=https://your-app.vercel.app
APP_TIMEZONE=Asia/Manila
JWT_SECRET=generate-at-least-32-random-characters
JWT_EXPIRES_IN=15m
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=trackpoint-files
VITE_API_URL=/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=
CRON_SECRET=generate-a-long-random-secret
```

Optional:

```env
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
RESEND_API_KEY=
EMAIL_FROM=Smartrack <no-reply@your-domain.example>
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@your-domain.example
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in `VITE_*` variables. After the first successful administrator login, remove `BOOTSTRAP_ADMIN_PASSWORD`.

Without Anthropic, analytics return a deterministic summary. Without Resend, password-reset email delivery is unavailable.

Vercel has no always-on Node process. Notifications created during a request are drained in that request. Daily cron (`/api/cron/workers`, 10:00 UTC) retries the outbox and runs scheduled reports plus attendance-image retention. On a Pro plan you can change that schedule to every minute in `vercel.json`.

Deploy behind HTTPS. Mobile browsers require it for camera, GPS, secure cookies, and PWA install. Confirm `/api/health` after each release.

### Final release check

```bash
cd client && npm run lint && npm run build
cd ../server && npm test
```
