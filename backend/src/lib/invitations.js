import pool from '../db/pool.js';
import { generateToken, hashToken } from './inviteToken.js';
import { sendEmail } from './email.js';
import { inviteEmail } from './emailTemplates.js';
import { getProductName } from './branding.js';

const EXPIRY_DAYS = Number(process.env.INVITE_EXPIRY_DAYS || 7);

// CORS_ORIGIN doubles as "the real web URL" here rather than a second env
// var, since it's already required to be the actual deployed frontend
// origin for CORS to work at all (see scripts/deploy.sh).
function webOrigin() {
  return (process.env.CORS_ORIGIN || '').split(',')[0];
}

export async function createInvitation({ personId, organizationId, email, name, role, invitedById }) {
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO invitations (person_id, organization_id, email, name, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [personId, organizationId, email, name, role, tokenHash, invitedById, expiresAt]
  );

  const [{ rows: orgRows }, productName] = await Promise.all([
    pool.query('SELECT name FROM organizations WHERE id = $1', [organizationId]),
    getProductName(),
  ]);

  const acceptUrl = `${webOrigin()}/accept-invite?token=${token}`;
  const { subject, html } = inviteEmail({ name, acceptUrl, orgName: orgRows[0]?.name || null, productName });
  await sendEmail({ to: email, subject, html, fromName: productName });

  return { expiresAt };
}

export async function findValidInvitation(token) {
  const { rows } = await pool.query(
    `SELECT * FROM invitations
     WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

export async function markAccepted(invitationId) {
  await pool.query(`UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = $1`, [invitationId]);
}

export async function revokeInvitation(invitationId) {
  await pool.query(`UPDATE invitations SET status = 'revoked' WHERE id = $1`, [invitationId]);
}
