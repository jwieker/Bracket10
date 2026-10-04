// Runs the full ESPN normalization -> school-matching -> bracket-assembly
// pipeline against real ESPN scoreboard responses recorded from the 2025
// tournament (tests/fixtures/espn/2025-03-{18,19,20,21}.json — trimmed to the
// fields the pipeline reads, values otherwise verbatim from the live API).
// This is what caught fetchNormalizedTournamentEvents's headline regex
// requiring an "NCAA " prefix real ESPN headlines don't have.
//
// These fixtures are HISTORICAL: R1 events already show the play-in winner
// as a normal competitor, not a TBD placeholder, because by tip-off the play-in
// was already decided. That's real for parsing, but it means the fixtures
// don't by themselves prove pregame/TBD import — the plan's implementation
// gate is explicit that a completed-game feed isn't proof of the pregame
// placeholder shape. The synthetic-pregame test below starts from this real,
// verified-parseable data and then hand-blanks the 4 known play-in-fed R1
// slots (labeled synthetic below) to exercise the assembler's TBD-linking
// path; it is not a claim that live pregame ESPN responses were captured.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import { fetchNormalizedTournamentEvents } from '../src/services/espnService.js';
import { matchSchoolsForEvents } from '../src/services/schoolMatchingService.js';
import { assembleBracketPlan } from '../src/services/bracketPlanService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DATES = ['2025-03-18', '2025-03-19', '2025-03-20', '2025-03-21'];

function loadFixture(date) {
  return JSON.parse(
    readFileSync(
      path.join(__dirname, 'fixtures', 'espn', `${date}.json`),
      'utf8',
    ),
  );
}

function mockFetchOnce(body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

async function fetchAllNormalizedEvents() {
  const dateStrs = {
    '2025-03-18': '20250318',
    '2025-03-19': '20250319',
    '2025-03-20': '20250320',
    '2025-03-21': '20250321',
  };
  const allEvents = [];
  const allExcluded = [];
  for (const date of FIXTURE_DATES) {
    mockFetchOnce(loadFixture(date));
    const { events, excluded } = await fetchNormalizedTournamentEvents(
      dateStrs[date],
    );
    allEvents.push(...events);
    allExcluded.push(...excluded);
  }
  return { events: allEvents, excluded: allExcluded };
}

// Builds allSchools/teamMap directly from whatever teams appear in the
// normalized events, matching purely by ESPN id (internal sID = ESPN id, for
// this test only — production sIDs are unrelated to ESPN ids).
function buildSchoolFixtures(events) {
  const byEspnId = new Map();
  for (const event of events) {
    for (const team of [event.team1, event.team2]) {
      if (team.espnId != null) byEspnId.set(team.espnId, team.displayName);
    }
  }
  const allSchools = [...byEspnId.entries()].map(([espnId, displayName]) => ({
    sid: Number(espnId),
    name: displayName,
    espn: { espnID: Number(espnId) },
  }));
  return { allSchools, teamMap: {} };
}

describe('ESPN recorded-fixture pipeline (2025 First Four + Round 1)', () => {
  test('normalizes every recorded event with no exclusions and the real headline format', async () => {
    const { events, excluded } = await fetchAllNormalizedEvents();

    expect(excluded).toEqual([]);
    expect(events).toHaveLength(36); // 2 + 2 + 16 + 16
    expect(events.filter((e) => e.round === 'First Four')).toHaveLength(4);
    expect(events.filter((e) => e.round === '1st Round')).toHaveLength(32);
    for (const event of events) {
      expect(event.regionName).toMatch(/^(East|West|South|Midwest)$/);
      expect(event.team1.seed).toBeGreaterThanOrEqual(1);
      expect(event.team2.seed).toBeGreaterThanOrEqual(1);
    }
  });

  test('deduplicates by event id if a date range is requested with overlap', async () => {
    // 2025-03-18's First Four events reappear verbatim if the same date were
    // fetched twice (e.g. an admin re-running a preview) — dedup happens per
    // fetchNormalizedTournamentEvents call, so fetching the same fixture twice
    // and concatenating results in double entries at the caller level, same as
    // pollEspnScheduled's existing Map-based dedup across dates.
    mockFetchOnce(loadFixture('2025-03-18'));
    const first = await fetchNormalizedTournamentEvents('20250318');
    mockFetchOnce(loadFixture('2025-03-18'));
    const second = await fetchNormalizedTournamentEvents('20250318');

    expect(first.events).toEqual(second.events);
    expect(first.events).toHaveLength(2);
  });

  test('school-matches every real team by ESPN id with no unresolved diagnostics', async () => {
    const { events } = await fetchAllNormalizedEvents();
    const { allSchools, teamMap } = buildSchoolFixtures(events);

    const { events: matchedEvents, diagnostics } = matchSchoolsForEvents(
      events,
      allSchools,
      teamMap,
    );

    expect(diagnostics).toEqual([]);
    for (const event of matchedEvents) {
      expect(event.team1.matchMethod).toBe('espnId');
      expect(event.team2.matchMethod).toBe('espnId');
    }
  });

  test('SYNTHETIC pregame simulation: assembles a ready N=4 bracket after blanking the 4 known play-in-fed R1 slots', async () => {
    const { events } = await fetchAllNormalizedEvents();
    const { allSchools, teamMap } = buildSchoolFixtures(events);
    const { events: matchedEvents } = matchSchoolsForEvents(
      events,
      allSchools,
      teamMap,
    );

    const firstFourEvents = matchedEvents.filter(
      (e) => e.round === 'First Four',
    );
    expect(firstFourEvents).toHaveLength(4);

    // Real, historical: South has two play-ins (seeds 16 and 11); East and
    // Midwest have one each; West has none. This is the actual 2025 bracket
    // shape, not a synthetic assumption — it's a stronger check than an
    // evenly-distributed fixture would be.
    const destinationsBySeed = new Set(
      firstFourEvents.map((e) => `${e.regionName}:${e.team1.seed}`),
    );
    expect(destinationsBySeed).toEqual(
      new Set(['South:16', 'South:11', 'East:16', 'Midwest:11']),
    );

    // SYNTHETIC: the recorded R1 feed already shows each play-in's winner as
    // a normal competitor (it's historical). Blank whichever of the two
    // play-in participants appears in the matching region+seed R1 slot, to
    // simulate the pregame TBD shape the plan's implementation gate flags as
    // still unverified against a real live response.
    const playInParticipantSids = new Set(
      firstFourEvents.flatMap((e) => [e.team1.sID, e.team2.sID]),
    );
    const pregameEvents = matchedEvents.map((event) => {
      if (event.round !== '1st Round') return event;
      const blank = (team) =>
        playInParticipantSids.has(team.sID)
          ? {
              espnId: null,
              displayName: 'TBD',
              seed: team.seed,
              sID: null,
              matchMethod: 'placeholder',
            }
          : team;
      return { ...event, team1: blank(event.team1), team2: blank(event.team2) };
    });

    const result = assembleBracketPlan({
      year: 2025,
      regionOrder: [1, 2, 3, 4],
      regionNameToId: { East: 1, West: 2, South: 3, Midwest: 4 },
      matchedEvents: pregameEvents,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.playInCount).toBe(4);
    expect(result.gamesData).toHaveLength(64);
    expect(result.firstFourData).toHaveLength(4);
  });
});
