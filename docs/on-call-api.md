# On-Call Lookup API

For NCC (Nextiva Contact Center) to resolve who is on call for a Customer
at a given moment, during a live inbound call or chat.

## Base URL

| Environment | Base URL |
|---|---|
| Test | `https://api.test.cloudconsult.technology` |
| Production | `https://api.portal.cloudconsult.technology` |

All paths below are relative to one of these.

## Authentication

Every request must include:

```
Authorization: Bearer <API_KEY>
```

The key is a shared secret issued out-of-band (not something you obtain
through this API) — it identifies NCC as a caller, not an individual user.
There is no token expiry or refresh; treat it like a password and rotate it
by requesting a new one if it's ever exposed.

## Endpoint

```
GET /ncc/organizations/{organizationId}/on-call?at={timestamp}
```

### Path parameter

| Name | Type | Required | Description |
|---|---|---|---|
| `organizationId` | UUID | Yes | The Nexus Portal organization ("Customer") to look up — this is what your campaign should be mapped to 1:1. |

### Query parameter

| Name | Type | Required | Description |
|---|---|---|---|
| `at` | ISO 8601 timestamp | Yes | The moment to resolve on-call for. Use the current time for a live call, or a future timestamp to check coverage ahead of time. Must include a timezone offset or `Z` for UTC — e.g. `2026-08-15T14:30:00Z`. |

## How on-call resolution works

1. **The timestamp is converted to the Portal's local time.** The Portal
   stores schedules as local wall-clock date/time, not UTC — internally it
   converts your `at` timestamp into "what date and time is this, in the
   Portal's configured timezone" before matching it against any schedule.
   You don't need to do this conversion yourself; just send a real,
   unambiguous timestamp (UTC recommended) and the Portal handles the rest.

2. **Every calendar the organization has is checked**, not just one. An
   organization can have more than one calendar (e.g. a main line and a
   separate after-hours line). If more than one is staffed at the
   requested moment, you'll get tiers back from all of them, merged into
   one list.

3. **Each on-call person is tagged with their role in that shift:**
   `primary`, `secondary`, `tertiary`, or `default`. Order in the response
   is always primary → secondary → tertiary → default.

4. **`primary` and `default` are always both present together** whenever
   anything is on-call for that moment — a shift can't be scheduled
   without both of those set. `secondary` and `tertiary` are optional and
   only appear if that specific shift has them configured. In other
   words: if there's no secondary/tertiary escalation configured for that
   slot, you still always get back a `primary` and a `default` contact —
   the default is never silently missing when a shift exists.

5. **If nothing is scheduled at all for that moment** (no shift covers
   that date/time on any of the organization's calendars, or the
   organization has no calendars configured), the response is still a
   normal `200` — an empty `onCall` list with `"coverageGap": true`. This
   is not an error condition; it means there is genuinely no one
   configured to be on call at that instant, and your workflow should
   handle it accordingly (e.g. fall back to a general voicemail/queue).

## Example request

```bash
curl -s "https://api.test.cloudconsult.technology/ncc/organizations/3f2504e0-4f89-11d3-9a0c-0305e82c3301/on-call?at=2026-08-15T14:30:00Z" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Example responses

### Multiple people on call

```json
{
  "organizationId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "at": "2026-08-15T14:30:00Z",
  "onCall": [
    {
      "role": "primary",
      "name": "Jordan Reyes",
      "email": "jordan.reyes@example.com",
      "primary_phone": "555-0101",
      "sms_phone": "555-0102"
    },
    {
      "role": "secondary",
      "name": "Casey Nguyen",
      "email": "casey.nguyen@example.com",
      "primary_phone": "555-0201",
      "sms_phone": "555-0202"
    },
    {
      "role": "default",
      "name": "On-Call Desk",
      "email": "oncall-desk@example.com",
      "primary_phone": "555-0900",
      "sms_phone": "555-0901"
    }
  ]
}
```

### Default-only (no secondary/tertiary configured for this shift)

```json
{
  "organizationId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "at": "2026-08-15T14:30:00Z",
  "onCall": [
    {
      "role": "primary",
      "name": "Jordan Reyes",
      "email": "jordan.reyes@example.com",
      "primary_phone": "555-0101",
      "sms_phone": "555-0102"
    },
    {
      "role": "default",
      "name": "On-Call Desk",
      "email": "oncall-desk@example.com",
      "primary_phone": "555-0900",
      "sms_phone": "555-0901"
    }
  ]
}
```

### Coverage gap (nothing scheduled at this moment)

```json
{
  "organizationId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "at": "2026-08-15T14:30:00Z",
  "onCall": [],
  "coverageGap": true
}
```

## Error responses

| Status | When | Example body |
|---|---|---|
| `400` | `at` is missing | `{"error":"Invalid request","details":[{"path":"at","message":"Required"}]}` |
| `400` | `at` isn't a real, parseable timestamp | `{"error":"Invalid request","details":[{"path":"at","message":"Invalid timestamp"}]}` |
| `400` | `organizationId` isn't a valid UUID at all | `{"error":"Invalid request","details":[{"path":"id","message":"Invalid uuid"}]}` |
| `401` | `Authorization` header missing or not `Bearer <token>` | `{"error":"Missing or invalid Authorization header"}` |
| `401` | The bearer token doesn't match the configured key | `{"error":"Invalid credentials"}` |
| `404` | `organizationId` is a valid UUID but no such organization exists (or it's been deleted) | `{"error":"Organization not found"}` |
| `501` | This environment hasn't had an API key configured yet (setup-in-progress state, not something a correctly configured integration should ever see) | `{"error":"NCC integration is not configured for this environment"}` |

Note: a malformed `organizationId` (not a valid UUID shape) is a `400`;
a well-formed UUID that doesn't correspond to a real organization is a
`404`. Check which one you're getting if you're debugging an unexpected
error — they mean different things.

## Field reference

### Top-level response fields

| Field | Type | Always present? | Description |
|---|---|---|---|
| `organizationId` | string (UUID) | Yes | Echoes the organization you queried. |
| `at` | string (ISO 8601) | Yes | Echoes the timestamp you queried. |
| `onCall` | array | Yes | List of on-call people for that moment, tagged by role. Empty if nothing is scheduled. |
| `coverageGap` | boolean | Only when `true` | Present and `true` only when `onCall` is empty because nothing is scheduled. Omitted entirely (not `false`) when there is coverage. |

### Fields within each `onCall` entry

| Field | Type | Description |
|---|---|---|
| `role` | string | One of `primary`, `secondary`, `tertiary`, `default`. |
| `name` | string | Contact's full name. |
| `email` | string or `null` | Contact's email address. |
| `primary_phone` | string or `null` | Contact's primary phone number. |
| `sms_phone` | string or `null` | Contact's SMS-capable phone number — use this one for text dispatch. |
