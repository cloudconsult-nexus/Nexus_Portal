import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db/pool.js';

// Usage: node src/seedAdmin.js admin@example.com 'SomeStrongPassword123' 'Admin Name'
async function main() {
  const [, , email, password, name] = process.argv;
  if (!email || !password || !name) {
    console.error("Usage: node src/seedAdmin.js <email> <password> <name>");
    process.exit(1);
  }
  const { rows: existing } = await pool.query('SELECT id FROM people WHERE lower(email) = lower($1)', [email]);
  if (existing[0]) {
    console.log('Person already exists, skipping.');
    await pool.end();
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO people (email, password_hash, name, role, login_enabled, is_active)
     VALUES ($1, $2, $3, 'global_admin', true, true)`,
    [email, hash, name]
  );
  console.log(`Global Admin created: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
