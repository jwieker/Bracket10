import fs from 'node:fs';
import { buildEspnBracketPlan } from '../src/services/espnTournamentPlanService.js';

const { getAllSchools, getAllRegionTypes } = vi.hoisted(() => ({
  getAllSchools: vi.fn(),
  getAllRegionTypes: vi.fn(),
}));
vi.mock('../src/repositories/index.js', () => ({
  teamRepository: { getAllSchools },
  tourneyRepository: { getAllRegionTypes },
}));
vi.mock('../src/services/espnService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTeamMap: () => ({}),
}));

let fixtures;
const input = {
  year: 2025,
  playInDates: ['20250318', '20250319'],
  playInCounts: [2, 2],
  r1Dates: ['20250320', '20250321'],
  expectedPlayInCount: 4,
  ignoreResolvedPlayIns: true,
  regionOrder: [1, 4, 2, 3],
};
beforeEach(() => {
  fixtures = Object.fromEntries(
    ['18', '19', '20', '21'].map((day) => [
      `202503${day}`,
      JSON.parse(
        fs.readFileSync(`tests/fixtures/espn/2025-03-${day}.json`, 'utf8'),
      ),
    ]),
  );
  const competitors = Object.values(fixtures).flatMap((f) =>
    f.events.flatMap((e) => e.competitions[0].competitors),
  );
  getAllSchools.mockResolvedValue([
    ...new Map(
      competitors.map((c) => [
        c.team.id,
        { sid: Number(c.team.id), espn: { espnID: Number(c.team.id) } },
      ]),
    ).values(),
  ]);
  getAllRegionTypes.mockResolvedValue(
    ['East', 'West', 'South', 'Midwest'].map((regionName, index) => ({
      regionID: index + 1,
      regionName,
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => ({
      ok: true,
      json: async () => fixtures[new URL(url).searchParams.get('dates')],
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

test('historical test mode creates a complete plan, retains play-in links and warns about completed results', async () => {
  const result = await buildEspnBracketPlan(input);
  expect(result.ready).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(result.gamesData).toHaveLength(64);
  expect(result.gamesData.filter((slot) => slot.endsWith('-'))).toHaveLength(4);
  expect(result.firstFourData).toHaveLength(4);
  expect(
    result.infoDiagnostics.filter((item) => item.code === 'completed-play-in'),
  ).toHaveLength(4);
  expect(result.preview.semifinalPairings).toEqual([
    { gameID: 61, regions: [1, 4] },
    { gameID: 62, regions: [2, 3] },
  ]);
  const schoolIDs = [
    ...result.gamesData
      .map((slot) => Number(slot.split('-')[3]))
      .filter(Boolean),
    ...result.firstFourData.flatMap((game) => [game.team1ID, game.team2ID]),
  ];
  expect(new Set(schoolIDs).size).toBe(68);
  expect(
    result.firstFourData.map((game) => [game.nextGameID, game.nextGameSpot]),
  ).toEqual(
    expect.arrayContaining([
      [46, 2],
      [50, 2],
      [1, 2],
      [20, 2],
    ]),
  );
});

test('daily counts 1/3 fail even though the total matches the actual 2/2 schedule', async () => {
  const result = await buildEspnBracketPlan({ ...input, playInCounts: [1, 3] });
  expect(result.ready).toBe(false);
  expect(result.gamesData).toBeNull();
  expect(
    result.diagnostics.filter((d) => d.code === 'daily-play-in-count-mismatch'),
  ).toHaveLength(2);
  expect(result.fetchSummary.slice(0, 2)).toEqual([
    expect.objectContaining({
      date: '20250318',
      expectedPlayIns: 1,
      foundPlayIns: 2,
    }),
    expect.objectContaining({
      date: '20250319',
      expectedPlayIns: 3,
      foundPlayIns: 2,
    }),
  ]);
});

test('counts midnight UTC games on their New York date and deduplicates cross-date results', async () => {
  fixtures['20250318'].events[0].date = '2025-03-19T01:00:00Z';
  fixtures['20250319'].events.push(fixtures['20250318'].events[0]);
  const result = await buildEspnBracketPlan(input);
  expect(result.ready).toBe(true);
  expect(
    result.fetchSummary.slice(0, 2).map((item) => item.foundPlayIns),
  ).toEqual([2, 2]);
});

test('accepts a genuinely unequal daily schedule', async () => {
  fixtures['20250318'].events[0].date = '2025-03-19T18:00:00Z';
  const result = await buildEspnBracketPlan({ ...input, playInCounts: [1, 3] });
  expect(result.ready).toBe(true);
  expect(
    result.fetchSummary.slice(0, 2).map((item) => item.foundPlayIns),
  ).toEqual([1, 3]);
});

test('blocks a play-in with an unknown scheduled date', async () => {
  fixtures['20250318'].events[0].date = null;
  const result = await buildEspnBracketPlan(input);
  expect(result.ready).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: 'missing-play-in-date' }),
  );
});

test.each([undefined, false])(
  'historical winners block creation when test mode is %s',
  async (ignoreResolvedPlayIns) => {
    const result = await buildEspnBracketPlan({
      ...input,
      ignoreResolvedPlayIns,
    });
    expect(result.ready).toBe(false);
    expect(result.gamesData).toBeNull();
    expect(
      result.diagnostics.filter((d) => d.code === 'destination-already-filled'),
    ).toHaveLength(4);
  },
);
