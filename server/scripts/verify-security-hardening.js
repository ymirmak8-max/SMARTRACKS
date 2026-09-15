import pool from '../config/db.js';

try {
  const [column, table, trigger, leftoverAdmins] = await Promise.all([
    pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='token_version') AS token_version"),
    pool.query("SELECT to_regclass('public.attendance_challenges') IS NOT NULL AS attendance_challenges"),
    pool.query("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='revoke_user_sessions_security_change' AND NOT tgisinternal) AS revocation_trigger"),
    pool.query("SELECT COUNT(*)::int AS leftover_admins FROM users WHERE role='admin'"),
  ]);
  const checks = {
    tokenVersion: column.rows[0].token_version,
    attendanceChallenges: table.rows[0].attendance_challenges,
    revocationTrigger: trigger.rows[0].revocation_trigger,
    leftoverAdmins: leftoverAdmins.rows[0].leftover_admins,
  };
  if (!checks.tokenVersion || !checks.attendanceChallenges || !checks.revocationTrigger)
    throw new Error(`Security-hardening verification failed: ${JSON.stringify(checks)}`);
  console.log(JSON.stringify(checks));
} finally {
  await pool.end();
}
