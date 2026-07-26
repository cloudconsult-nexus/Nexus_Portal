import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';

// Verifies the Bearer JWT and attaches the current Person to req.user.
// Re-checks is_active/is_deleted on every request (not just at token-issue
// time) so a deactivated/deleted account is locked out immediately, not
// just once its existing token happens to expire.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { rows } = await pool.query(
    `SELECT id, email, name, role, organization_id, is_active, is_deleted, mfa_enabled, can_edit_schedule
     FROM people WHERE id = $1`,
    [payload.sub]
  );
  const person = rows[0];
  if (!person || !person.is_active || person.is_deleted) {
    return res.status(401).json({ error: 'Account is no longer active' });
  }

  req.user = {
    id: person.id,
    email: person.email,
    name: person.name,
    role: person.role,
    organizationId: person.organization_id,
    mfaEnabled: person.mfa_enabled,
    canEditSchedule: person.can_edit_schedule,
  };
  next();
}

export function signToken(person) {
  return jwt.sign({ sub: person.id, role: person.role }, process.env.JWT_SECRET, {
    expiresIn: '12h',
  });
}
