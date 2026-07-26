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
                   │ SMTP relay │  │  GCS: branding/photos    │  public read,
                   │ (external) │  │  bucket (storage.tf)     │  versioned
                   └────────────┘  └─────────────────────────┘

  Secret Manager ──▶ DB password, JWT secret, SMTP password, optional
                      integration secrets (mounted as env vars, secrets.tf/iam.tf)

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
| 3 | Secure storage — logos | `backend/src/lib/storage.js` (`uploadAsset`) → GCS bucket in `infra/storage.tf`, public read scoped to just this bucket |
| 3 | Secure storage — profile pictures | Same bucket/mechanism as logos (see "Storage design" below) |
| 4 | Environment configs | `infra/envs/test.tfvars`, `infra/envs/prod.tfvars` (see table below); Dev is local-only, no cloud infra |
| 5 | Logging and monitoring | Cloud Logging: automatic. Monitoring: `infra/monitoring.tf` (uptime checks + alert policies + email notification channel) |
| 6 | Backup strategy | Cloud SQL automated backups + PITR, explicit retention (`infra/cloudsql.tf`); GCS bucket versioning + 30-day noncurrent-version expiry (`infra/storage.tf`) |
| 7 | Secret management | `infra/secrets.tf` + `infra/iam.tf` — `DB_PASSWORD`/`JWT_SECRET` always; `SMTP_PASS`/`REPORT_SSO_FALLBACK_SECRET`/`CUSTOMER_MESSAGING_SSO_SECRET` conditionally, only when set |

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

## Storage design: why logos and photos share one public-read bucket

Both org logos and person profile photos go through the same
`uploadAsset()` in `backend/src/lib/storage.js`, into the same GCS bucket
(`infra/storage.tf`), with bucket-wide public read. This is deliberate, not
an oversight:

- **Logos** must be publicly fetchable — they render in `<img>` tags for
  every portal user, including a customer's own end users under
  white-labeling, who are never authenticated against this app at all.
- **Photos** render in authenticated pages only, but as plain `<img src>`
  tags — making them require auth would mean either signed URLs (each with
  their own expiry/refresh complexity) or proxying every image through the
  API. Given photos are non-sensitive (professional headshots of on-call
  staff, not medical/financial/identity data) and object names are
  UUID-suffixed (`assetKey()` — not guessable, not enumerable), the
  practical risk of unauthenticated-but-unguessable access is low relative
  to the complexity of a signed-URL scheme.

If this tradeoff changes for your deployment (e.g. photos need to stop
being fetchable without auth), split `storage.tf` into two buckets — one
public (logos), one private with `roles/storage.objectViewer` removed and a
signed-URL-issuing endpoint added to `routes/people.js` — rather than
changing the shared one, so logos keep working unmodified.

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
