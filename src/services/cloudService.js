/**
 * cloudService.js
 * Read-only access to GCP billing budgets and write access to trigger a
 * Cloud Build deploy, surfaced by the /admin/cloud dashboard.
 *
 * Auth: Application Default Credentials. On Cloud Run this is the service
 * account attached to the service. Locally, `gcloud auth application-default
 * login` works. The service account needs:
 *   - billing.budgets.list   (e.g. roles/billing.viewer on the billing account)
 *   - cloudbuild.builds.create (roles/cloudbuild.builds.editor on the project)
 *
 * Required env vars:
 *   - GCP_BILLING_ACCOUNT_ID   numeric/letters portion of billingAccounts/XXXX
 *   - GCP_CLOUD_BUILD_TRIGGER_ID  trigger UUID (see cloudbuild.yaml _TRIGGER_ID)
 * Optional:
 *   - GCP_DEPLOY_BRANCH        defaults to "main"
 *   - GOOGLE_CLOUD_PROJECT     optional in production (automatically resolved on Cloud Run via metadata server)
 */
import { GoogleAuth } from "google-auth-library";
import Logger from "../utils/logger.js";

const BUDGET_CACHE_KEY = "cloud:budgets";
const BUDGET_TTL_MS = 60 * 60 * 1000; // 1 hour
let budgetCache = { value: null, expiresAt: 0 };

let _auth;
function getAuth() {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return _auth;
}

let projectIdPromise = null;
function getProjectId() {
  if (!projectIdPromise) {
    projectIdPromise = (async () => {
      const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
      if (fromEnv) {
        return fromEnv;
      }
      try {
        const auth = getAuth();
        const projectId = await auth.getProjectId();
        if (projectId) {
          return projectId;
        }
      } catch (err) {
        Logger.error("Failed to dynamically resolve GCP project ID", err);
      }
      // Clear the cached promise on failure so that transient errors can be retried on next call
      projectIdPromise = null;
      return "";
    })();
  }
  return projectIdPromise;
}

async function gcpRequest(url, options = {}) {
  const client = await getAuth().getClient();
  try {
    const res = await client.request({ url, ...options });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const apiMessage = err.response?.data?.error?.message;
    const wrapped = new Error(
      `GCP API ${status || "?"}: ${apiMessage || err.message}`
    );
    wrapped.status = status;
    wrapped.body = err.response?.data;
    throw wrapped;
  }
}

/**
 * Programmatically retrieves month-to-date spent cost from standard BigQuery billing export.
 * Returns { configured: boolean, spent: number | null, currency: string, error?: string }
 */
async function getMonthToDateSpend() {
  const exportTable = process.env.GCP_BILLING_EXPORT_TABLE;
  if (!exportTable) {
    return { configured: false, spent: null, currency: "USD" };
  }

  const projectId = await getProjectId();
  if (!projectId) {
    return {
      configured: true,
      spent: null,
      currency: "USD",
      error: "GCP project ID could not be determined. Please configure GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID.",
    };
  }

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/queries`;

  // `cost` is list price. Credits (free tier, promos, SUDs) are a repeated
  // field with negative amounts; net invoiced spend = cost + SUM(credits).
  // Some exports (very new tables, non-standard variants) don't expose the
  // `credits` column — fall back to gross cost and warn so the dashboard
  // makes sense rather than showing nothing.
  const buildQuery = (withCredits) => `
    SELECT
      SUM(CAST(cost AS NUMERIC)${
        withCredits
          ? `
          + IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC))
                    FROM UNNEST(credits) AS c), 0)`
          : ""
      }) AS spent,
      currency
    FROM \`${exportTable}\`
    WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
    GROUP BY currency
  `;

  const runQuery = async (withCredits) => {
    const data = await gcpRequest(url, {
      method: "POST",
      data: { query: buildQuery(withCredits), useLegacySql: false },
    });
    if (data.rows && data.rows.length > 0) {
      // BigQuery rows: [{ f: [{ v: "spent_value" }, { v: "currency_value" }] }]
      const firstRowFields = data.rows[0].f;
      const spent = firstRowFields[0]?.v ? Number(firstRowFields[0].v) : 0;
      const currency = firstRowFields[1]?.v || "USD";
      return { spent, currency };
    }
    return { spent: 0, currency: "USD" };
  };

  try {
    const { spent, currency } = await runQuery(true);
    return { configured: true, spent, currency };
  } catch (error) {
    const isMissingCreditsColumn = /Unrecognized name: credits/i.test(
      error.message
    );
    if (!isMissingCreditsColumn) {
      Logger.error("getMonthToDateSpend failed", error);
      return {
        configured: true,
        spent: null,
        currency: "USD",
        error: error.message,
      };
    }
    Logger.warn(
      "getMonthToDateSpend: billing export missing `credits` column; falling back to gross cost"
    );
    try {
      const { spent, currency } = await runQuery(false);
      return {
        configured: true,
        spent,
        currency,
        error:
          "Billing export missing `credits` column — showing gross list-price cost, not net invoiced spend. Verify the export is 'Standard usage cost' and wait ~24h for the full schema.",
      };
    } catch (fallbackError) {
      Logger.error("getMonthToDateSpend fallback failed", fallbackError);
      return {
        configured: true,
        spent: null,
        currency: "USD",
        error: fallbackError.message,
      };
    }
  }
}

/**
 * Returns per-day spend for the current invoice month from the BigQuery billing
 * export, used by the admin dashboard to render a bar chart.
 *
 * Shape: { configured, days: [{ date: 'YYYY-MM-DD', spent: number }], currency, error? }
 * Days with zero spend are included so the chart shows a continuous date axis.
 */
async function getDailySpend() {
  const exportTable = process.env.GCP_BILLING_EXPORT_TABLE;
  if (!exportTable) {
    return { configured: false, days: [], currency: "USD" };
  }

  const projectId = await getProjectId();
  if (!projectId) {
    return {
      configured: true,
      days: [],
      currency: "USD",
      error: "GCP project ID could not be determined. Please configure GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID.",
    };
  }

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
    projectId
  )}/queries`;

  const buildQuery = (withCredits) => `
    SELECT
      FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS day,
      SUM(CAST(cost AS NUMERIC)${
        withCredits
          ? `
          + IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC))
                    FROM UNNEST(credits) AS c), 0)`
          : ""
      }) AS spent,
      ANY_VALUE(currency) AS currency
    FROM \`${exportTable}\`
    WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
    GROUP BY day
    ORDER BY day
  `;

  const runQuery = async (withCredits) => {
    const data = await gcpRequest(url, {
      method: "POST",
      data: { query: buildQuery(withCredits), useLegacySql: false },
    });
    const rows = data.rows || [];
    const parsed = rows.map((r) => ({
      date: r.f[0]?.v,
      spent: r.f[1]?.v ? Number(r.f[1].v) : 0,
      currency: r.f[2]?.v || "USD",
    }));
    return parsed;
  };

  const fillMonth = (rows) => {
    // Today's UTC date — billing export uses UTC usage_start_time, so the
    // x-axis should match. Fill day 1 through today with zeros for missing
    // days, mirroring the GCP console view.
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const today = now.getUTCDate();
    const byDate = new Map(rows.map((r) => [r.date, r.spent]));
    const currency = rows.find((r) => r.currency)?.currency || "USD";
    const days = [];
    for (let d = 1; d <= today; d++) {
      const mm = String(month + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      const key = `${year}-${mm}-${dd}`;
      days.push({ date: key, spent: byDate.get(key) || 0 });
    }
    return { days, currency };
  };

  try {
    const rows = await runQuery(true);
    const { days, currency } = fillMonth(rows);
    return { configured: true, days, currency };
  } catch (error) {
    const isMissingCreditsColumn = /Unrecognized name: credits/i.test(
      error.message
    );
    if (!isMissingCreditsColumn) {
      Logger.error("getDailySpend failed", error);
      return {
        configured: true,
        days: [],
        currency: "USD",
        error: error.message,
      };
    }
    try {
      const rows = await runQuery(false);
      const { days, currency } = fillMonth(rows);
      return {
        configured: true,
        days,
        currency,
        error:
          "Billing export missing `credits` column — showing gross list-price cost, not net invoiced spend.",
      };
    } catch (fallbackError) {
      Logger.error("getDailySpend fallback failed", fallbackError);
      return {
        configured: true,
        days: [],
        currency: "USD",
        error: fallbackError.message,
      };
    }
  }
}

/**
 * Returns configured budgets for the billing account and live month-to-date spent cost.
 *
 * Shape: { configured: boolean, budgets: [{ displayName, amount, currency }], spent, currency, spendConfigured, spendError, dailySpend: { days, error? }, error? }
 */
export async function getBudgetStatus({ force = false } = {}) {
  const billingAccountId = process.env.GCP_BILLING_ACCOUNT_ID;
  if (!billingAccountId) {
    return {
      configured: false,
      budgets: [],
      error: "GCP_BILLING_ACCOUNT_ID is not set",
    };
  }

  if (!force && budgetCache.value && budgetCache.expiresAt > Date.now()) {
    return budgetCache.value;
  }

  try {
    const url = `https://billingbudgets.googleapis.com/v1/billingAccounts/${encodeURIComponent(
      billingAccountId
    )}/budgets`;
    const data = await gcpRequest(url);
    const budgets = (data.budgets || []).map((b) => {
      const specified = b?.amount?.specifiedAmount;
      const units = specified?.units ? Number(specified.units) : 0;
      const nanos = specified?.nanos ? Number(specified.nanos) / 1e9 : 0;
      return {
        name: b.name,
        displayName: b.displayName || b.name,
        amount: units + nanos,
        currency: specified?.currencyCode || "USD",
        thresholds: (b.thresholdRules || []).map((t) => ({
          percent: Math.round((t.thresholdPercent || 0) * 100),
          basis: t.spendBasis || "CURRENT_SPEND",
        })),
      };
    });

    const [spendData, dailyData] = await Promise.all([
      getMonthToDateSpend(),
      getDailySpend(),
    ]);

    const result = {
      configured: true,
      budgets,
      spendConfigured: spendData.configured,
      spent: spendData.spent,
      currency: spendData.currency,
      spendError: spendData.error || null,
      dailySpend: {
        days: dailyData.days,
        error: dailyData.error || null,
      },
    };
    budgetCache = { value: result, expiresAt: Date.now() + BUDGET_TTL_MS };
    return result;
  } catch (error) {
    Logger.error("getBudgetStatus failed", error);
    return {
      configured: true,
      budgets: [],
      error: error.message,
    };
  }
}

/**
 * Triggers the existing Cloud Build trigger that builds and deploys the app
 * to Cloud Run. Returns { ok, buildId?, logUrl?, error? }.
 */
export async function triggerProductionDeploy() {
  const triggerId = process.env.GCP_CLOUD_BUILD_TRIGGER_ID;
  if (!triggerId) {
    return { ok: false, error: "GCP_CLOUD_BUILD_TRIGGER_ID is not set" };
  }
  const branch = process.env.GCP_DEPLOY_BRANCH || "main";
  const projectId = await getProjectId();
  if (!projectId) {
    return { ok: false, error: "GCP project ID could not be determined. Please configure GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID." };
  }

  try {
    const url = `https://cloudbuild.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/triggers/${encodeURIComponent(triggerId)}:run`;
    const data = await gcpRequest(url, {
      method: "POST",
      data: { branchName: branch },
    });
    // The :run endpoint returns a long-running Operation. Its metadata
    // is BuildOperationMetadata { build: Build }, but some response shapes
    // surface the Build directly on metadata — fall back so the buildId
    // and logUrl in the UI are populated either way.
    const build = data?.metadata?.build || data?.metadata || {};
    Logger.info("triggerProductionDeploy started", {
      buildId: build.id,
      branch,
    });
    return {
      ok: true,
      buildId: build.id,
      logUrl: build.logUrl,
      branch,
    };
  } catch (error) {
    Logger.error("triggerProductionDeploy failed", error);
    return { ok: false, error: error.message };
  }
}

export async function getCloudConsoleLinks() {
  const projectId = await getProjectId();
  const enc = encodeURIComponent(projectId || "");
  return {
    projectId,
    deployBranch: process.env.GCP_DEPLOY_BRANCH || "main",
    firestore: projectId ? `https://console.cloud.google.com/firestore/databases/-default-/data?project=${enc}` : "#",
    cloudRun: projectId ? `https://console.cloud.google.com/run?project=${enc}` : "#",
    cloudBuild: projectId ? `https://console.cloud.google.com/cloud-build/builds?project=${enc}` : "#",
    cloudBuildTriggers: projectId ? `https://console.cloud.google.com/cloud-build/triggers?project=${enc}` : "#",
    logs: projectId ? `https://console.cloud.google.com/logs/query?project=${enc}` : "#",
    billing: projectId ? `https://console.cloud.google.com/billing?project=${enc}` : "#",
    budgets: projectId ? `https://console.cloud.google.com/billing/budgets?project=${enc}` : "#",
    artifactRegistry: projectId ? `https://console.cloud.google.com/artifacts?project=${enc}` : "#",
    iam: projectId ? `https://console.cloud.google.com/iam-admin/iam?project=${enc}` : "#",
    secrets: projectId ? `https://console.cloud.google.com/security/secret-manager?project=${enc}` : "#",
  };
}

// Test seam: clear the in-process budget cache and project ID promise.
export function _clearBudgetCacheForTests() {
  budgetCache = { value: null, expiresAt: 0 };
  projectIdPromise = null;
}

export const _getMonthToDateSpendForTests = getMonthToDateSpend;
export const _getDailySpendForTests = getDailySpend;
