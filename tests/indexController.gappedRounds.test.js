import { describe, expect, test, vi, afterEach } from 'vitest';
import { TOURNAMENT_ROUNDS } from '../src/config/app.js';

// Each scenario below needs a different round missing from TOURNAMENT_ROUNDS,
// so the gap is injected per test via vi.doMock + a dynamic re-import rather
// than the single static vi.mock a one-scenario file would use (same pattern
// as tests/cachePruneTimer.test.js's dynamic import after mocking timers).
afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../src/config/app.js');
});

async function renderWithMissingRound(missingRound) {
  vi.resetModules();
  vi.doMock('../src/config/app.js', async (importOriginal) => {
    const actual = await importOriginal();
    const rounds = { ...actual.TOURNAMENT_ROUNDS };
    delete rounds[missingRound];
    return { ...actual, TOURNAMENT_ROUNDS: rounds };
  });
  const { index } = await import('../src/controllers/indexController.js');
  const req = { body: {}, query: {}, method: 'GET', url: '/', path: '/' };
  // status()/json() are present so a controllerWrapper error path fails the
  // assertion cleanly instead of throwing an unhelpful "not a function".
  const res = {
    render: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  await index(req, res);
  expect(res.render).toHaveBeenCalledWith('index', expect.any(Object));
  return res.render.mock.calls[0][1];
}

describe('index controller with a gap in TOURNAMENT_ROUNDS', () => {
  test('preserves round identities when round 3 is missing', async () => {
    const { ladder } = await renderWithMissingRound(3);
    expect(ladder.map((rung) => rung.round)).toEqual([1, 2, 4, 5, 6]);
  });

  test('still compares Final Four points after filtering out round 3', async () => {
    const { ladder, compare } = await renderWithMissingRound(3);
    // Final Four is round 5; round 6 is the championship. Renumbering the
    // filtered ladder would select championship points under round 5.
    expect(compare.deepLabel).toBe('Final Four');
    expect(compare.deep).toBe(TOURNAMENT_ROUNDS[5].points);
    expect(compare.deep).toBe(
      ladder.find((rung) => rung.round === 5).cumulative,
    );
    expect(compare.deep).not.toBe(TOURNAMENT_ROUNDS[6].points);
  });

  test('falls back to zero when the comparison round (5) itself is missing', async () => {
    const { ladder, compare } = await renderWithMissingRound(5);
    expect(ladder.map((rung) => rung.round)).toEqual([1, 2, 3, 4, 6]);
    expect(compare.deep).toBe(0);
    expect(compare.deepLabel).toBe('');
  });

  test('preserves identities and zeroes the shallow side when round 1 is missing', async () => {
    const { ladder, compare } = await renderWithMissingRound(1);
    expect(ladder.map((rung) => rung.round)).toEqual([2, 3, 4, 5, 6]);
    expect(compare.shallow).toBe(0);
    expect(compare.ratio).toBe(0);
    // The deep side (round 5) is untouched by the round-1 gap.
    expect(compare.deep).toBe(TOURNAMENT_ROUNDS[5].points);
  });

  test('recomputes the bar-width max when round 6 is missing', async () => {
    const { ladder } = await renderWithMissingRound(6);
    expect(ladder.map((rung) => rung.round)).toEqual([1, 2, 3, 4, 5]);
    // Round 6 (the highest roundPoints) is gone, so round 5 is now the max
    // and should fill the full bar rather than being scaled against a round
    // that no longer renders.
    const finalFour = ladder.find((rung) => rung.round === 5);
    expect(finalFour.barWidth).toBe(100);
  });
});
