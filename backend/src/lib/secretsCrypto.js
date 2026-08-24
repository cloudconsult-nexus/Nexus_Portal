import crypto from 'crypto';

// Encrypt-at-rest helper for secrets that have to live in Postgres rows
// rather than an env var/Secret Manager entry — currently just NCC's
// per-Customer/per-TAS Thrio credentials (migrations/018_ncc_integration.sql),
// which are dynamic and admin-settable at runtime, unlike JWT_SECRET/
// NCC_API_KEY/SMTP_* which are fixed at deploy time. AES-256-GCM: the auth
// tag makes a tampered ciphertext fail to decrypt rather than silently
// returning garbage.
//
// NCC_CREDENTIALS_ENCRYPTION_KEY is its own dedicated secret, deliberately
// not derived from JWT_SECRET — same reasoning as REPORT_SSO_FALLBACK_SECRET
// being kept separate from JWT_SECRET (.env.example): rotating one must
// never force-rotate the other. Generate with: openssl rand -base64 32.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended nonce size for GCM
const KEY_LENGTH = 32; // AES-256

function loadKey() {
  const raw = process.env.NCC_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    // Fail closed, matching middleware/serviceAuth.js's requireApiKey
    // philosophy: an unset key must never fall back to "store/read as
    // plaintext" in any environment, including a misconfigured one.
    throw new Error('NCC_CREDENTIALS_ENCRYPTION_KEY is not configured — refusing to encrypt/decrypt secrets');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`NCC_CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}) — generate with: openssl rand -base64 32`);
  }
  return key;
}

// Returns a single self-contained base64 string: iv || authTag || ciphertext.
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret requires a non-empty string');
  }
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('decryptSecret requires a non-empty string');
  }
  const key = loadKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buf.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
