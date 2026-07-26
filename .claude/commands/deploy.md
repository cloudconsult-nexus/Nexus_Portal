---
description: Deploy OnCall Pro to a named environment (test or prod)
argument-hint: <test|prod>
---

Deploy OnCall Pro to the **$ARGUMENTS** environment.

First, without running anything destructive yet:
1. Confirm `$ARGUMENTS` is exactly `test` or `prod` — if not, stop and ask.
2. Check that `TF_VAR_project_id`, `TF_VAR_db_password`, `TF_VAR_jwt_secret`,
   and `TF_VAR_alert_notification_email` are set in the environment. If any
   are missing, tell the user which ones and stop — don't invent values.
3. Show the user a one-line summary of what's about to happen (provision/
   update infra via Terraform, build+push both images, deploy both Cloud
   Run services, run DB migrations) and confirm before proceeding, per
   DEPLOYMENT_GUIDE.md Part 4.2 — this is exactly the kind of command that
   should always be confirmed explicitly, not auto-run.

Then run `./scripts/deploy.sh $ARGUMENTS` and report back:
- The API and web URLs it prints.
- Whether the `/_health` check succeeds.
- Anything that failed, with the relevant log output — don't just say "it
  failed," quote the actual error.

Reference DEPLOYMENT_GUIDE.md Part 3 and RUNBOOK.md for context on what
each step does and how to troubleshoot a failure at any stage.
