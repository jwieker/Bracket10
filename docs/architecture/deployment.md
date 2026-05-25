---
tags: [architecture, deployment, gcp]
updated: 2026-05-20
---

# Deployment

The application runs on **Google Cloud Run**, deployed automatically when a commit is pushed to `main` via Cloud Build.

- **GCP Project ID:** resolved dynamically via `google-auth-library` credentials (from the metadata server on Cloud Run) or fallback to `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT_ID` environment variables.
- **Cloud Run service name:** your choice — examples below use `<SERVICE_NAME>` as the placeholder, region `us-central1`.

## Required Environment Variables

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID (from GCP Console > APIs & Services > Credentials) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret used for authorization-code exchange |
| `ADMIN_EMAILS` | Comma-separated list of authorized admin Google email addresses |
| `SESSION_SECRET` | Secret for `express-session` — **required or server crashes on startup** |
| `NODE_ENV` | Set to `production` to enable `secure` cookie flag (HTTPS-only sessions) |
| `GOOGLE_CLOUD_PROJECT` | (Optional in production) GCP project ID. In production (Cloud Run), the SDK resolves this automatically via the metadata server/application credentials; set it explicitly in `.env` for local dev. `GCP_PROJECT_ID` is also accepted as an alternative name. |
| `APP_HOST` | (Optional) Apex domain the app is served from in production (e.g. `bracket.example.com`). Drives (1) the `www.<host>` → `<host>` 308 redirect in `server.js`, and (2) the default OAuth callback URL when `REDIRECT_URI` is unset. Leave unset locally. |
| `REDIRECT_URI` | (Optional) Explicit OAuth callback URL. Takes precedence over `APP_HOST` derivation. Use this for tunnels, preview envs, or any deployment where the callback isn't `https://<APP_HOST>/auth/google/callback`. |
| `GA_MEASUREMENT_ID` | (Optional) Google Analytics 4 measurement ID (e.g. `G-XXXXXXXXXX`). When set, the gtag snippet is rendered by `views/partials/header.ejs` on all user-facing pages. Leave unset to omit GA entirely — the default for forks. |
| `DEFAULT_GROUP` | (Optional) Default group name shown in pickers and used as a fallback in registration lookups. Defaults to `"Default"`. |
| `EMAIL_GROUP` | (Optional) Group whose unsent entries are surfaced by the admin email-drafting helper (`emailService.getUnsentEmailEntries`). Leave empty to disable. |
| `EXCLUDED_GROUPS` | (Optional) Comma-separated group names filtered out of standard listings (legacy / sandbox). Defaults to `"Bad"`. |
| `PRIORITY_GROUPS` | (Optional) Comma-separated group names pinned to the top of group pickers. Defaults to empty. |
| `PAYMENT_COLLECTOR_GROUP` | (Optional) When an entry joins this exact group, the confirmation page renders a payment-collector contact block. Leave empty to never render it. |
| `PAYMENT_COLLECTOR_NAME` / `PAYMENT_COLLECTOR_EMAIL` / `PAYMENT_COLLECTOR_PHONE` | (Optional) Contact fields shown in the payment-collector block. Each field is independent — empty values hide that row. |
| `DEBUG_ERRORS` | (Optional) Set to `1` or `true` to expose verbose error fields (`operation`, `service`, raw `message`) in `DatabaseError` / `ServiceError` JSON responses. Default is generic-only in **every** environment — explicit opt-in keeps schema names out of staging / preview responses too. Detailed errors always go to `Logger.error` regardless. |
| `GCP_BILLING_ACCOUNT_ID` | (Optional) Billing account ID used by `/admin/cloud` to list configured GCP budgets via the Cloud Billing Budgets API. Unset → budget card shows a configuration hint. |
| `GCP_CLOUD_BUILD_TRIGGER_ID` | (Optional) UUID of the Cloud Build trigger used by the "Deploy to Production" button on `/admin/cloud`. This must be the actual trigger resource UUID copied from the trigger detail page URL — NOT the internal `_TRIGGER_ID` substitution parameter inside `cloudbuild.yaml`. |
| `GCP_DEPLOY_BRANCH` | (Optional) Branch the deploy trigger runs against. Defaults to `main`. |
| `GCP_BILLING_EXPORT_TABLE` | (Optional) Full path of the BigQuery billing export table (e.g. `project.dataset.gcp_billing_export_v1_XXXX`) used to fetch live month-to-date spent cost. |

## Admin Cloud Dashboard (`/admin/cloud`)

View `views/adminCloud.ejs`, controller actions in `src/controllers/adminController.js`, GCP integration in `src/services/cloudService.js`. Three cards:

- **GCP budget** — calls Cloud Billing Budgets API (`billingbudgets.googleapis.com/v1/billingAccounts/{id}/budgets`) to list configured caps and alert thresholds. It integrates with BigQuery standard billing export to show **live month-to-date spend** plus a per-day bar chart for the current invoice month, all cached 1 hour in-process. The MTD total (`getMonthToDateSpend`) and daily breakdown (`getDailySpend`) are issued as two parallel BigQuery queries inside `getBudgetStatus`; the daily query groups by `DATE(usage_start_time)` and fills missing days with zero so the chart shows a continuous axis.
- **Quick links** — static `console.cloud.google.com` deep links built from `GOOGLE_CLOUD_PROJECT`. Free, no API calls.
- **Launch to Production** — `POST /admin/cloud/deploy` calls `cloudbuild.googleapis.com/v1/projects/{project}/triggers/{id}:run`. Guarded by `requireSiteAdmin` and a JS `confirm()`.

Auth uses Application Default Credentials via `google-auth-library`. On Cloud Run this is the attached service account; locally use `gcloud auth application-default login`. All GCP REST calls go through `gcpRequest()` in `cloudService.js`, which wraps `client.request()` so token refresh is handled by the SDK.

### Budget Card Integration: Caps and Live Spend

The Cloud Billing **Budgets** API only returns budget configuration (cap amount, alert thresholds). To display the actual live month-to-date spend directly alongside these caps on the dashboard, the application integrates with **BigQuery billing export** via standard usage cost tables.

### Production Setup Runbook — Wire the Dashboard to Real Prod Data

Substitute `$PROJECT` (your GCP project ID) and `$SERVICE` (your Cloud Run service name) throughout this section.

**1. Find your IDs.** In the GCP console:
- Billing account ID: Billing → Account management → copy the ID after `billingAccounts/` (format `XXXXXX-XXXXXX-XXXXXX`).
- Cloud Build trigger ID: Cloud Build → Triggers → click the trigger that deploys this app → copy the UUID from the URL. Use the actual resource UUID, NOT the internal `_TRIGGER_ID` substitution defined inside `cloudbuild.yaml`.
- Cloud Run runtime service account: Cloud Run → `$SERVICE` → Security tab → copy the "Service account" email.

**2. Grant IAM roles to the Cloud Run service account.**

```bash
PROJECT=<your-gcp-project-id>
SERVICE=<your-cloud-run-service-name>
SA=<paste the runtime service account email>
BILLING_ACCT=<paste the billing account ID>

# Read budgets
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCT" \
  --member="serviceAccount:$SA" \
  --role="roles/billing.viewer"

# Trigger deploys
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/cloudbuild.builds.editor"

# Read BigQuery billing export data and run query jobs
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" \
  --role="roles/bigquery.jobUser"
```

**3. Enable the APIs (idempotent).**

```bash
gcloud services enable \
  billingbudgets.googleapis.com \
  cloudbuild.googleapis.com \
  bigquery.googleapis.com \
  --project="$PROJECT"
```

**4. Setup BigQuery Billing Export.**
1. GCP console → Billing → Billing export → **BigQuery export** → enable "Standard usage cost".
2. Choose / create a BigQuery dataset (recommended: `billing_export` in your project, location `US`).
3. Grant the Cloud Run service account `roles/bigquery.dataViewer` on the dataset containing the billing export table.
4. Once the billing export table is generated (which can take up to 24 hours), locate the full table identifier (e.g. `<project>.billing_export.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`).

**5. Update Cloud Run environment variables.**

> [!CAUTION]
> **CRITICAL WARNING: NEVER USE `--set-env-vars` TO UPDATE OR MODIFY ENVIRONMENT VARIABLES!**
> Using `--set-env-vars` will completely overwrite and erase all other existing environment variables configured on your service. Erasing essential variables like `SESSION_SECRET` will instantly cause the application to crash in production with generic unexpected 500 errors.
>
> **ALWAYS use `--update-env-vars`** to add or modify environment variables. This merges and updates specified variables while safely preserving all other active configuration.

```bash
gcloud run services update $SERVICE \
  --region us-central1 \
  --update-env-vars \
GCP_BILLING_ACCOUNT_ID=$BILLING_ACCT,GCP_CLOUD_BUILD_TRIGGER_ID=<your-trigger-uuid>,GCP_DEPLOY_BRANCH=main,GCP_BILLING_EXPORT_TABLE=$PROJECT.billing_export.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX
```

**6. Verify.** Sign in to `/admin/cloud`. The budget card should list your configured budgets (cap + alert thresholds) and the live, month-to-date spent cost with a visual progress bar. The "Deploy to Production" button should kick off a Cloud Build run and surface the build ID + log URL.

### BigQuery Live MTD Spend Query & Fallback Logic

The month-to-date live spend is retrieved programmatically inside `src/services/cloudService.js` through `getMonthToDateSpend()`.

#### Cost Calculation Formula
Gross list price cost is represented by `cost`. Real invoiced spend accounts for credits, promos, free tiers, and sustained use discounts (SUDs). To calculate the net invoiced spend, we sum the cost and the repeating credits array:
`net_spend = cost + SUM(credits.amount)` (where credits are negative values).

The standard SQL query executed against BigQuery:
```sql
SELECT
  SUM(CAST(cost AS NUMERIC)
      + IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC))
                FROM UNNEST(credits) AS c), 0)) AS spent,
  currency
FROM `GCP_BILLING_EXPORT_TABLE`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY currency
```

#### Credit Column Fallback Mechanism
Very new billing export tables, non-standard exports, or empty schemas may not immediately expose the repeated `credits` column. Running the query above on such tables throws an `Unrecognized name: credits` database error.

To ensure the budget card remains robust and informative instead of failing or displaying `$0.00`:
1. The service first attempts to run the fully comprehensive query with the `credits` summation.
2. If it catches an `Unrecognized name: credits` error, it logs a warning: `getMonthToDateSpend: billing export missing credits column; falling back to gross cost`.
3. It falls back to a query calculating gross cost (`SUM(CAST(cost AS NUMERIC))`) only.
4. It surfaces a non-blocking warning message on the UI dashboard advising the user that gross costs are shown and that they should verify the table is "Standard usage cost" and wait 24h for the full schema to propagate.

This prevents temporary schema gaps from breaking the admin dashboard.

ESPN polling now runs through Cloud Run Jobs / Scheduler OAuth, so there is no shared `POLL_SECRET` web endpoint secret in the current architecture.

To add/update env vars without erasing others:
```bash
gcloud run services update $SERVICE \
  --region us-central1 \
  --update-env-vars KEY=value,KEY2=value2
```

```bash
# Example: update min instances
gcloud run services update $SERVICE --min-instances=0 --region=us-central1
```

## Dual PWA Architecture

Two distinct Progressive Web Apps run on the same domain to isolate offline capabilities and caching:

1. **Main User App (`/`)**:
   - Header: `views/partials/header.ejs`
   - Manifest: `public/manifest.json` (explicit `scope: "/"`)
   - Service Worker: `public/service-worker.js`

2. **Admin App (`/updates`, `/admin`, `/admin/*`)**:
   - Header: `views/partials/admin-header.ejs`
   - Manifest: `public/admin-manifest.json` (explicit `scope: "/updates"`)
   - Service Worker: `public/admin-service-worker.js` (separate `CACHE_NAME` to prevent collisions)

**Critical Rule:** Do *not* combine these headers or service workers.

## Related Files

- `docs/architecture/security.md` — Admin session auth, rate limiting, custom security headers
- `docs/architecture/caching.md` — In-memory cache (instance-local — fragments under multi-instance Cloud Run)
- `docs/tournament/espn-setup.md` — Cloud Scheduler setup for ESPN polling jobs
