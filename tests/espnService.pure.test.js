import {
  fetchCompletedTournamentGames,
  fetchScheduledTournamentGames,
  getDateStrDaysAgo,
} from '../src/services/espnService.js';
import Logger from '../src/utils/logger.js';

function makeEvent({ completed = true, id = '123', competitors = null } = {}) {
  const defaultCompetitors = [
    { winner: true, team: { displayName: 'Duke' } },
    { winner: false, team: { displayName: 'Kansas' } },
  ];
  return {
    id,
    status: { type: { completed } },
    competitions: [{ competitors: competitors ?? defaultCompetitors }],
  };
}

function mockFetch(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// Mirrors real fetch's abort semantics: the promise only ever settles when the
// AbortController's signal fires, so it exercises the setTimeout(...abort) wiring
// instead of resolving/rejecting on its own.
function mockAbortableFetch() {
  global.fetch = vi.fn(
    (_url, { signal } = {}) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  // Some tests below switch to fake timers to drive the 10s abort wiring; always
  // restore real timers so it can't bleed into unrelated tests later in the file.
  vi.useRealTimers();
  delete global.fetch;
});

// ---------------------------------------------------------------------------
// fetchCompletedTournamentGames
// ---------------------------------------------------------------------------

describe('fetchCompletedTournamentGames', () => {
  test('returns completed games mapped to the expected shape', async () => {
    mockFetch({ events: [makeEvent({ id: '42' })] });

    const result = await fetchCompletedTournamentGames('20240321');

    expect(result).toEqual([
      {
        espnEventId: '42',
        team1DisplayName: 'Duke',
        team2DisplayName: 'Kansas',
        winnerDisplayName: 'Duke',
      },
    ]);
  });

  test('includes the dateStr in the fetch URL', async () => {
    mockFetch({ events: [] });

    await fetchCompletedTournamentGames('20240321');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('dates=20240321'),
      expect.any(Object),
    );
  });

  test('skips events that are not completed', async () => {
    mockFetch({
      events: [makeEvent({ completed: false }), makeEvent({ id: '99' })],
    });

    const result = await fetchCompletedTournamentGames('20240321');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('99');
  });

  test('skips events with no competition', async () => {
    const eventNoComp = {
      id: '1',
      status: { type: { completed: true } },
      competitions: [],
    };
    mockFetch({ events: [eventNoComp, makeEvent({ id: '2' })] });

    const result = await fetchCompletedTournamentGames('20240321');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('2');
  });

  test('skips events with != 2 competitors', async () => {
    const oneCompetitor = [{ winner: true, team: { displayName: 'Duke' } }];
    mockFetch({
      events: [
        makeEvent({ id: '1', competitors: oneCompetitor }),
        makeEvent({ id: '2' }),
      ],
    });

    const result = await fetchCompletedTournamentGames('20240321');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('2');
  });

  test('skips events where no competitor has winner=true', async () => {
    const noWinner = [
      { winner: false, team: { displayName: 'Duke' } },
      { winner: false, team: { displayName: 'Kansas' } },
    ];
    mockFetch({
      events: [
        makeEvent({ id: '1', competitors: noWinner }),
        makeEvent({ id: '2' }),
      ],
    });

    const result = await fetchCompletedTournamentGames('20240321');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('2');
  });

  test('returns empty array when events is empty', async () => {
    mockFetch({ events: [] });
    const result = await fetchCompletedTournamentGames('20240321');
    expect(result).toEqual([]);
  });

  test('returns empty array when events is missing from response', async () => {
    mockFetch({});
    const result = await fetchCompletedTournamentGames('20240321');
    expect(result).toEqual([]);
  });

  test('throws when ESPN returns a non-ok HTTP status', async () => {
    mockFetch({}, { ok: false, status: 503 });

    await expect(fetchCompletedTournamentGames('20240321')).rejects.toThrow(
      'ESPN API returned HTTP 503',
    );
  });

  test('throws when fetch itself rejects (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchCompletedTournamentGames('20240321')).rejects.toThrow(
      'Network error',
    );
  });

  test('aborts and rejects once the 10s fetch timeout elapses', async () => {
    vi.useFakeTimers();
    mockAbortableFetch();
    const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

    const pending = fetchCompletedTournamentGames('20260318');
    // Attach the rejection assertion before advancing timers: the reject() fires
    // inside the fake-timer callback, and Node flags a promise "unhandled" based on
    // whether a handler existed at the moment it rejects, not whether one arrives later.
    const assertion = expect(pending).rejects.toThrow(/aborted/i);
    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
    expect(errorSpy).toHaveBeenCalled();
  });

  test('clears the fetch timeout on success so no timer is left running', async () => {
    vi.useFakeTimers();
    mockFetch({ events: [] });

    await fetchCompletedTournamentGames('20240321');

    expect(vi.getTimerCount()).toBe(0);
  });

  test("uses today's date when no dateStr is provided", async () => {
    mockFetch({ events: [] });

    await fetchCompletedTournamentGames();

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toMatch(/dates=\d{8}/);
  });

  // #170 — reject malformed dates before they reach the outbound URL.
  test.each(['2024321', '202403211', '2024-03-21', 'abcdefgh', ''])(
    'throws on invalid dateStr %j and never fetches',
    async (bad) => {
      mockFetch({ events: [] });
      await expect(fetchCompletedTournamentGames(bad)).rejects.toThrow(
        /Invalid ESPN date format/,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// fetchScheduledTournamentGames
// ---------------------------------------------------------------------------

function makeScheduledEvent({
  completed = false,
  id = '200',
  competitors = null,
  notes = undefined,
} = {}) {
  const defaultCompetitors = [
    {
      winner: completed ? true : false,
      team: { displayName: 'Duke' },
      curatedRank: { current: 5 },
    },
    {
      winner: false,
      team: { displayName: 'Kansas' },
      curatedRank: { current: 12 },
    },
  ];
  return {
    id,
    status: { type: { completed } },
    competitions: [{ competitors: competitors ?? defaultCompetitors, notes }],
  };
}

describe('fetchScheduledTournamentGames', () => {
  test('returns all games regardless of completed status', async () => {
    mockFetch({
      events: [
        makeScheduledEvent({ id: '1', completed: false }),
        makeScheduledEvent({ id: '2', completed: true }),
      ],
    });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result).toHaveLength(2);
  });

  test('returns correct shape with seeds and completed flag', async () => {
    mockFetch({ events: [makeScheduledEvent({ id: '42', completed: true })] });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result[0]).toEqual({
      espnEventId: '42',
      team1DisplayName: 'Duke',
      team2DisplayName: 'Kansas',
      team1Seed: 5,
      team2Seed: 12,
      completed: true,
      winnerDisplayName: 'Duke',
      regionName: null,
    });
  });

  test('winnerDisplayName is null for incomplete games', async () => {
    mockFetch({ events: [makeScheduledEvent({ completed: false })] });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result[0].completed).toBe(false);
    expect(result[0].winnerDisplayName).toBeNull();
  });

  test('seed is null when curatedRank is missing', async () => {
    const competitors = [
      { winner: false, team: { displayName: 'Duke' } },
      { winner: false, team: { displayName: 'Kansas' } },
    ];
    mockFetch({ events: [makeScheduledEvent({ competitors })] });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result[0].team1Seed).toBeNull();
    expect(result[0].team2Seed).toBeNull();
  });

  test('includes the dateStr in the fetch URL', async () => {
    mockFetch({ events: [] });

    await fetchScheduledTournamentGames('20260317');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('dates=20260317'),
      expect.any(Object),
    );
  });

  test('skips events with no competition', async () => {
    const eventNoComp = {
      id: '1',
      status: { type: { completed: false } },
      competitions: [],
    };
    mockFetch({ events: [eventNoComp, makeScheduledEvent({ id: '2' })] });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('2');
  });

  test('skips events with != 2 competitors', async () => {
    const oneCompetitor = [
      {
        winner: false,
        team: { displayName: 'Duke' },
        curatedRank: { current: 1 },
      },
    ];
    mockFetch({
      events: [
        makeScheduledEvent({ id: '1', competitors: oneCompetitor }),
        makeScheduledEvent({ id: '2' }),
      ],
    });

    const result = await fetchScheduledTournamentGames('20260317');

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe('2');
  });

  test('returns empty array when events is empty', async () => {
    mockFetch({ events: [] });
    const result = await fetchScheduledTournamentGames('20260317');
    expect(result).toEqual([]);
  });

  test('throws when ESPN returns a non-ok HTTP status', async () => {
    mockFetch({}, { ok: false, status: 503 });

    await expect(fetchScheduledTournamentGames('20260317')).rejects.toThrow(
      'ESPN API returned HTTP 503',
    );
  });

  test('throws when fetch itself rejects (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchScheduledTournamentGames('20260317')).rejects.toThrow(
      'Network error',
    );
  });

  test('aborts and rejects once the 10s fetch timeout elapses', async () => {
    vi.useFakeTimers();
    mockAbortableFetch();
    const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => {});

    const pending = fetchScheduledTournamentGames('20260317');
    // Attach the rejection assertion before advancing timers: the reject() fires
    // inside the fake-timer callback, and Node flags a promise "unhandled" based on
    // whether a handler existed at the moment it rejects, not whether one arrives later.
    const assertion = expect(pending).rejects.toThrow(/aborted/i);
    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
    expect(errorSpy).toHaveBeenCalled();
  });

  test('clears the fetch timeout on success so no timer is left running', async () => {
    vi.useFakeTimers();
    mockFetch({ events: [] });

    await fetchScheduledTournamentGames('20260317');

    expect(vi.getTimerCount()).toBe(0);
  });

  // #329 — the successful-match branch of the region regex was never exercised; a silent
  // regression here nulls every team's region during tournament creation. These pin the
  // exact `- <word> Region -` framing the parser depends on.
  describe('regionName extraction from notes headline', () => {
    test.each([
      ["NCAA Men's Basketball Championship - West Region - 1st Round", 'West'],
      ['Something - Midwest Region - Elite 8', 'Midwest'],
    ])('headline %j → regionName %j', async (headline, expected) => {
      mockFetch({ events: [makeScheduledEvent({ notes: [{ headline }] })] });

      const result = await fetchScheduledTournamentGames('20260317');

      expect(result[0].regionName).toBe(expected);
    });

    test.each([
      // No "- X Region -" framing at all.
      "NCAA Men's Basketball Championship - Final Four",
      // Multi-word region names don't match the single-word \w+ pattern — pinned as
      // current behavior so a headline format change fails loudly here, not in prod data.
      'Championship - Very West Region - 1st Round',
    ])('non-matching headline %j → regionName null', async (headline) => {
      mockFetch({ events: [makeScheduledEvent({ notes: [{ headline }] })] });

      const result = await fetchScheduledTournamentGames('20260317');

      expect(result[0].regionName).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// getDateStrDaysAgo
// ---------------------------------------------------------------------------

describe('getDateStrDaysAgo', () => {
  test('returns a string in YYYYMMDD format', () => {
    const result = getDateStrDaysAgo(0);
    expect(result).toMatch(/^\d{8}$/);
  });

  test('daysAgo=0 and daysAgo=1 differ by one day', () => {
    const today = getDateStrDaysAgo(0);
    const yesterday = getDateStrDaysAgo(1);

    const todayDate = new Date(
      `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`,
    );
    const yesterdayDate = new Date(
      `${yesterday.slice(0, 4)}-${yesterday.slice(4, 6)}-${yesterday.slice(6, 8)}`,
    );

    const diffMs = todayDate - yesterdayDate;
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  test('daysAgo=7 is earlier than daysAgo=0', () => {
    const today = getDateStrDaysAgo(0);
    const weekAgo = getDateStrDaysAgo(7);
    expect(weekAgo < today).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadTeamMap
// ---------------------------------------------------------------------------

import { loadTeamMap } from '../src/services/espnService.js';

describe('loadTeamMap', () => {
  test('returns valid team map if file exists', () => {
    // The actual config file should exist when running these tests in the repo.
    const teamMap = loadTeamMap();
    expect(typeof teamMap).toBe('object');
  });

  // Error-path coverage (createRequire throwing) lives in tests/loadTeamMap.pure.test.js,
  // which mocks node's `module` at import time — something this suite can't do once
  // espnService has already been imported above.
});
