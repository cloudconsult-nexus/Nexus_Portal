import crypto from 'crypto';

// Auth for NCC (Nextiva Contact Center, built on Thrio) calling *into*
// this Portal — the inverse of every other integration in this codebase,
// which all call *out*. There's no person behind this call, so it doesn't
// go through middleware/auth.js's requireAuth (JWT → people row lookup) —
// a static pre-shared key instead, same `Authorization: Bearer <token>`
// header shape as human auth, verified against NCC_API_KEY (Secret
// Manager-backed, see infra/secrets.tf) with a constant-time compare so a
// mismatch can't be timed to guess the key byte-by-byte.
//
// See CLAUDE.md's "Target spec" section — this was explicitly still
// undecided there ("leaning token/API-key or OAuth2 client-credentials");
// this implements the API-key option, confirmed with the client
// 2026-08-11 as sufficient for a single known external caller.
export function requireNccAuth(req, res, next) {
  const expected = process.env.NCC_API_KEY;
  if (!expected) {
    // Not configured for this environment at all — a clear 501, not a
    // 401 that looks like "your key is wrong" when actually no key was
    // ever set up.
    return res.status(501).json({ error: 'NCC integration is not configured for this environment' });
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  // timingSafeEqual throws if the buffers differ in length, rather than
  // returning false — a wrong-length token is just as invalid as a
  // wrong-content one, so treat that the same as a mismatch.
  const matches = expectedBuf.length === tokenBuf.length && crypto.timingSafeEqual(expectedBuf, tokenBuf);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  next();
}
