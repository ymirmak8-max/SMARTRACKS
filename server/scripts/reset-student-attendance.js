import pool from '../config/db.js';

const email = (process.argv[2] || 'jandeb@gmail.com').trim().toLowerCase();

try {
  const users = await pool.query(
    `SELECT id, first_name, last_name, email, role
     FROM users
     WHERE lower(email) = $1 OR (role = 'student' AND lower(first_name) = 'jandeb')
     ORDER BY email`,
    [email]
  );
  if (!users.rows.length) {
    console.log('No matching student was found.');
    process.exitCode = 1;
  } else {
    for (const user of users.rows) {
      const before = await pool.query(
        'SELECT COUNT(*)::int AS count FROM time_records WHERE student_id = $1',
        [user.id]
      );
      await pool.query('DELETE FROM time_records WHERE student_id = $1', [user.id]);
      await pool.query(
        'UPDATE student_locations SET is_clocked_in = false, updated_at = NOW() WHERE student_id = $1',
        [user.id]
      );
      await pool.query(
        'DELETE FROM attendance_challenges WHERE student_id = $1',
        [user.id]
      );
      console.log(`Cleared ${before.rows[0].count} time record(s) for ${user.first_name} ${user.last_name}.`);
    }
  }
} catch (error) {
  console.error('Could not clear attendance records:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
