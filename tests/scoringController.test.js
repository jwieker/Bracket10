import { vi } from 'vitest';
import { scoring } from '../src/controllers/scoringController.js';
import { APP_CONFIG } from '../src/config/app.js';

function mockRes() {
  return {
    render: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
}

function mockReq(query = {}) {
  return { body: {}, query, method: 'GET', url: '/' };
}

describe('scoringController - scoring', () => {
  test('renders scoring template with deterministic rows and schemes', async () => {
    const req = mockReq();
    const res = mockRes();

    await scoring(req, res);

    expect(res.render).toHaveBeenCalledWith(
      'scoring',
      expect.objectContaining({
        rows: expect.any(Array),
        maxPicks: APP_CONFIG.tournament.maxPicksPerEntry,
        schemes: expect.any(Array),
      }),
    );

    const renderArgs = res.render.mock.calls[0][1];

    // Check rows structure (rounds 1 to 6)
    expect(renderArgs.rows).toHaveLength(6);
    expect(renderArgs.rows[0]).toEqual(
      expect.objectContaining({
        round: 1,
        roundPoints: expect.any(Number),
        cumulative: expect.any(Number),
        doubleMinusOne: null, // for round 1
        prevRoundPoints: null,
      }),
    );

    expect(renderArgs.rows[1]).toEqual(
      expect.objectContaining({
        round: 2,
        roundPoints: expect.any(Number),
        cumulative: expect.any(Number),
        doubleMinusOne: expect.any(Number),
        prevRoundPoints: expect.any(Number),
      }),
    );

    // Check schemes
    // There are 5 schemes defined in SCHEMES
    expect(renderArgs.schemes).toHaveLength(5);

    // First scheme should be the current one because of sorting
    expect(renderArgs.schemes[0].current).toBe(true);
    expect(renderArgs.schemes[0].key).toBe('current');

    // Every scheme should have a chart object
    renderArgs.schemes.forEach((scheme) => {
      expect(scheme).toEqual(
        expect.objectContaining({
          key: expect.any(String),
          name: expect.any(String),
          points: expect.any(Array),
          chart: expect.objectContaining({
            entries: expect.any(Array),
            max: expect.any(Number),
          }),
        }),
      );

      // Chart entries should be 5 and sorted by score descending
      expect(scheme.chart.entries).toHaveLength(5);
      expect(scheme.chart.entries[0].score).toBeGreaterThanOrEqual(
        scheme.chart.entries[1].score,
      );
    });
  });
});
