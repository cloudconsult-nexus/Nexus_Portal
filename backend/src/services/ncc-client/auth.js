import { resolveNccCredentials, recordAuthSuccess, recordAuthFailure } from './config.js';
import { NccNotConfiguredError, NccAuthError } from './errors.js';
import { nccLog } from './logger.js';

const TOKEN_ENDPOINT = 'https://login.thrio.com/provider/token-with-authorities';

// Thrio's token TTL is now confirmed (Patrick, 2026-08-24, replying on "NCC
// Messages/Customers API — what we need to finish validating the outbound
// integration"): a username/password `token-with-authorities` login is
// "good for less than 24 hours." (There's a separate tenant-level security
// token, valid 6 months, via an endpoint NOT in the Postman collection we
// have — worth adopting later to cut down on daily re-logins, but not built
// here yet since we'd need that endpoint's shape from Patrick first.)
//
// 20h — comfortably under the confirmed "<24h" ceiling — replaces the
// original 10-minute guess. Two things still follow from the uncertainty in
// exactly how far under 24h it runs:
//
//   1. The primary refresh mechanism is REACTIVE, not time-based: http.js
//      retries exactly once on a 401 by discarding the cached token and
//      re-authenticating, which is correct regardless of the exact TTL.
//   2. This value only controls a conservative PROACTIVE refresh (so a
//      long-idle process doesn't open a request with a near-guaranteed
//      401-then-retry round trip). Every real auth and every real 401 is
//      still logged with the elapsed time since issuance (see below and
//      http.js), so this can be tightened further once real numbers show
//      how close to 24h a token actually lasts.
const ASSUMED_TOKEN_TTL_MS = Number(process.env.NCC_TOKEN_ASSUMED_TTL_MS) || 20 * 60 * 60 * 1000; // 20h

// In-memory per-process cache, same tradeoff as lib/storage.js's
// SIGNED_URL_CACHE — Cloud Run instances are ephemeral/multiple, so this
// is a latency optimization only, never a correctness dependency (the
// reactive 401 retry covers correctness).
const TOKEN_CACHE = new Map(); // cacheKey -> { token, location, issuedAt }

function cacheKeyFor(cred) {
  return cred.scope === 'organization' ? `org:${cred.organizationId}` : 'tas_settings';
}

async function authenticate(cred) {
  const key = cacheKeyFor(cred);
  const basic = Buffer.from(`${cred.username}:${cred.password}`).toString('base64');
  const start = Date.now();

  let res;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}` },
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    nccLog({ event: 'auth', scope: cred.scope, organizationId: cred.organizationId, ok: false, latencyMs, error: err.message });
    await recordAuthFailure({ scope: cred.scope, organizationId: cred.organizationId, error: err.message });
    throw new NccAuthError(`Failed to reach NCC token endpoint: ${err.message}`);
  }

  const latencyMs = Date.now() - start;
  const bodyText = await res.text();

  if (!res.ok) {
    nccLog({ event: 'auth', scope: cred.scope, organizationId: cred.organizationId, ok: false, status: res.status, latencyMs });
    await recordAuthFailure({ scope: cred.scope, organizationId: cred.organizationId, error: `HTTP ${res.status}: ${bodyText.slice(0, 500)}` });
    throw new NccAuthError(`NCC authentication failed (${res.status})`, { status: res.status, body: bodyText });
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    nccLog({ event: 'auth', scope: cred.scope, organizationId: cred.organizationId, ok: false, latencyMs, error: 'non-JSON response body' });
    throw new NccAuthError('NCC token endpoint returned a non-JSON body', { body: bodyText });
  }

  const { token, location } = parsed;
  if (!token || !location) {
    nccLog({ event: 'auth', scope: cred.scope, organizationId: cred.organizationId, ok: false, latencyMs, error: 'missing token/location in response' });
    throw new NccAuthError('NCC token endpoint response is missing token or location', { body: bodyText });
  }

  const issuedAt = new Date();
  nccLog({ event: 'auth', scope: cred.scope, organizationId: cred.organizationId, ok: true, status: res.status, latencyMs, tenant: location });
  TOKEN_CACHE.set(key, { token, location, issuedAt });
  await recordAuthSuccess({
    scope: cred.scope,
    organizationId: cred.organizationId,
    locationDomain: location,
    issuedAt,
    // Recorded as our current best guess only — see ASSUMED_TOKEN_TTL_MS
    // above. Overwritten with real data once Thrio's actual behavior is
    // observed (a 401 significantly before or after this estimate).
    expiresAt: new Date(issuedAt.getTime() + ASSUMED_TOKEN_TTL_MS),
  });

  return { token, location, issuedAt };
}

// Returns { token, location, credential } — credential is the resolved
// config (carries scope/organizationId/nccCustomerId) http.js needs for
// building the request URL and for cache invalidation on 401.
export async function getValidToken(organizationId) {
  const cred = await resolveNccCredentials(organizationId);
  if (!cred) throw new NccNotConfiguredError(organizationId);

  const key = cacheKeyFor(cred);
  const cached = TOKEN_CACHE.get(key);
  if (cached && Date.now() - cached.issuedAt.getTime() < ASSUMED_TOKEN_TTL_MS) {
    return { token: cached.token, location: cached.location, credential: cred };
  }

  const fresh = await authenticate(cred);
  return { token: fresh.token, location: fresh.location, credential: cred };
}

// Test-only escape hatch — tests/nccClient.test.js reuses org/TAS-scoped
// cache keys across cases and needs a clean slate between them; nothing in
// the app itself should ever need to clear a still-potentially-valid cache.
export function resetTokenCacheForTests() {
  TOKEN_CACHE.clear();
}

// Called by http.js after a 401 on an authenticated call — discards the
// cached token (forcing the next getValidToken() to re-auth) and logs how
// long the token actually lasted, which is the real TTL data point the
// build brief asks to accumulate.
export function invalidateToken(cred) {
  const key = cacheKeyFor(cred);
  const cached = TOKEN_CACHE.get(key);
  if (cached) {
    nccLog({
      event: 'token-rejected',
      scope: cred.scope,
      organizationId: cred.organizationId,
      tenant: cached.location,
      tokenAgeMs: Date.now() - cached.issuedAt.getTime(),
    });
  }
  TOKEN_CACHE.delete(key);
}
