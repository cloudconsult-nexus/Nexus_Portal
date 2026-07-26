import crypto from 'crypto';

// Invite/reset tokens are opaque random strings, never JWTs — the whole
// point (per migrations/006_invitations.sql's comment) is that revoking or
// resending takes effect immediately via the invitations table's `status`
// column, which a self-contained signed JWT can't support without an extra
// server-side revocation list anyway. Only the hash is stored; the raw
// token exists only in the email link.
export function generateToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
