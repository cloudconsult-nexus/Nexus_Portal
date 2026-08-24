import { getValidToken, invalidateToken } from './auth.js';
import { NccApiError } from './errors.js';
import { nccLog } from './logger.js';

function buildUrl(location, path, query) {
  const url = new URL(path, `https://${location}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function send({ token, location, method, path, query, body }) {
  const start = Date.now();
  const res = await fetch(buildUrl(location, path, query), {
    method,
    headers: {
      // Deliberately NOT "Bearer <token>" — the Postman collection sends
      // the raw token as the Authorization header value, and Thrio's API
      // is matched exactly rather than assumed to follow the OAuth2
      // convention (build brief: "match the collection exactly").
      Authorization: token,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const latencyMs = Date.now() - start;
  const bodyText = await res.text();
  return { res, bodyText, latencyMs };
}

function parseBody(bodyText) {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText; // non-JSON response — hand it back raw rather than swallowing it
  }
}

// The one entrypoint every operation in messages.js/customers.js goes
// through — auth (with cache), the actual HTTP call, structured logging,
// and the single 401-triggered re-auth-and-retry all live here so no
// individual operation has to reimplement them (build brief: "Don't
// scatter raw HTTP calls through the app").
export async function nccRequest(organizationId, { method, path, query, body }) {
  let { token, location, credential } = await getValidToken(organizationId);

  let { res, bodyText, latencyMs } = await send({ token, location, method, path, query, body });

  if (res.status === 401) {
    // Reactive refresh — see auth.js's comment on why this, not a
    // time-based scheme, is the correctness-bearing mechanism. Exactly one
    // retry: a second 401 means the credentials themselves are bad, not
    // that the token merely expired, and retrying further would just loop.
    invalidateToken(credential);
    ({ token, location, credential } = await getValidToken(organizationId));
    ({ res, bodyText, latencyMs } = await send({ token, location, method, path, query, body }));
  }

  nccLog({
    event: 'request',
    organizationId,
    scope: credential.scope,
    tenant: location,
    method,
    path,
    status: res.status,
    latencyMs,
  });

  if (!res.ok) {
    throw new NccApiError(`NCC request failed: ${method} ${path} (${res.status})`, {
      status: res.status,
      body: parseBody(bodyText),
      method,
      path,
    });
  }

  return parseBody(bodyText);
}
