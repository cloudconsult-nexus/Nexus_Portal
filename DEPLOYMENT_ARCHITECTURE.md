# Deployment Architecture

What's deployed, where, and why — the reference for the Terraform in
`infra/`. Starting from scratch (no GCP project yet)? See
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) instead. For day-2 operational
procedures (rollback, secret rotation, restore), see [RUNBOOK.md](RUNBOOK.md).

## Diagram

```
                          ┌──────────────────────┐
  Browser  ───────────▶   │  Cloud Run: web       │  (nginx, static React build)
                          └──────────┬────────────┘
                                     │ HTTPS (VITE_API_URL, baked in at build time)
                                     ▼
                          ┌──────────────────────┐
                          │  Cloud Run: api       │  (Node/Express)
                          └──┬────────┬────────┬──┘
                             │        │        │ unix socket /cloudsql/...
                    outbound │        │        ▼
                       SMTP  │        │ ┌─────────────────────┐
                             │        │ │  Cloud SQL: Postgres │  automated backups
                             │        │ │  (REGIONAL in prod)  │  + PITR (cloudsql.tf)
                             │        │ └─────────────────────┘
                             ▼        ▼
                   ┌────────────┐  ┌─────────────────────────┐
                   │ SMTP relay │  │  GCS: branding/photos    │  signed URLs,
                   │ (external) │  │  bucket (storage.tf)     │  versioned
                   └────────────┘  └─────────────────────────┘

  NCC (Nextiva  ──▶  Cloud Run: api  (GET /organizations/:orgId/on-call,
  Contact Center)                    X-API-Key auth — inbound, not outbound
                                      like everything else on this page)

  Secret Manager ──▶ DB password, JWT secret, SMTP password, optional
                      integration secrets (mounted as env vars, secrets.tf/iam.tf)
                      — NCC_API_KEY is NOT yet among these; it's a manual
                      env var on the api service until infra/secrets.tf is
                      extended for it (see RUNBOOK.md's Secret rotation
                      section)

  Cloud Monitoring ──▶ uptime checks (API /_health, web /) + 5xx-rate alert
                        → email notification channel (monitoring.tf)

  Cloud Logging ──▶ automatic for both Cloud Run services (stdout/stderr —
                     morgan request logs + console.error), no config needed
```

Both Cloud Run services scale to zero by default in test
(`min_instances = 0`); prod keeps the API warm (`min_instances_api = 1`, see
`infra/envs/prod.tfvars`) to avoid cold-start latency on real traffic.

## Requirement → implementation

| # | Requirement | Where |
|---|---|---|
| 1 | Outbound email | `backend/src/lib/email.js` (nodemailer; console-log fallback when unconfigured) + `SMTP_*` vars wired in `infra/cloudrun.tf`, password in Secret Manager (`infra/secrets.tf`) |
| 2 | Invitation workflow | `backend/src/lib/invitations.js`, `routes/auth.js` (`/accept-invite`), `AcceptInvite.jsx` — fully built; the invite link reuses `CORS_ORIGIN` (the deployed web URL), so it "activates" once #1 is wired and `deploy.sh` completes its CORS fixup step |
| 3 | Secure storage — logos | `backend/src/lib/storage.js` (`uploadAsset`) → GCS bucket in `infra/storage.tf`, private, served via signed URLs (`resolveAssetUrl`) |
| 3 | Secure storage — profile pictures | Same bucket/mechanism as logos (see "Storage design" below) |
| 4 | Environment configs | `infra/envs/test.tfvars`, `infra/envs/prod.tfvars` (see table below); Dev is local-only, no cloud infra |
| 5 | Logging and monitoring | Cloud Logging: automatic. Monitoring: `infra/monitoring.tf` (uptime checks + alert policies + email notification channel) |
| 6 | Backup strategy | Cloud SQL automated backups + PITR, explicit retention (`infra/cloudsql.tf`); GCS bucket versioning + 30-day noncurrent-version expiry (`infra/storage.tf`) |
| 7 | Secret management | `infra/secrets.tf` + `infra/iam.tf` — `DB_PASSWORD`/`JWT_SECRET` always; `SMTP_PASS`/`REPORT_SSO_FALLBACK_SECRET`/`CUSTOMER_MESSAGING_SSO_SECRET` conditionally, only when set |
| 8 | NCC on-call lookup (Phase 5.4) | `backend/src/routes/onCall.js`, `middleware/serviceAuth.js` (`X-API-Key`, env var `NCC_API_KEY` — not yet in `infra/secrets.tf`, see RUNBOOK.md), `lib/calendarService.js#getOnCallAt`. Inbound-only: NCC calls this app mid-call, this app never calls NCC — the reverse of every other external integration on this page. |

## Environments

| | Dev | Test | Production |
|---|---|---|---|
| Where | Local machine | GCP (`oncall-pro-test`) | GCP (`oncall-pro-prod`) |
| Cloud SQL tier | — (local Postgres) | `db-f1-micro` | `db-custom-2-7680` |
| Cloud SQL HA | — | ZONAL | REGIONAL (multi-zone) |
| API min instances | — | 0 (scales to zero) | 1 (kept warm) |
| Backup retention | — | 7 backups | 30 backups |
| Terraform state | — | `gs://oncall-pro-tfstate-test` | `gs://oncall-pro-tfstate-prod` |
| Config | `backend/.env` (copy `.env.example`) | `infra/envs/test.tfvars` | `infra/envs/prod.tfvars` |

All three environments run identical application code — the only
differences are infrastructure sizing/HA and which external integrations
(SMTP, reporting SSO, customer messaging) are configured. One GCP project
holds both cloud environments; resources are isolated from each other by
the `app_name` prefix (`oncall-pro-test-*` vs. `oncall-pro-prod-*`), not by
separate projects. If you need stronger isolation (separate billing, IAM,
quotas) later, the same `envs/*.tfvars` pattern extends to a
`project_id` override per environment.

## Storage design: why logos and photos share one signed-URL bucket

Both org logos and person profile photos go through the same
`uploadAsset()` in `backend/src/lib/storage.js`, into the same GCS bucket
(`infra/storage.tf`). The bucket has no public-read grant — every URL
handed to the browser is a short-lived (7-day max) V4 signed URL, generated
per-request by `resolveAssetUrl()` in the same file, and applied at every
API response that includes a `logo_url`/`favicon_url`/`photo_url` field
(`routes/organizations.js`, `routes/tasSettings.js`, `routes/people.js`,
`lib/branding.js`'s `getEffectiveBranding`).

This replaced an earlier public-read design after hitting a real deployment
blocker: orgs enforcing `iam.allowedPolicyMemberDomains` (Domain Restricted
Sharing) reject any `allUsers` IAM grant outright, so a public-read bucket
simply doesn't work there — confirmed live in the `test` environment. Since
the app's whole premise (per the TAS Client Portal target spec) is
deploying into many different customers' own GCP projects, each with its
own IAM/org-policy posture, signed URLs are the org-policy-independent
choice — one mechanism that works the same way everywhere, rather than
something to re-solve per tenant.

Signing uses IAM `signBlob` impersonation (the API's Cloud Run runtime
service account is granted `roles/iam.serviceAccountTokenCreator` on
itself — `infra/iam.tf`'s `api_signer`) rather than a service-account key
file, since Cloud Run has none and shouldn't. `storage.js` caches signed
URLs in-memory (keyed by object key, refreshed with a day of margin before
the 7-day signature actually expires) to avoid re-signing on every single
request to a list endpoint (`GET /people`, `GET /organizations`) that
returns many image URLs at once. Object names are also UUID-suffixed
(`assetKey()`) as defense in depth, though that's no longer the only thing
standing between an object and the public internet.

## Secret management

| Secret | Required? | Where |
|---|---|---|
| `DB_PASSWORD` | Always | `infra/secrets.tf` → Secret Manager |
| `JWT_SECRET` | Always | `infra/secrets.tf` → Secret Manager |
| `SMTP_PASS` | Only if `smtp_password` var is set | Conditional Secret Manager entry (`count` guard) |
| `REPORT_SSO_FALLBACK_SECRET` | Only if used | Conditional Secret Manager entry |
| `CUSTOMER_MESSAGING_SSO_SECRET` | Only if Customer Messages is connected | Conditional Secret Manager entry |

The API's service account (`infra/iam.tf`) is granted `secretAccessor` on
exactly the secrets that exist for it — never project-wide Secret Manager
access. Non-sensitive config (`SMTP_HOST`/`PORT`/`USER`/`FROM`,
`CORS_ORIGIN`, `BRANDING_BUCKET_NAME`, etc.) is passed as plain Cloud Run
env vars, not secrets — see `infra/cloudrun.tf`.
