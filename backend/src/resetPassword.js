import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db/pool.js';

// Companion to seedAdmin.js — that script only creates a Global Admin and
// silently skips if the email already exists, so it's no help for "I
// forgot my password" once an account is already there. Useful whenever
// the forgot-password flow can't be used either — e.g. SMTP isn't
// configured for an environment yet (RUNBOOK.md's "Email not sending"),
// so reset links only reach Cloud Logging, not an inbox.
//
// Usage: node src/resetPassword.js <email> 'NewStrongPassword123'
//
// Also clears failed_login_attempts/locked_until (migrations/
// 004_onboarding_and_coverage_type.sql's account-lockout columns) so a
// reset always results in an account that can actually log in, not one
// still locked out from whatever attempts preceded this.
async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("Usage: node src/resetPassword.js <email> <newPassword>");
    process.exit(1);
  }
  const { rows } = await pool.query('SELECT id, role FROM people WHERE lower(email) = lower($1)', [email]);
  const person = rows[0];
  if (!person) {
    console.error(`No person found with email ${email}`);
    await pool.end();
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE people SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2`,
    [hash, person.id]
  );
  console.log(`Password reset for ${email} (role: ${person.role}). Any prior lockout was cleared.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
