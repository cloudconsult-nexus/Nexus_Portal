# OnCall Pro / Nexus Portal — Project Context

## What this is
OnCall Pro is an on-call scheduling application, built as a module inside a broader
"Nexus Portal" shell (Dashboard, Organizations, Users, Customer Messages, Secure
Messaging, Reports, Status Alerts). OnCall Pro itself owns Calendars, Schedules,
Shift Swaps, and OnCall Reports within that shell.

Originally built from an "OnCall Pro Administrator Guide" spec with no prior source
code, then taken through a 4-phase v2 refactor (see "Build history" below).

**Current direction (confirmed with the client, 2026-07-25): this application is
evolving into the "TAS Client Portal"** — a white-labeled portal for Telephone
Answering Service (TAS) organizations, integrating with Nextiva Contact Center
(NCC, built on Thrio, api.thrio.com). This is the next stage of *this same app*,
not a separate product — see "Target spec: TAS Client Portal" below for the
concrete deltas between what exists today and where this is headed.
**Phase 5.1 (hierarchy/role flattening) is done as of 2026-07-26** — see Domain
model below and the Build history entry; don't architect new features against
the old 5-level hierarchy this section used to describe.

## Stack
- **API:** Node.js / Express
- **Web:** React + Vite + Tailwind
- **DB:** PostgreSQL on Cloud SQL
- **Deploy:** Two Cloud Run services (`api`, `web`), Terraform for IaC, Cloud Build for CI/CD
- **Design tokens:** Ink navy `#1B2333`, Signal Amber `#F5A623` accent; Inter (body) / IBM Plex Mono (code/data)

## Domain model
Flat **TAS instance → Customer** model (Phase 5.1, 2026-07-26): one deployed
Portal is one TAS (singleton `tas_settings` row), and every `organizations` row
is a standalone Customer with equal standing — no fixed hierarchy levels, no
Master Org/Main Account/Sub Account/Provider/Department node types (all
dropped, `migrations/013_tas_customer_model.sql`). Contacts/schedules were
originally siloed per Customer with no exceptions — see the subtree-scoping
note just below for the deliberate exception added afterward.

**Optional Customer nesting reintroduced (2026-07-26, `migrations/
014_organization_hierarchy.sql`), at the client's explicit request** —
`organizations.parent_id`, nullable, any Customer can optionally nest under
any other (no fixed levels/types, unlike the old hierarchy). Originally
display-only on the Customers page (indent + expand/collapse).

**RBAC scope subsequently expanded to match the nesting (2026-07-26,
`backend/src/lib/orgScope.js`)** — also the client's explicit request, and
also a deliberate exception to the spec's siloing language below: a Customer
Admin/User's data access is **their own Customer + every descendant** in the
`parent_id` tree (organizations, people, calendars, schedules/assignments),
not just their own single row. `resolveScopedOrgIds()` is the one shared
helper computing this everywhere — always use it for any new
organization-scoped route rather than a fresh `req.user.organizationId`
equality check. Global Admin also gets an optional "view as" filter (same
helper, `?organizationId=` query/body param) on top of their already-full
access — not a privilege change for Global Admin, just a UI convenience.
Don't read either of these as a reversion to the old rigid hierarchy model
(no fixed levels/types were reintroduced) — just don't further widen RBAC
scope (e.g. cross-tenant) without asking.

Users and People are consolidated into a single **Person + RBAC** model.
Roles: Global Admin, Customer Admin, User (3 tiers, down from the old 5 —
`can_edit_schedule` is a per-person capability grant, not a role tier).

Branding/white-labeling falls back 2 levels: Customer → TAS-wide `tas_settings`
(not an arbitrary-depth ancestor walk, since there's no fixed hierarchy to
walk — the optional `parent_id` nesting above doesn't participate in branding
inheritance).

## Build history (phases, in order)
1. **Phase 1 — Users+People consolidation & RBAC.** Unified Person model, role system.
2. **Phase 2 — Hierarchy refactor.** Generic tree incl. Department node type, full
   CRUD/move/soft-delete, validation, breadcrumb/summary APIs.
3. **Phase 3 — Scheduling engine.** Clickable/editable shifts (incl. delete),
   Day/Week/Month views, 24hr/30min Day grid, cross-calendar conflict warnings for
   multi-org providers, dashboard alerts (coverage gaps, unassigned shifts,
   conflicted users, missing escalation chains).
4. **Phase 4 — Nexus Portal nav restructure.** Grouped OnCall Pro nav section,
   Customer Messages/Secure Messaging/Status Alerts scaffolding (nav + permissions
   only, not real integrations), split Nexus vs OnCall Pro reports, forgot/reset
   password, account lockout, self-service TOTP MFA enrollment, terms acceptance on
   invite, Calendar hierarchy picker + coverage type, multi-org provider linking UI.

Terraform / Cloud Build / deploy scripts have been stable since Phase 1 — no infra
changes across phases 2-4.

5. **Phase 5 — TAS Client Portal alignment.** Confirmed as this application's
   next stage. See "Target spec" below for full scope; broken into sub-phases
   rather than attempted all at once.
   - **5.1 — Hierarchy & role flattening (done, 2026-07-26).** 5-level generic
     tree → flat TAS/Customer model; 5 roles → 3. See Domain model above.
     Includes the git/CI-CD migration (GitHub + Cloud Build), the multi-tenant
     onboarding runbook, and the signed-URL fix for logo/photo storage —
     all done the same day. Optional Customer `parent_id` nesting (display
     only) added afterward at the client's request — see Domain model.
   - **5.4 (NCC/Thrio integration) is split across two directions — both now
     partially built, 2026-08-24:**
     - *Inbound* (NCC calling into the Portal): the on-call-lookup endpoint
       (`GET /organizations/:orgId/on-call`, `routes/onCall.js`,
       `migrations/017_ncc_oncall_lookup.sql`) — done, service-API-key
       auth, since extended to also accept a human session (see "What
       already lines up well" is unaffected; this is a separate change,
       2026-08-24).
     - *Outbound* (Portal calling out to NCC) — **fetch/write layer done,
       2026-08-24, NOT YET LIVE-VERIFIED against the real Thrio API.**
       `backend/src/services/ncc-client` — auth (per-tenant Basic-auth
       token-with-authorities, reactive 401 refresh), messages (list/by-
       customer/by-id/update-last-follow-up/acknowledge), customers
       (list/search/by-id/create). Credentials: per-Customer
       `ncc_org_config` override falling back to a TAS-wide default on
       `tas_settings` (`migrations/018_ncc_integration.sql`) — encrypted
       at rest (`lib/secretsCrypto.js`), managed via `/ncc-config` (Global
       Admin, API-only, no UI yet). `/ncc-debug` is a Global-Admin-only
       internal pipe-check surface, not the real feature UI. Contract-
       tested against a mocked Thrio API only — no live NCC credentials
       were available during this build. **Still needs, with Patrick:**
       confirming the unacknowledged-messages filter
       (`?customerId=&acknowledged=false`, not in the Postman collection),
       real message/customer payload shapes, real token TTL, and whether
       the per-Customer-vs-TAS-wide credential tiering above actually
       matches how Nextiva provisions Thrio tenants.
     - Consuming this in a real Customer Messages/Secure Messaging UI, and
       wiring `pushOrganizationToNcc` into Customer creation, are explicitly
       deferred — see `services/ncc-client/index.js`'s comment on why the
       push stayed a manual/debug action for now.
   - 5.2 (messages/PHI **UI/data model** — the outbound fetch layer above
     is the connectivity this will consume), 5.3 (reports), 5.5 (in-app
     onboarding wizard) — not started.

## Target spec: TAS Client Portal

Source: `TAS_Client_Portal_Requirements_Specification.docx` and
`TAS Client Portal Requirements.docx` (discovery-interview output, status DRAFT,
open items in its own Section 9/10 — not committed to this repo, held alongside
the other `.docx` guides, see below). Read those directly for full detail; this
is a delta summary against what's actually built today so the gap doesn't have
to be re-derived from the source docs every session.

**Confirmed deltas (original state → target; hierarchy/roles rows below are
already done — Phase 5.1 — kept here for the full original-vs-target picture):**
- **Hierarchy/multi-tenancy — done.** 5-level generic tree (Master Org → Main
  Account → Sub Account → Department → Provider) → 2-tier (TAS instance →
  Customer), plus an optional non-hierarchical `parent_id` nesting added back
  afterward for display purposes only (see Domain model above). Contacts/
  schedules are fully siloed per Customer, no cross-Customer identity sharing
  even for the same real-world person.
- **Roles — done.** 5 tiers (Global Admin, Org Admin, Scheduler, Technician,
  Read Only) → 3 tiers (Global Admin (TAS-wide), Customer Admin, User).
  Recording-download permission is finer-grained than role alone (role AND
  Customer/DID/campaign ID) — not yet implemented, still a target-spec item.
- **Deployment model:** currently one shared instance (this Cloud Run/Cloud SQL
  setup) → target is each TAS self-hosting its own instance, cloud-agnostic
  (AWS/Azure/GCP/on-prem), containerized, HA. Needs a configuration wizard
  (branding, domain, NCC token/domain pairing) as an onboarding deliverable.
  **Infra-provisioning side of this is already done** (2026-07-26): the
  Terraform/deploy-script layer is project-agnostic and a repeatable
  onboarding checklist exists — see `RUNBOOK.md`'s "Onboarding a new tenant"
  section and the `infra/envs/TEMPLATE.*.tenant` files. What's still missing
  is only the in-app first-run configuration wizard itself (Phase 5.5).
- **NCC/Thrio integration — highest-criticality piece, now partially built
  (see Build history's 5.4 entry, 2026-08-24) but not yet live-verified.**
  Inbound direction (NCC calling *into* the Portal in real time during live
  calls, to resolve Primary→Secondary→Tertiary→default and return name +
  SMS-capable phone) is done for the core on-call-lookup shape, service-
  API-key authenticated — the `Client/Customer ID` + `DID`/`Queue ID` +
  "now" vs "future at date/time" query-mode surface described in the spec
  doc is `GET /organizations/:orgId/on-call?at=` (`routes/onCall.js`); this
  is the inverse of the typical portal-calls-vendor pattern, putting the
  Portal in NCC's live call path. Outbound direction (Portal calling *out*
  to NCC for messages/customers, human-session Basic-auth per Nextiva
  engineering) has its fetch/write layer built (`services/ncc-client`) but
  untested against the live API — see Build history.
- **Messages/recordings/PHI:** not modeled at all currently (Customer
  Messages/Secure Messaging are nav-only stubs). Target: Portal never persists
  PHI or recording/message content — only metadata (sender, timestamp,
  subject/type, read state). Actual content is accessed via a secure iframe into
  NCC, gated by a per-Customer-configurable compliance check (mechanism TBD:
  role flag / re-auth / consent).
- **Reports:** currently a mix of Portal-native queries (coverage %, workload)
  and a generic `report_mappings` embed-URL system. Target: 100% NCC-executed —
  Portal only links to/embeds NCC/Looker reports, never computes its own. The
  existing `report_mappings` embed pattern is directionally right; the
  Portal-native coverage/workload endpoints in `routes/reports.js` are not.
- **Non-functional:** 99.9–99.95% availability, 30-min RTO/RPO, per-region data
  residency (varies by TAS location), TLS everywhere, session idle timeout
  (15–30 min, not yet finalized in the spec).

**What already lines up well** — don't rebuild these: the on-call scheduling
core (Primary/Secondary/Tertiary escalation with timeouts, day/week/month
views, past-dates-locked, no hard-delete on schedules), the audit log shape
("user X changed the on-call schedule — removed A, added B — at TIME"), and
the read-only-view-until-Edit-clicked UX pattern (implemented on the
Organizations page 2026-07-25 — apply the same pattern to other detail views
as they're touched).

**Before implementing any Phase 5 work:** break it into sub-phases and confirm
scope/priority — this delta is large enough (new Customer-level data model, a
new inbound-authenticated API surface, a secure-iframe content model) that it
should not be attempted as one change.

## Working conventions
- This is pre-launch with no real production data — schema changes don't need a
  migration path unless stated otherwise.
- Secure Messaging is nav/permission scaffolding only — do not build a real external
  integration unless explicitly asked.
- When touching branding/white-label logic, remember it's node-scoped, not just
  Master Org-scoped.
- Prefer a "Move" action with a parent picker over drag-and-drop for hierarchy UI.

## Docs that exist alongside this code (not in repo, held separately)
- `GCP_Implementation_Guide.docx` — GCP products, environment prep, deployment steps,
  macOS/Windows(WSL2) local setup
- `OnCall_Pro_Administrator_Guide.docx` — component-by-component guide, first-time
  setup, brand standard (colors/typography/template rules)
- `TAS_Client_Portal_Requirements_Specification.docx` and
  `TAS Client Portal Requirements.docx` — the Phase 5 target spec (see above).
  DRAFT status — has its own open-decisions log; check it before treating any
  detail as final.
