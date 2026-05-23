import { vi, describe, test, expect, beforeEach } from 'vitest';

const mockRequest = vi.fn();

vi.mock('google-auth-library', () => {
  return {
    GoogleAuth: class {
      constructor() {}
      getClient() {
        return Promise.resolve({
          request: mockRequest,
        });
      }
    }
  };
});

import {
  getMonthToDateSpend,
  getDailySpend,
  getBudgetStatus,
  triggerProductionDeploy,
  _clearBudgetCacheForTests,
} from '../src/services/cloudService.js';

describe('cloudService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    _clearBudgetCacheForTests();
    // Reset env vars to clean state
    process.env = { ...originalEnv };
    delete process.env.GCP_BILLING_EXPORT_TABLE;
    delete process.env.GCP_BILLING_ACCOUNT_ID;
    delete process.env.GCP_CLOUD_BUILD_TRIGGER_ID;
  });

  describe('getMonthToDateSpend', () => {
    test('returns unconfigured if GCP_BILLING_EXPORT_TABLE is not set', async () => {
      const result = await getMonthToDateSpend();
      expect(result).toEqual({
        configured: false,
        spent: null,
        currency: 'USD',
      });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    test('queries BigQuery and parses spent cost and currency successfully', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      mockRequest.mockResolvedValue({
        data: {
          rows: [
            {
              f: [
                { v: '124.50' },
                { v: 'USD' }
              ]
            }
          ]
        }
      });

      const result = await getMonthToDateSpend();

      expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/my-project/queries',
        method: 'POST',
      }));

      // Check query structure contains the backticks around export table
      const requestBody = mockRequest.mock.calls[0][0].data;
      expect(requestBody.query).toContain('FROM `my-project.billing_dataset.gcp_billing_export_v1`');
      expect(requestBody.useLegacySql).toBe(false);

      expect(result).toEqual({
        configured: true,
        spent: 124.50,
        currency: 'USD',
      });
    });

    test('returns spent 0 if BigQuery query returns no rows', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      mockRequest.mockResolvedValue({ data: { rows: [] } });

      const result = await getMonthToDateSpend();
      expect(result).toEqual({
        configured: true,
        spent: 0,
        currency: 'USD',
      });
    });

    test('handles API errors gracefully and returns the error message', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      
      const apiError = new Error('GCP API 403: Access Denied');
      apiError.response = {
        status: 403,
        data: {
          error: { message: 'Access Denied' }
        }
      };
      mockRequest.mockRejectedValue(apiError);

      const result = await getMonthToDateSpend();
      expect(result).toEqual({
        configured: true,
        spent: null,
        currency: 'USD',
        error: 'GCP API 403: Access Denied',
      });
    });

    test('falls back to gross cost when credits column is unrecognized', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      const missingCreditsErr = new Error('GCP API 400: Unrecognized name: credits');
      missingCreditsErr.response = {
        status: 400,
        data: {
          error: { message: 'Unrecognized name: credits' }
        }
      };

      mockRequest
        .mockRejectedValueOnce(missingCreditsErr)
        .mockResolvedValueOnce({
          data: {
            rows: [
              {
                f: [
                  { v: '180.75' },
                  { v: 'USD' }
                ]
              }
            ]
          }
        });

      const result = await getMonthToDateSpend();

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        configured: true,
        spent: 180.75,
        currency: 'USD',
        error: "Billing export missing `credits` column — showing gross list-price cost, not net invoiced spend. Verify the export is 'Standard usage cost' and wait ~24h for the full schema.",
      });
    });
  });

  describe('getDailySpend', () => {
    test('returns unconfigured if GCP_BILLING_EXPORT_TABLE is not set', async () => {
      const result = await getDailySpend();
      expect(result).toEqual({
        configured: false,
        days: [],
        currency: 'USD',
      });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    test('groups by day and fills missing days with zero up to today', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      const now = new Date();
      const year = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const day1 = `${year}-${mm}-01`;

      mockRequest.mockResolvedValue({
        data: {
          rows: [
            { f: [{ v: day1 }, { v: '0.0025' }, { v: 'USD' }] },
          ]
        }
      });

      const result = await getDailySpend();
      expect(result.configured).toBe(true);
      expect(result.currency).toBe('USD');
      expect(result.days.length).toBe(now.getUTCDate());
      expect(result.days[0]).toEqual({ date: day1, spent: 0.0025 });
      // All other days should default to 0
      expect(result.days.slice(1).every((d) => d.spent === 0)).toBe(true);
    });

    test('falls back to gross cost when credits column is unrecognized', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';

      const missingCreditsErr = new Error('GCP API 400: Unrecognized name: credits');
      missingCreditsErr.response = {
        status: 400,
        data: { error: { message: 'Unrecognized name: credits' } }
      };

      mockRequest
        .mockRejectedValueOnce(missingCreditsErr)
        .mockResolvedValueOnce({ data: { rows: [] } });

      const result = await getDailySpend();
      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(result.configured).toBe(true);
      expect(result.error).toMatch(/missing `credits` column/);
    });

    test('returns error message gracefully on non-credits API failure', async () => {
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      const apiError = new Error('GCP API 403: Access Denied');
      apiError.response = { status: 403, data: { error: { message: 'Access Denied' } } };
      mockRequest.mockRejectedValue(apiError);

      const result = await getDailySpend();
      expect(result).toEqual({
        configured: true,
        days: [],
        currency: 'USD',
        error: 'GCP API 403: Access Denied',
      });
    });
  });

  describe('getBudgetStatus', () => {
    test('returns unconfigured if GCP_BILLING_ACCOUNT_ID is not set', async () => {
      const result = await getBudgetStatus();
      expect(result).toEqual({
        configured: false,
        budgets: [],
        error: 'GCP_BILLING_ACCOUNT_ID is not set',
      });
    });

    test('fetches budgets and merges with live spent cost and daily spend', async () => {
      process.env.GCP_BILLING_ACCOUNT_ID = '012345-6789AB-CDEF01';
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      // 1: budgets, 2 & 3: parallel BigQuery (MTD + daily)
      mockRequest
        .mockResolvedValueOnce({
          data: {
            budgets: [
              {
                name: 'billingAccounts/012345-6789AB-CDEF01/budgets/b1',
                displayName: 'My Cap Budget',
                amount: {
                  specifiedAmount: {
                    units: '250',
                    nanos: 500000000,
                    currencyCode: 'USD',
                  }
                },
                thresholdRules: [
                  { thresholdPercent: 0.8, spendBasis: 'CURRENT_SPEND' },
                  { thresholdPercent: 1.0, spendBasis: 'CURRENT_SPEND' }
                ]
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            rows: [
              { f: [{ v: '185.00' }, { v: 'USD' }] }
            ]
          }
        })
        .mockResolvedValueOnce({ data: { rows: [] } });

      const result = await getBudgetStatus();

      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({
        configured: true,
        budgets: [
          {
            name: 'billingAccounts/012345-6789AB-CDEF01/budgets/b1',
            displayName: 'My Cap Budget',
            amount: 250.50,
            currency: 'USD',
            thresholds: [
              { percent: 80, basis: 'CURRENT_SPEND' },
              { percent: 100, basis: 'CURRENT_SPEND' }
            ]
          }
        ],
        spendConfigured: true,
        spent: 185.00,
        currency: 'USD',
        spendError: null,
      });
      expect(result.dailySpend).toBeDefined();
      expect(Array.isArray(result.dailySpend.days)).toBe(true);
    });

    test('returns cached result on subsequent calls unless forced', async () => {
      process.env.GCP_BILLING_ACCOUNT_ID = '012345-6789AB-CDEF01';
      
      mockRequest
        .mockResolvedValueOnce({
          data: {
            budgets: [{ name: 'b1', displayName: 'B1', amount: { specifiedAmount: { units: '10' } } }]
          }
        });

      const result1 = await getBudgetStatus();
      const result2 = await getBudgetStatus(); // Cache hit

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(result2).toBe(result1);

      // Now force refresh
      mockRequest.mockResolvedValueOnce({
        data: {
          budgets: [{ name: 'b1', displayName: 'B1', amount: { specifiedAmount: { units: '10' } } }]
        }
      });
      const result3 = await getBudgetStatus({ force: true });
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    test('reports spendError gracefully if spend lookup fails but budget lookup succeeds', async () => {
      process.env.GCP_BILLING_ACCOUNT_ID = '012345-6789AB-CDEF01';
      process.env.GCP_BILLING_EXPORT_TABLE = 'my-project.billing_dataset.gcp_billing_export_v1';

      mockRequest
        .mockResolvedValueOnce({
          data: {
            budgets: [{ name: 'b1', displayName: 'B1', amount: { specifiedAmount: { units: '10' } } }]
          }
        })
        .mockRejectedValueOnce(new Error('BigQuery Table Not Found'))
        .mockRejectedValueOnce(new Error('BigQuery Table Not Found'));

      const result = await getBudgetStatus();
      expect(result).toMatchObject({
        configured: true,
        budgets: [
          {
            name: 'b1',
            displayName: 'B1',
            amount: 10,
            currency: 'USD',
            thresholds: [],
          }
        ],
        spendConfigured: true,
        spent: null,
        currency: 'USD',
        spendError: 'GCP API ?: BigQuery Table Not Found',
      });
      expect(result.dailySpend).toBeDefined();
      expect(result.dailySpend.days).toEqual([]);
    });

    test('handles complete budget lookup failures gracefully', async () => {
      process.env.GCP_BILLING_ACCOUNT_ID = '012345-6789AB-CDEF01';
      mockRequest.mockRejectedValueOnce(new Error('Billing API Disabled'));

      const result = await getBudgetStatus();
      expect(result).toEqual({
        configured: true,
        budgets: [],
        error: 'GCP API ?: Billing API Disabled',
      });
    });
  });

  describe('triggerProductionDeploy', () => {
    test('returns error if GCP_CLOUD_BUILD_TRIGGER_ID is not set', async () => {
      const result = await triggerProductionDeploy();
      expect(result).toEqual({
        ok: false,
        error: 'GCP_CLOUD_BUILD_TRIGGER_ID is not set',
      });
    });

    test('triggers Cloud Build run endpoint and returns build info on success', async () => {
      process.env.GCP_CLOUD_BUILD_TRIGGER_ID = 'trigger-uuid-123';
      process.env.GOOGLE_CLOUD_PROJECT = 'my-project';

      mockRequest.mockResolvedValue({
        data: {
          metadata: {
            build: {
              id: 'build-id-999',
              logUrl: 'https://console.cloud.google.com/build-log'
            }
          }
        }
      });

      const result = await triggerProductionDeploy();

      expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://cloudbuild.googleapis.com/v1/projects/my-project/triggers/trigger-uuid-123:run',
        method: 'POST',
        data: { branchName: 'main' },
      }));

      expect(result).toEqual({
        ok: true,
        buildId: 'build-id-999',
        logUrl: 'https://console.cloud.google.com/build-log',
        branch: 'main',
      });
    });

    test('handles failure in Cloud Build triggers run gracefully', async () => {
      process.env.GCP_CLOUD_BUILD_TRIGGER_ID = 'trigger-uuid-123';
      mockRequest.mockRejectedValue(new Error('Trigger Not Found'));

      const result = await triggerProductionDeploy();
      expect(result).toEqual({
        ok: false,
        error: 'GCP API ?: Trigger Not Found',
      });
    });
  });
});
