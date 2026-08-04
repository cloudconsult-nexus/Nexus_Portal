// Client for NCC's underlying platform (Thrio) — see RUNBOOK.md's "NCC
// Integration" section. Built against Thrio's public Postman docs
// (api.thrio.com), NOT yet verified against a live tenant — no credentials
// were available while scaffolding this. Treat response field names as
// best-effort until confirmed against a real account.
//
// TODO(NCC integration): THRIO_USERNAME/THRIO_PASSWORD aren't wired up
// anywhere yet — no .env entry, no Secret Manager entry, no Terraform. Add
// those once real credentials exist for this tenant.

// Docs example shows this shape (Search Workitems Result, 200):
//   { count, total, previous, next, summary: {...}, objects: [ { ... } ] }
// Auth: GET https://login.thrio.com/provider/token-with-authorities
// (Basic auth) -> { location, token }. `location` is the actual per-tenant
// cluster domain — every other call goes to `${location}/...` with `token`
// as the Authorization header. Token TTL isn't documented; this refetches
// on any 401 rather than trying to track an expiry.
let cached = null;

async function fetchToken() {
  const username = process.env.THRIO_USERNAME;
  const password = process.env.THRIO_PASSWORD;
  if (!username || !password) return null;

  const res = await fetch('https://login.thrio.com/provider/token-with-authorities', {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Thrio authentication failed: ${res.status}`);
  const { location, token } = await res.json();
  cached = { location, token };
  return cached;
}

async function thrioFetch(path, { retry = true } = {}) {
  const creds = cached || (await fetchToken());
  if (!creds) return null; // not configured

  const res = await fetch(`${creds.location}${path}`, {
    headers: { Authorization: creds.token },
  });
  if (res.status === 401 && retry) {
    cached = null;
    return thrioFetch(path, { retry: false });
  }
  if (!res.ok) throw new Error(`Thrio API call failed: ${res.status} ${path}`);
  return res.json();
}

// Normalizes a raw Thrio workitem into the shape the frontend renders —
// isolates the rest of the app from Thrio's field names, which we've only
// seen in docs, not live data (e.g. it's unconfirmed whether an SMS-type
// workitem's text lives in `chatMessages`, `data`, or somewhere else this
// example didn't show).
function normalizeWorkitem(w) {
  return {
    id: w.workitemId || w._id,
    from: w.from || null,
    to: w.to || null,
    channel: w.channelType || null,
    type: w.type || null,
    createdAt: w.createdAt ? new Date(w.createdAt).toISOString() : null,
    preview: w.chatMessages?.[0]?.text || null,
    raw: w,
  };
}

// rangeType matches Thrio's own query vocabulary (e.g. "today", "last30days")
// rather than arbitrary start/end dates — see Search Callbacks/Workitems in
// the docs, both of which take the same param.
export async function searchMessages({ rangeType = 'last30days', query = '*' } = {}) {
  const data = await thrioFetch(
    `/analytics/api/v1/types/workitems/history?rangeType=${encodeURIComponent(rangeType)}&q=${encodeURIComponent(query)}&workitemType=SMS`
  );
  if (!data) return null; // not configured
  return (data.objects || []).map(normalizeWorkitem);
}

export function isConfigured() {
  return !!(process.env.THRIO_USERNAME && process.env.THRIO_PASSWORD);
}
