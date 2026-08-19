import crypto from 'crypto';

// Machine-to-machine auth for inbound integrations that aren't a human
// session — currently just NCC's on-call lookup (routes/onCall.js,
// CLAUDE.md Phase 5.4). Deliberately separate from middleware/auth.js's
// requireAuth (human JWT bearer tokens): there is no Person record behind
// this caller, and rotating/revoking this key must never touch human
// logins or vice versa.
//
// One static key per deployed TAS instance (env var, Secret Manager on
// Cloud Run — see .env.example), matching the "one Portal = one TAS"
// singleton model (CLAUDE.md): there's exactly one caller (NCC) per
// instance, so a full OAuth2 client-credentials flow (token issuance,
// expiry/refresh, client registry) is more machinery than a single known
// caller needs. Revisit if NCC's side requires that flow instead.
export function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'];
  const expected = process.env.NCC_API_KEY;

  if (!expected) {
    // Fail closed: an unset key must never fall back to "no auth
    // required", in any environment, including a misconfigured one.
    console.error('NCC_API_KEY is not configured — refusing all service-authenticated requests');
    return res.status(500).json({ error: 'Service authentication is not configured' });
  }
  if (typeof provided !== 'string' || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }
  next();
}

// Constant-time comparison so a byte-by-byte mismatch can't be timed to
// guess the key.
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
