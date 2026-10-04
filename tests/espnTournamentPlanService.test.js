import { buildEspnBracketPlan } from '../src/services/espnTournamentPlanService.js';

// This is the thin I/O-orchestration layer between the ESPN-plan routes and
// the pure Phase 1 pieces (fetchNormalizedTournamentEvents/matchSchoolsForEvents/
// assembleBracketPlan) — their own logic is exhaustively covered elsewhere, so
// everything here is mocked to isolate what this layer itself is responsible
// for: date dedup, one fetch per distinct date, event dedup across dates,
// regionNameToId construction, and the info-vs-blocking diagnostics split.
const {
  teamRepoMock,
  tourneyRepoMock,
  fetchNormalizedMock,
  loadTeamMapMock,
  matchSchoolsMock,
  assembleBracketPlanMock,
} = vi.hoisted(() => ({
  teamRepoMock: { getAllSchools: vi.fn() },
  tourneyRepoMock: { getAllRegionTypes: vi.fn() },
  fetchNormalizedMock: vi.fn(),
  loadTeamMapMock: vi.fn(),
  matchSchoolsMock: vi.fn(),
  assembleBracketPlanMock: vi.fn(),
}));

vi.mock('../src/repositories/index.js', () => ({
  teamRepository: teamRepoMock,
  tourneyRepository: tourneyRepoMock,
}));

vi.mock('../src/services/espnService.js', () => ({
  fetchNormalizedTournamentEvents: fetchNormalizedMock,
  loadTeamMap: loadTeamMapMock,
}));

vi.mock('../src/services/schoolMatchingService.js', () => ({
  matchSchoolsForEvents: matchSchoolsMock,
}));

vi.mock('../src/services/bracketPlanService.js', () => ({
  assembleBracketPlan: assembleBracketPlanMock,
}));

const REGION_ORDER = [1, 2, 3, 4];

beforeEach(() => {
  vi.clearAllMocks();
  teamRepoMock.getAllSchools.mockResolvedValue([]);
  tourneyRepoMock.getAllRegionTypes.mockResolvedValue([
    { regionID: 1, regionName: 'East' },
    { regionID: 2, regionName: 'West' },
    { regionID: 3, regionName: 'South' },
    { regionID: 4, regionName: 'Midwest' },
    { regionID: 5, regionName: 'Final Four' },
    { regionID: 6, regionName: 'Championship' },
  ]);
  loadTeamMapMock.mockReturnValue({});
  fetchNormalizedMock.mockResolvedValue({ events: [], excluded: [] });
  matchSchoolsMock.mockReturnValue({ events: [], diagnostics: [] });
  assembleBracketPlanMock.mockReturnValue({
    ready: true,
    year: 2027,
    gamesData: ['1-1-1-10'],
    firstFourData: [],
    playInCount: 0,
    preview: { regions: [] },
    diagnostics: [],
  });
});

describe('buildEspnBracketPlan', () => {
  test('rejects when no dates are given', async () => {
    await expect(
      buildEspnBracketPlan({
        year: 2027,
        playInDates: [],
        r1Dates: [],
        regionOrder: REGION_ORDER,
      }),
    ).rejects.toThrow(/at least one/i);
    expect(fetchNormalizedMock).not.toHaveBeenCalled();
  });

  test('rejects more than 8 distinct dates', async () => {
    const dates = Array.from({ length: 9 }, (_, i) => `2027030${i}`);
    await expect(
      buildEspnBracketPlan({
        year: 2027,
        playInDates: dates,
        r1Dates: [],
        regionOrder: REGION_ORDER,
      }),
    ).rejects.toThrow(/too many distinct dates/i);
  });

  test('fetches each distinct date exactly once, deduped across playInDates/r1Dates', async () => {
    await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318', '20270319'],
      r1Dates: ['20270319', '20270320'], // 20270319 overlaps
      regionOrder: REGION_ORDER,
    });

    expect(fetchNormalizedMock).toHaveBeenCalledTimes(3);
    const calledDates = fetchNormalizedMock.mock.calls.map((c) => c[0]).sort();
    expect(calledDates).toEqual(['20270318', '20270319', '20270320']);
  });

  test('builds regionNameToId from regionTypes 1-4 only, and passes it to assembleBracketPlan', async () => {
    await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: [],
      regionOrder: REGION_ORDER,
    });

    const [call] = assembleBracketPlanMock.mock.calls[0];
    expect(call.regionNameToId).toEqual({
      East: 1,
      West: 2,
      South: 3,
      Midwest: 4,
    });
  });

  test('dedupes events by espnEventId across multiple fetched dates', async () => {
    const sharedEvent = { espnEventId: '1', round: '1st Round' };
    fetchNormalizedMock
      .mockResolvedValueOnce({ events: [sharedEvent], excluded: [] })
      .mockResolvedValueOnce({ events: [sharedEvent], excluded: [] });

    await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: ['20270319'],
      regionOrder: REGION_ORDER,
    });

    const [matchedEventsArg] = matchSchoolsMock.mock.calls[0];
    expect(matchedEventsArg).toHaveLength(1);
  });

  test('reports fetch counts per date in fetchSummary', async () => {
    fetchNormalizedMock
      .mockResolvedValueOnce({
        events: [{ espnEventId: '1' }, { espnEventId: '2' }],
        excluded: [{ espnEventId: '3', reason: 'not a two-competitor event' }],
      })
      .mockResolvedValueOnce({ events: [], excluded: [] });

    const plan = await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: ['20270319'],
      regionOrder: REGION_ORDER,
    });

    expect(plan.fetchSummary).toEqual([
      { date: '20270318', found: 2, excluded: 1 },
      { date: '20270319', found: 0, excluded: 0 },
    ]);
  });

  test('excluded ESPN events become non-blocking infoDiagnostics and do not affect ready', async () => {
    fetchNormalizedMock.mockResolvedValue({
      events: [],
      excluded: [{ espnEventId: '9', reason: 'unrecognized round "Elite 8"' }],
    });

    const plan = await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: [],
      regionOrder: REGION_ORDER,
    });

    expect(plan.ready).toBe(true);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.infoDiagnostics).toEqual([
      {
        code: 'espn-event-excluded',
        message: 'Excluded event on 20270318: unrecognized round "Elite 8"',
        espnEventId: '9',
      },
    ]);
  });

  test('an unresolved school match blocks readiness even if the assembler itself would be ready', async () => {
    matchSchoolsMock.mockReturnValue({
      events: [],
      diagnostics: [
        {
          espnEventId: '1',
          reason: 'team1 "New School" did not match an existing school',
        },
      ],
    });

    const plan = await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: [],
      regionOrder: REGION_ORDER,
    });

    expect(plan.ready).toBe(false);
    expect(plan.gamesData).toBeNull();
    expect(plan.firstFourData).toBeNull();
    expect(plan.diagnostics).toHaveLength(1);
  });

  test('a ready assembled plan passes gamesData/firstFourData through unchanged', async () => {
    assembleBracketPlanMock.mockReturnValue({
      ready: true,
      year: 2027,
      gamesData: ['1-1-1-10', '1-1-16-11'],
      firstFourData: [
        { team1ID: 1, team2ID: 2, seed: 16, nextGameID: 1, nextGameSpot: 2 },
      ],
      playInCount: 1,
      preview: { regions: [{ regionID: 1 }] },
      diagnostics: [],
    });

    const plan = await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: [],
      regionOrder: REGION_ORDER,
      expectedPlayInCount: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.gamesData).toEqual(['1-1-1-10', '1-1-16-11']);
    expect(plan.playInCount).toBe(1);
    expect(plan.preview).toEqual({ regions: [{ regionID: 1 }] });

    const [assembleCall] = assembleBracketPlanMock.mock.calls[0];
    expect(assembleCall.expectedPlayInCount).toBe(1);
    expect(assembleCall.year).toBe(2027);
    expect(assembleCall.regionOrder).toEqual(REGION_ORDER);
  });

  test('matched events reach assembleBracketPlan unchanged for validated play-in linkage', async () => {
    const events = [
      {
        espnEventId: 'r1-1',
        round: '1st Round',
        regionName: 'East',
        team1: { sID: 100, seed: 16, matchMethod: 'espnId' },
        team2: { sID: 10, seed: 1, matchMethod: 'espnId' },
      },
    ];
    matchSchoolsMock.mockReturnValue({ events, diagnostics: [] });

    await buildEspnBracketPlan({
      year: 2027,
      playInDates: ['20270318'],
      r1Dates: [],
      regionOrder: REGION_ORDER,
    });

    const [assembleCall] = assembleBracketPlanMock.mock.calls[0];
    expect(assembleCall.matchedEvents).toBe(events);
  });
});
