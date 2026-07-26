import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import pool from '../db/pool.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { auditContext } from '../middleware/audit.js';
import { generateSecret, generateOtpAuthUrl, verifyToken as verifyTotp } from '../lib/totp.js';
import { generateToken, hashToken } from '../lib/inviteToken.js';
import { findValidInvitation, markAccepted } from '../lib/invitations.js';
import { sendEmail } from '../lib/email.js';
import { passwordResetEmail } from '../lib/emailTemplates.js';
import jwt from 'jsonwebtoken';

const router = Router();
router.use(auditContext);

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaToken: z.string().optional(),
});

router.post('/login', async (req, res) => {
  const { email, password, mfaToken } = loginSchema.parse(req.body);

  const { rows } = await pool.query(
    `SELECT * FROM people WHERE lower(email) = lower($1) AND login_enabled = true AND is_deleted = false`,
    [email]
  );
  const person = rows[0];

  // Deliberately identical error for "no such account" and "wrong password"
  // — don't let login responses enumerate valid emails.
  const invalidCredentials = () => res.status(401).json({ error: 'Invalid email or password' });

  if (!person) return invalidCredentials();

  if (person.locked_until && new Date(person.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Account temporarily locked due to failed login attempts' });
  }

  if (!person.is_active) return res.status(403).json({ error: 'Account is deactivated' });

  const validPassword = person.password_hash && (await bcrypt.compare(password, person.password_hash));
  if (!validPassword) {
    const attempts = person.failed_login_attempts + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
    await pool.query('UPDATE people SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3', [
      attempts,
      lockedUntil,
      person.id,
    ]);
    return invalidCredentials();
  }

  if (person.mfa_enabled) {
    if (!mfaToken) return res.status(401).json({ error: 'MFA token required', mfaRequired: true });
    if (!verifyTotp(person.mfa_secret, mfaToken)) {
      return res.status(401).json({ error: 'Invalid MFA token' });
    }
  }

  await pool.query(
    'UPDATE people SET failed_login_attempts = 0, locked_until = NULL, last_active_at = now() WHERE id = $1',
    [person.id]
  );

  await req.logAudit({
    userId: person.id,
    userEmail: person.email,
    action: 'login',
    entityType: 'person',
    entityId: person.id,
    organizationId: person.organization_id,
  });

  const token = signToken(person);
  res.json({
    token,
    user: {
      id: person.id,
      email: person.email,
      name: person.name,
      role: person.role,
      organizationId: person.organization_id,
      canEditSchedule: person.can_edit_schedule,
      termsAcceptedAt: person.terms_accepted_at,
    },
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  await req.logAudit({ action: 'logout', entityType: 'person', entityId: req.user.id });
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

router.post('/accept-invite', async (req, res) => {
  const schema = z.object({ token: z.string(), password: z.string().min(8) });
  const { token, password } = schema.parse(req.body);

  const invitation = await findValidInvitation(token);
  if (!invitation) return res.status(400).json({ error: 'Invalid or expired invitation' });

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE people SET password_hash = $1, login_enabled = true, is_active = true, role = $2 WHERE id = $3`,
    [passwordHash, invitation.role, invitation.person_id]
  );
  await markAccepted(invitation.id);

  res.status(204).end();
});

router.post('/accept-terms', requireAuth, async (req, res) => {
  await pool.query('UPDATE people SET terms_accepted_at = now() WHERE id = $1', [req.user.id]);
  res.status(204).end();
});

router.post('/forgot-password', async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const { rows } = await pool.query(
    'SELECT id, name, email FROM people WHERE lower(email) = lower($1) AND login_enabled = true',
    [email]
  );
  const person = rows[0];

  // Always 204, regardless of whether the account exists — same
  // no-enumeration reasoning as login.
  if (person) {
    const resetToken = jwt.sign({ sub: person.id, type: 'password_reset' }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    const resetUrl = `${(process.env.CORS_ORIGIN || '').split(',')[0]}/reset-password?token=${resetToken}`;
    const { subject, html } = passwordResetEmail({ name: person.name, resetUrl });
    await sendEmail({ to: person.email, subject, html });
  }
  res.status(204).end();
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }
  if (payload.type !== 'password_reset') return res.status(400).json({ error: 'Invalid token' });

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query('UPDATE people SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2', [
    passwordHash,
    payload.sub,
  ]);
  res.status(204).end();
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
    .parse(req.body);

  const { rows } = await pool.query('SELECT password_hash FROM people WHERE id = $1', [req.user.id]);
  const person = rows[0];
  const validPassword = person?.password_hash && (await bcrypt.compare(currentPassword, person.password_hash));
  if (!validPassword) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE people SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, req.user.id]);

  await req.logAudit({ action: 'update', entityType: 'person', entityId: req.user.id, entityName: req.user.name, newValues: { passwordChanged: true } });
  res.status(204).end();
});

router.post('/mfa/enroll', requireAuth, async (req, res) => {
  const secret = generateSecret();
  await pool.query('UPDATE people SET mfa_secret = $1 WHERE id = $2', [secret, req.user.id]);
  res.json({ otpAuthUrl: generateOtpAuthUrl(secret, req.user.email) });
});

router.post('/mfa/verify', requireAuth, async (req, res) => {
  const { token } = z.object({ token: z.string() }).parse(req.body);
  const { rows } = await pool.query('SELECT mfa_secret FROM people WHERE id = $1', [req.user.id]);
  const secret = rows[0]?.mfa_secret;
  if (!secret || !verifyTotp(secret, token)) {
    return res.status(400).json({ error: 'Invalid MFA token' });
  }
  await pool.query('UPDATE people SET mfa_enabled = true WHERE id = $1', [req.user.id]);
  res.status(204).end();
});

export default router;
