# Smartrack production checklist

## Required before first deployment

- Finish local testing (`server` on port 5000, `client` on port 5173) and confirm `/api/health` returns `database: "connected"`.
- Create a Vercel project from this GitHub repository. Leave Root Directory at the repository root.
- Enter a unique `BOOTSTRAP_ADMIN_EMAIL` and a randomly generated `BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters.
- Create a dedicated Supabase project and a **private** Storage bucket named `trackpoint-files`. Smartrack serves objects through signed application URLs. The live bucket name stays `trackpoint-files` unless you create and switch to a new bucket.
- Run every file in `server/sql/` in the Supabase SQL Editor, including `app_query_rpc.sql`.
- Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in Vercel. Never expose the service-role key to the browser or commit it to Git.
- Set `JWT_SECRET` (32+ characters), `FRONTEND_URL` to the Vercel URL, `CRON_SECRET`, and `VITE_API_URL=/api`.
- Configure a verified Resend sender domain, `RESEND_API_KEY`, and `EMAIL_FROM`.
- After the first successful administrator login, remove `BOOTSTRAP_ADMIN_PASSWORD` from Vercel.

## Release acceptance test

Test on both Android and iPhone over cellular data:

1. Register a student and confirm login is blocked while pending.
2. Approve the student and confirm the approval email arrives.
3. Sign in, allow camera and precise location, then time in and time out.
4. Upload JPG, PNG, PDF, DOC, and DOCX evidence; confirm oversized and invalid files are rejected.
5. Review a document and an attendance exception as coordinator.
6. Generate analytics, forecast charts, and a PDF report.
7. Deny camera/location permission and confirm Smartrack shows recovery instructions.
8. Test password reset from the email link.

## Backups and recovery

- Enable Supabase backups and verify their retention in the Supabase dashboard.
- Before every database-changing release, create an on-demand backup.
- Once per month, restore the newest backup into a separate test project and run `/api/health` plus the acceptance test.
- Never test a restore against the production database.

## Routine deployment

Push changes to `main`. GitHub Actions runs server tests, syntax checks, client lint, and the production build. Vercel deploys from the same repository. Confirm `/api/health` and complete a short mobile attendance smoke test after each release.
