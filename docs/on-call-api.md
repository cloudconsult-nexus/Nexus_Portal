# On-Call Lookup API

For NCC (Nextiva Contact Center) integrators. This is the one endpoint the
Portal exposes for NCC to call *into* it — during a live call/chat, to find
out who should be dispatched a message for a given Customer, right now (or
at a specified future moment).

## Endpoint

```
GET /organizations/:orgId/on-call?at=<ISO 8601 timestamp>
```

| Part | Description |
| --- | --- |
| `:orgId` | The Customer's UUID in the Portal (maps 1:1 to your campaign/queue). |
| `at` | Required. An ISO 8601 timestamp, **with an explicit UTC offset** (e.g. `2026-08-19T14:00:00Z` or `...T09:00:00-05:00`) — a bare local time without an offset is rejected. Use the current time for a live call, or a future timestamp to ask "who will be on call at date/time X." |

## Authentication

Every request must carry a static, per-Portal-instance API key:

```
X-API-Key: <your key>
```

This is issued to you out of band (not via this API) and is separate from
the human login system entirely — there's no username/password or OAuth
flow for this endpoint. If your key ever needs to be rotated, expect a
short coordinated cutover window; there's currently no overlap period where
both an old and new key work simultaneously.

## Example request

```
GET /organizations/3fa85f64-5717-4562-b3fc-2c963f66afa6/on-call?at=2026-08-19T14:00:00Z
X-API-Key: a1b2c3d4e5f6...
```

## How the lookup resolves

1. The Portal converts your `at` timestamp into the Customer's own local
   time (each Customer has a configured timezone; it defaults to UTC if
   never set).
2. It checks **every** on-call calendar/schedule the Customer has (a
   Customer can run more than one — e.g. separate queues or campaigns) and
   merges the results into one list. There is no way to ask for just one
   specific calendar via this endpoint today.
3. For each calendar, if a shift covers that exact moment, every filled
   tier on it is returned — Primary, Secondary, Tertiary, and that shift's
   own Default — not just the first match. (A shift's Default is included
   even when Primary/Secondary/Tertiary are all also filled — it is not
   only a fallback for a missing chain.)
4. If **no** shift on a calendar covers that moment at all (a full coverage
   gap, not just a partial chain), that calendar's own standing default
   contact is returned instead, tagged `default`. This means: **a calendar
   with a standing default configured never contributes zero contacts**,
   even during a total coverage gap.
5. Results from every calendar are merged into one ordered list:
   **Primary → Secondary → Tertiary → Default**, in that order across the
   whole list — Default always sorts last, even across multiple calendars.
6. The same person filling the same role via more than one calendar
   appears once. The same person filling two *different* roles (e.g.
   Primary on one calendar, Default on another) appears as two separate
   entries — that's real signal, not a duplicate to be collapsed on your
   side.
7. "Broadcast/first-accept" shifts (as opposed to ordered escalation
   shifts) are excluded entirely from this endpoint — there's no
   Primary/Secondary/Tertiary/Default distinction to tag a broadcast pool
   member with.

## Example response — full escalation chain

```
200 OK

{
  "onCall": [
    {
      "id": "8f14e45f-ceea-467e-adde-3f4685974fbc",
      "name": "Priya Primary",
      "email": "priya@example.com",
      "primary_phone": "+15555550100",
      "sms_phone": "+15555550101",
      "on_call_role": "primary"
    },
    {
      "id": "b3f8b6c2-...",
      "name": "Sam Secondary",
      "email": "sam@example.com",
      "primary_phone": "+15555550200",
      "sms_phone": "+15555550201",
      "on_call_role": "secondary"
    },
    {
      "id": "d4a1c9e0-...",
      "name": "Tara Tertiary",
      "email": "tara@example.com",
      "primary_phone": "+15555550300",
      "sms_phone": "+15555550301",
      "on_call_role": "tertiary"
    },
    {
      "id": "e5b2d0f1-...",
      "name": "Dana Default",
      "email": "dana@example.com",
      "primary_phone": "+15555550400",
      "sms_phone": "+15555550401",
      "on_call_role": "default"
    }
  ]
}
```

## Example response — coverage gap, default-only

No shift at all covers the requested moment; the calendar's standing
default contact is returned:

```
200 OK

{
  "onCall": [
    {
      "id": "e5b2d0f1-...",
      "name": "Dana Default",
      "email": "dana@example.com",
      "primary_phone": "+15555550400",
      "sms_phone": "+15555550401",
      "on_call_role": "default"
    }
  ]
}
```

## Example response — no calendars at all

Not an error — a Customer with no calendars configured yet simply returns
an empty list:

```
200 OK

{ "onCall": [] }
```

## Error responses

| Status | When | Example body |
| --- | --- | --- |
| 400 | `orgId` isn't a well-formed UUID | `{ "error": "Invalid request", "details": [...] }` |
| 400 | `at` is missing, or not a valid ISO 8601 timestamp with an explicit offset | `{ "error": "Invalid request", "details": [...] }` |
| 401 | `X-API-Key` header missing, or doesn't match | `{ "error": "Missing or invalid API key" }` |
| 404 | `orgId` is well-formed but no such Customer exists (or it's been deleted) | `{ "error": "Not found" }` |
| 500 | The Portal's own API key isn't configured on its end (a Portal-side misconfiguration, not something on your end to fix) | `{ "error": "Service authentication is not configured" }` |

A 500 here means the Portal operator needs to set their `NCC_API_KEY` — it
isn't something a retry or a different request will resolve on your side.

## Field reference

| Field | Type | Notes |
| --- | --- | --- |
| `onCall` | array | Ordered Primary → Secondary → Tertiary → Default, per "How the lookup resolves" above. Empty array (never `null`) when there's genuinely no on-call configuration to report. |
| `onCall[].id` | string (UUID) | The person's ID in the Portal. |
| `onCall[].name` | string | Display name. |
| `onCall[].email` | string | |
| `onCall[].primary_phone` | string | |
| `onCall[].sms_phone` | string | The number to use for SMS dispatch specifically — may differ from `primary_phone`. |
| `onCall[].on_call_role` | string enum | One of `primary`, `secondary`, `tertiary`, `default`. Determines dispatch order — always act on `primary` first if present, falling through the list in order. |

## What's out of scope for this endpoint

- No way to list a Customer's calendars/campaigns individually — this
  endpoint always resolves across all of a Customer's calendars at once.
  If you need per-calendar/per-DID resolution, that's a planned but
  not-yet-built refinement (recording-download-style, permission finer
  than role alone) — raise it with the Portal team if you need it sooner.
- No webhook/push side — this is a synchronous request/response lookup
  only. The Portal doesn't currently notify NCC of schedule changes.
- No write access — this endpoint is read-only; it can't be used to
  acknowledge messages, update schedules, or anything else.
