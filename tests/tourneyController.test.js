import fs from 'fs';
import path from 'path';
import {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  setupNewTourney,
  createTournament,
  pollEspnScheduled,
  espnTournamentSetupPage,
  previewEspnTournamentPlan,
  createTournamentFromEspn,
} from '../src/controllers/tourneyController.js';

vi.mock('../src/services/index.js', () => ({
  prepareRegionVerifyData: vi.fn(),
  prepareNewTournamentData: vi.fn(),
  createNewBracket: vi.fn(),
  updateBracket: vi.fn(),
  updateEntrywithNewSchools: vi.fn(),
  deleteTournament: vi.fn(),
  getTournamentData: vi.fn(),
  buildEspnBracketPlan: vi.fn(),
}));

vi.mock('../src/repositories/index.js', () => ({
  gameRepository: { getAllTournamentDetails: vi.fn() },
  tourneyRepository: { getAllRegionTypes: vi.fn() },
}));

// Mock module for module-based function that imports JSON
vi.mock('../src/services/espnService.js', () => ({
  fetchScheduledTournamentGames: vi.fn(),
  loadTeamMap: vi.fn(),
}));

import {
  prepareRegionVerifyData,
  prepareNewTournamentData,
  createNewBracket,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
  buildEspnBracketPlan,
} from '../src/services/index.js';
import {
  gameRepository,
  tourneyRepository,
} from '../src/repositories/index.js';
import {
  fetchScheduledTournamentGames,
  loadTeamMap,
} from '../src/services/espnService.js';
import { ServiceError } from '../src/utils/errors.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('regionVerify', () => {
  test('parses four region numbers and calls prepareRegionVerifyData', async () => {
    prepareRegionVerifyData.mockResolvedValue({ teams: [], games: [] });
    const req = {
      body: {
        region0: '1',
        region1: '2',
        region2: '3',
        region3: '4',
        year: '2024',
      },
      method: 'POST',
      url: '/regionVerify',
    };
    const res = mockRes();
    await regionVerify(req, res);
    expect(prepareRegionVerifyData).toHaveBeenCalledWith([1, 2, 3, 4], 2024);
    expect(res.render).toHaveBeenCalledWith(
      'newTourneyGames',
      expect.objectContaining({ year: 2024 }),
    );
  });
});

describe('gamesVerify', () => {
  test('calls createNewBracket and returns 200', async () => {
    createNewBracket.mockResolvedValue();
    const req = {
      body: { year: '2024', region: '1,2,3,4', games: [{ id: 1 }] },
      method: 'POST',
      url: '/gamesVerify',
    };
    const res = mockRes();
    await gamesVerify(req, res);
    expect(createNewBracket).toHaveBeenCalledWith(
      [{ id: 1 }],
      2024,
      [1, 2, 3, 4],
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'New Bracket Created Successfully',
    });
  });

  // ── The region list gamesVerify now validates (#635) ──────────────────────
  //
  // This handler reaches the same whole-bracket write createTournament does,
  // from the same comma-joined "region" field tournamentUpdate parses — and
  // was the only one of the three with no check on it. Every case below
  // reached createNewBracket with a 200 before the guard.

  test('rejects a short quadrant list instead of writing a partial bracket', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '1,2,3', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    // Previously: 200, with the fourth quadrant's R2-and-up games never
    // written — an incomplete bracket the points engine then reads.
    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error', field: 'region' }),
    );
  });

  test('rejects a valid-count list with a region id outside the 1-4 quadrant range', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '1,2,3,5', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a valid-count list with region id 0, below the quadrant range', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '0,1,2,3', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a duplicated quadrant instead of writing one twice and one never', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '1,1,3,4', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a non-numeric region id instead of persisting regionID NaN', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '1,2,South,4', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    // Firestore stores NaN as a valid double, so the old path wrote that
    // quadrant's games under a region id that fails every later comparison
    // used to find them again — the same failure mode #591 closed on the
    // First Four fields.
    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects the pseudo-region list tournamentUpdate deliberately accepts', async () => {
    // The edit view posts "1,2,3,4,5,6" and tournamentUpdate filters 5/6 out
    // (see its own tests below). The create flow never legitimately sends
    // them — createNewBracketStructure appends the Final Four/Championship
    // rows itself — so here the same input is a 400. This asymmetry is the
    // reason the two guards must not be merged into one shared helper.
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '1,2,3,4,5,6', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects a missing or non-array games field as a 400, not a generic 500', async () => {
    // createNewBracketStructure reads gamesData.length immediately, so an
    // omitted field was a TypeError landing in controllerWrapper's generic
    // branch — nothing written, but a 500 that told the admin nothing.
    for (const games of [undefined, null, '1-1-1-23', {}]) {
      createNewBracket.mockClear();
      const body = { year: '2024', region: '1,2,3,4' };
      if (games !== undefined) body.games = games;

      const res = mockRes();
      await gamesVerify({ body, method: 'POST', url: '/gamesVerify' }, res);

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation Error', field: 'games' }),
      );
    }
  });

  test('still accepts the quadrant list in the order the admin chose', async () => {
    // The guard must not narrow the happy path: regionVerify renders the four
    // selects in whatever order the admin picked, and newTourneyGames.ejs
    // posts that order back verbatim (a non-ascending list is normal, not a
    // corruption signal).
    createNewBracket.mockResolvedValue();
    const res = mockRes();
    await gamesVerify(
      {
        body: { year: '2024', region: '3,1,4,2', games: [{ id: 1 }] },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(createNewBracket).toHaveBeenCalledWith(
      [{ id: 1 }],
      2024,
      [3, 1, 4, 2],
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('does not leak the raw region field into the error message', async () => {
    const res = mockRes();
    await gamesVerify(
      {
        body: {
          year: '2024',
          region: '<script>alert(1)</script>',
          games: [{ id: 1 }],
        },
        method: 'POST',
        url: '/gamesVerify',
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const { message } = res.json.mock.calls[0][0];
    expect(message).not.toContain('script');
  });
});

describe('viewTournament', () => {
  test('fetches tournament details and renders editTourneyGames', async () => {
    gameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [{ gameID: 1 }],
      regions: [{ regionID: 1 }, { regionID: 2 }],
    });
    prepareRegionVerifyData.mockResolvedValue({ teams: [] });

    const req = {
      body: { year: '2024' },
      method: 'POST',
      url: '/viewTournament',
    };
    const res = mockRes();
    await viewTournament(req, res);

    expect(gameRepository.getAllTournamentDetails).toHaveBeenCalledWith(2024);
    expect(prepareRegionVerifyData).toHaveBeenCalledWith([1, 2], 2024);
    expect(res.render).toHaveBeenCalledWith(
      'editTourneyGames',
      expect.objectContaining({
        year: 2024,
        existingGames: [{ gameID: 1 }],
      }),
    );
  });
});

describe('tournamentUpdate', () => {
  // Body shape must match what editTourneyGames.ejs actually posts: a single
  // comma-joined "region" hidden field, NOT region0..region3 (issue #371).
  test('calls updateBracket and updateEntrywithNewSchools, returns 200', async () => {
    updateBracket.mockResolvedValue({ old: 1, new: 2 });
    updateEntrywithNewSchools.mockResolvedValue();
    const req = {
      body: { year: '2024', region: '1,2,3,4', games: [] },
      method: 'POST',
      url: '/tournamentUpdate',
    };
    const res = mockRes();
    await tournamentUpdate(req, res);
    expect(updateBracket).toHaveBeenCalledWith([], 2024, [1, 2, 3, 4]);
    expect(updateEntrywithNewSchools).toHaveBeenCalledWith(
      { old: 1, new: 2 },
      2024,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('never passes NaN regionIDs to updateBracket from the real form field shape', async () => {
    updateBracket.mockResolvedValue({});
    updateEntrywithNewSchools.mockResolvedValue();
    const req = {
      body: { year: '2024', region: '1,2,3,4', games: [] },
      method: 'POST',
      url: '/tournamentUpdate',
    };
    await tournamentUpdate(req, mockRes());
    const regionArg = updateBracket.mock.calls[0][2];
    expect(regionArg).toHaveLength(4);
    expect(regionArg.every(Number.isFinite)).toBe(true);
    expect(updateBracket).toHaveBeenCalledTimes(1);
  });

  test('strips Final Four/Championship pseudo-regions (5, 6) from the posted region list', async () => {
    updateBracket.mockResolvedValue({});
    updateEntrywithNewSchools.mockResolvedValue();
    // viewTournament renders all region docs into the hidden field, so the
    // edit form posts "1,2,3,4,5,6" — updateBracket must only see the
    // quadrants. gamesVerify rejects this same input (#635): the create flow
    // never sends 5/6, so the two guards are deliberately different and a
    // refactor that collapses them into one helper breaks one of these two
    // tests.
    const req = {
      body: { year: '2024', region: '1,2,3,4,5,6', games: [] },
      method: 'POST',
      url: '/tournamentUpdate',
    };
    await tournamentUpdate(req, mockRes());
    expect(updateBracket).toHaveBeenCalledWith([], 2024, [1, 2, 3, 4]);
    expect(updateBracket).toHaveBeenCalledTimes(1);
  });

  test('rejects a partial or duplicated quadrant list without calling updateBracket', async () => {
    for (const region of ['1,2', '1,1,2,3', 'a,b,c,d', '5,6']) {
      updateBracket.mockClear();
      const req = {
        body: { year: '2024', region, games: [] },
        method: 'POST',
        url: '/tournamentUpdate',
      };
      const res = mockRes();
      await tournamentUpdate(req, res);
      expect(updateBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('rejects a missing or non-array games field as a 400, not a generic 500', async () => {
    // Nothing was written without this guard either — updateBracket's
    // school-change balance check rejects a non-array downstream — so this
    // pins the status code and field name, not a write. The 500 it replaces
    // named no field at all.
    for (const games of [undefined, null, 'abcd', {}]) {
      updateBracket.mockClear();
      const body = { year: '2024', region: '1,2,3,4' };
      if (games !== undefined) body.games = games;

      const res = mockRes();
      await tournamentUpdate(
        { body, method: 'POST', url: '/tournamentUpdate' },
        res,
      );

      expect(updateBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation Error', field: 'games' }),
      );
    }
  });
});

describe('deleteTournamentHandler', () => {
  test('calls deleteTournament and returns 200 with year in message', async () => {
    deleteTournament.mockResolvedValue();
    const req = {
      body: { year: '2024' },
      method: 'POST',
      url: '/deleteTournament',
    };
    const res = mockRes();
    await deleteTournamentHandler(req, res);
    expect(deleteTournament).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Tournament for 2024 deleted successfully',
    });
  });
});

// ── setupNewTourney / createTournament (#593) ───────────────────────────────
//
// These two handlers had no assertions at all. Fixtures below mirror the two
// *different* wire formats the routes actually receive, because the coercion
// each handler performs only makes sense against the real shape:
//
//   /setupNewTourney  — plain HTML form post (adminTournament.ejs:26,
//                       updater.ejs:129) → urlencoded → `year` is a string.
//   /createTournament — fetch() with Content-Type: application/json
//                       (newTourneyComplete.ejs:686-689) → numbers stay
//                       numbers and the FF checkbox is a real boolean.
//
// Note that contradicts the framing in #593 item 5: this route is JSON, not
// urlencoded (src/config/app.js:61-62 documents the same split), so the
// shipped admin form does *not* send the string 'true'. The string case is
// still pinned below, but as the shape a non-JSON caller would produce.

// A real /createTournament payload is a *complete* bracket, not a sample: 64
// R1 slot strings (32 games x 2 slots), one per <select> the admin form
// renders. School ids come from the real 2022 field in
// data/seed/schoolRecord.2022.json — the same seed fixtures
// integration.test.js reads — rather than being invented, so what these tests
// hand the controller is the shape production hands it.
//
// The bracket topology is defined in three places that have to agree. These
// constants mirror them, and `describe('bracket payload fixtures')` below
// fails if the fixture drifts from the gameID scheme:
//   views/newTourneyComplete.ejs:193-194  r1Seeds / r1Offsets (DOM emit order)
//   views/newTourneyComplete.ejs:297-305  R1_GAME_RANGES / R1_SEED_MATCHUPS
//   src/services/tourneyService.js:36-41  the gameID scheme comment

const seedDir = path.join(process.cwd(), 'data/seed');

function readNdjson(file) {
  return fs
    .readFileSync(path.join(seedDir, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => JSON.parse(line));
}

const FIELD_2022 = readNdjson('schoolRecord.2022.json');
const ALL_SCHOOLS = readNdjson('school.json');
const ALL_REGION_TYPES = readNdjson('regionID.json');
const ALL_CONFERENCES = readNdjson('conferences.json');

// "regionID_seed" -> the real sID holding that slot in the 2022 field.
const SID_BY_SLOT = new Map(
  FIELD_2022.map((r) => [`${r.regionID}_${r.seed}`, r.sID]),
);

const BRACKET_REGION_IDS = [1, 2, 3, 4]; // East, West, South, Midwest
const R1_GAME_ID_OFFSETS = [0, 15, 30, 45]; // R1 = 1-8, 16-23, 31-38, 46-53
const R1_SEED_MATCHUPS = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];
const R1_SLOT_COUNT = 64; // 32 games x 2 team slots
const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

// One string per R1 <select>, in the DOM order newTourneyComplete.ejs:642-652
// pushes them (region slot, then game, then team1/team2):
//   `${regionID}-${gameID}-${seed}-${teamSID}`
// A slot the admin marks "FF slot" submits with a blank teamSID. That trailing
// "-" is load-bearing, not cosmetic: createNewBracketStructure reads the empty
// string as null and skips the school record for it
// (tourneyService.js:281-283), which is how a First Four winner's slot stays
// empty until the play-in resolves.
function buildR1Games(ffFedSlots = []) {
  const fed = new Set(ffFedSlots.map((s) => `${s.gameID}_${s.seed}`));
  const games = [];
  BRACKET_REGION_IDS.forEach((regionID, regIdx) => {
    for (let i = 1; i <= 8; i++) {
      const gameID = i + R1_GAME_ID_OFFSETS[regIdx];
      for (const seed of R1_SEED_MATCHUPS[i - 1]) {
        const sID = fed.has(`${gameID}_${seed}`)
          ? ''
          : SID_BY_SLOT.get(`${regionID}_${seed}`);
        games.push(`${regionID}-${gameID}-${seed}-${sID}`);
      }
    }
  });
  return games;
}

// The play-in schools: real rows from data/seed/school.json, deliberately
// disjoint from the 64 in the field, because the First Four teams are the
// 65th-68th entrants. Eight games' worth is the controller's documented
// ceiling (parsePositiveInt max: 8); the first four are the realistic set.
//
// Shape of a real First Four: play-ins sit at the 16 line and the 11/12 line,
// and in every standard matchup ([1,16], [6,11], [5,12]) the play-in seed is
// the *second* of the pair — so nextGameSpot is 2 for all of them. That is a
// property of the bracket, not a shortcut in the fixture.
const FIRST_FOUR_GAMES = [
  { team1ID: 2, team2ID: 4, seed: 16, nextGameID: 1, nextGameSpot: 2 },
  { team1ID: 5, team2ID: 9, seed: 16, nextGameID: 16, nextGameSpot: 2 },
  { team1ID: 11, team2ID: 12, seed: 11, nextGameID: 35, nextGameSpot: 2 },
  { team1ID: 18, team2ID: 19, seed: 11, nextGameID: 50, nextGameSpot: 2 },
  // Rows 5-8 exist only to exercise the firstFourCount ceiling; same real
  // schools-not-in-the-field rule, targeting the 12 line (game 3 of each
  // region, the [5, 12] matchup).
  { team1ID: 20, team2ID: 22, seed: 12, nextGameID: 3, nextGameSpot: 2 },
  { team1ID: 24, team2ID: 26, seed: 12, nextGameID: 18, nextGameSpot: 2 },
  { team1ID: 27, team2ID: 29, seed: 12, nextGameID: 33, nextGameSpot: 2 },
  { team1ID: 30, team2ID: 31, seed: 12, nextGameID: 48, nextGameSpot: 2 },
];

// The R1 slots a set of play-in games feed, and therefore the slots that post
// with a blank teamSID in the same request.
function ffFedSlotsFor(count) {
  return FIRST_FOUR_GAMES.slice(0, count).map((g) => ({
    gameID: g.nextGameID,
    seed: g.seed,
  }));
}

const FF_FED_SLOTS = ffFedSlotsFor(4);

// The flat ff_* body keys the form posts for row i (newTourneyComplete.ejs:671-675).
function firstFourRowFields(i) {
  const g = FIRST_FOUR_GAMES[i];
  return {
    [`ff_team1_${i}`]: g.team1ID,
    [`ff_team2_${i}`]: g.team2ID,
    [`ff_seed_${i}`]: g.seed,
    [`ff_nextGame_${i}`]: g.nextGameID,
    [`ff_nextGameSpot_${i}`]: g.nextGameSpot,
  };
}

function createTournamentBody({ ffFedSlots = [], ...overrides } = {}) {
  return {
    year: 2026,
    regions: BRACKET_REGION_IDS,
    games: buildR1Games(ffFedSlots),
    ...overrides,
  };
}

// `rowCount` is how many ff_* row groups the body actually carries; it is
// passed separately from `firstFourCount` so a body can declare more rows than
// it has (the #591 shape).
function firstFourBody({ rowCount = 4, ...rest } = {}) {
  const rows = {};
  for (let i = 0; i < rowCount; i++) Object.assign(rows, firstFourRowFields(i));
  return createTournamentBody({
    // The blanked R1 slots track the rows the body carries, so the two halves
    // of the payload stay consistent with each other; where a test needs them
    // to disagree, it is `firstFourCount` that differs, which is the thing
    // under test.
    ffFedSlots: ffFedSlotsFor(rowCount),
    includeFirstFour: true,
    ...rows,
    ...rest,
  });
}

function reqFor(body, url) {
  return { body, method: 'POST', url };
}

// prepareNewTournamentData()'s real return shape: the four bracket regions
// (5/6 filtered out, tourneyService.js:586-588), every school ordered by name
// (hierarchicalRepository.js:105), every conference, and the seed order.
const NEW_TOURNAMENT_DATA = {
  allRegionTypes: ALL_REGION_TYPES.filter(
    (r) => r.regionID >= 1 && r.regionID <= 4,
  ).sort((a, b) => a.regionID - b.regionID),
  allTeams: [...ALL_SCHOOLS].sort((a, b) => a.name.localeCompare(b.name)),
  conferences: ALL_CONFERENCES,
  seeds: SEED_ORDER,
};

// The fixtures above are only worth anything if they match the real bracket.
// These assert that, so a drift in the seed data or the topology surfaces here
// rather than as a confusing failure inside a controller test.
describe('bracket payload fixtures', () => {
  test('the games payload is a complete 64-slot R1 bracket', () => {
    const games = buildR1Games();
    expect(games).toHaveLength(R1_SLOT_COUNT);
    expect(new Set(games).size).toBe(R1_SLOT_COUNT);

    const gameIDs = [...new Set(games.map((g) => Number(g.split('-')[1])))];
    expect(gameIDs).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8],
      ...[16, 17, 18, 19, 20, 21, 22, 23],
      ...[31, 32, 33, 34, 35, 36, 37, 38],
      ...[46, 47, 48, 49, 50, 51, 52, 53],
    ]);

    // Every one of the 64 field slots is filled with the real school that held
    // it in 2022, and each school appears exactly once.
    const sIDs = games.map((g) => Number(g.split('-')[3]));
    expect(sIDs.every(Number.isInteger)).toBe(true);
    expect(new Set(sIDs).size).toBe(R1_SLOT_COUNT);
    expect(new Set(sIDs)).toEqual(new Set(FIELD_2022.map((r) => r.sID)));
  });

  test('each region posts all 16 seeds exactly once', () => {
    const games = buildR1Games();
    for (const regionID of BRACKET_REGION_IDS) {
      const seeds = games
        .filter((g) => Number(g.split('-')[0]) === regionID)
        .map((g) => Number(g.split('-')[2]));
      expect(seeds).toHaveLength(16);
      expect([...seeds].sort((a, b) => a - b)).toEqual(
        [...SEED_ORDER].sort((a, b) => a - b),
      );
    }
  });

  test('a First Four slot posts with a blank teamSID and nothing else does', () => {
    const games = buildR1Games(FF_FED_SLOTS);
    const blank = games.filter((g) => g.endsWith('-'));
    expect(blank).toHaveLength(FF_FED_SLOTS.length);
    expect(blank).toEqual(['1-1-16-', '2-16-16-', '3-35-11-', '4-50-11-']);
  });

  test('play-in schools are real and are not already in the field', () => {
    const realSIDs = new Set(ALL_SCHOOLS.map((s) => s.sid));
    const fieldSIDs = new Set(FIELD_2022.map((r) => r.sID));
    const playIn = FIRST_FOUR_GAMES.flatMap((g) => [g.team1ID, g.team2ID]);

    expect(new Set(playIn).size).toBe(playIn.length);
    for (const sID of playIn) {
      expect(realSIDs.has(sID)).toBe(true);
      expect(fieldSIDs.has(sID)).toBe(false);
    }
  });

  test('every First Four game feeds a real R1 game at the seed that game holds', () => {
    for (const g of FIRST_FOUR_GAMES) {
      const regIdx = R1_GAME_ID_OFFSETS.findIndex(
        (off) => g.nextGameID > off && g.nextGameID <= off + 8,
      );
      expect(regIdx).toBeGreaterThanOrEqual(0);
      const matchup =
        R1_SEED_MATCHUPS[g.nextGameID - R1_GAME_ID_OFFSETS[regIdx] - 1];
      expect(matchup).toContain(g.seed);
      // The play-in seed is always the second of its matchup pair.
      expect(matchup[g.nextGameSpot - 1]).toBe(g.seed);
    }
  });
});

describe('setupNewTourney', () => {
  test('renders newTourneyComplete with the parsed year and the service payload spread', async () => {
    prepareNewTournamentData.mockResolvedValue(NEW_TOURNAMENT_DATA);

    const res = mockRes();
    // String year: this route is reached from a urlencoded form post.
    await setupNewTourney(reqFor({ year: '2026' }, '/setupNewTourney'), res);

    expect(prepareNewTournamentData).toHaveBeenCalledWith();
    // Exact match, not objectContaining — the view reads every one of these
    // locals, and EJS throws on an undefined local, so a dropped key from the
    // spread is a 500 on the page rather than a soft failure.
    expect(res.render).toHaveBeenCalledWith('newTourneyComplete', {
      year: 2026,
      ...NEW_TOURNAMENT_DATA,
    });

    // The view indexes straight into these, so their real dimensions matter:
    // 4 region <option>s, one <option> per school in all 64 dropdowns, and the
    // 16-seed order that lays out the 8 games per region.
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.allRegionTypes.map((r) => r.regionName)).toEqual([
      'East',
      'West',
      'South',
      'Midwest',
    ]);
    expect(rendered.allTeams).toHaveLength(ALL_SCHOOLS.length);
    expect(rendered.seeds).toEqual(SEED_ORDER);
  });

  test('rejects a bad year before calling the service', async () => {
    const res = mockRes();
    await setupNewTourney(
      reqFor({ year: 'not-a-year' }, '/setupNewTourney'),
      res,
    );

    expect(prepareNewTournamentData).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('createTournament', () => {
  beforeEach(() => {
    createNewBracket.mockResolvedValue();
  });

  test('passes firstFourData as null when the First Four box is unchecked', async () => {
    const res = mockRes();
    await createTournament(
      reqFor(
        createTournamentBody({ includeFirstFour: false }),
        '/createTournament',
      ),
      res,
    );

    expect(createNewBracket).toHaveBeenCalledWith(
      buildR1Games(),
      2026,
      [1, 2, 3, 4],
      null,
    );
    // The full bracket reaches the service untouched — all 64 slots, no slot
    // dropped or reordered on the way through the controller.
    expect(createNewBracket.mock.calls[0][0]).toHaveLength(R1_SLOT_COUNT);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Tournament created successfully',
    });
  });

  test('coerces region ids to numbers', async () => {
    const res = mockRes();
    await createTournament(
      reqFor(
        createTournamentBody({ regions: ['1', '2', '3', '4'] }),
        '/createTournament',
      ),
      res,
    );

    expect(createNewBracket.mock.calls[0][2]).toEqual([1, 2, 3, 4]);
  });

  test('maps ff_* fields into firstFourData in index order', async () => {
    const res = mockRes();
    await createTournament(
      reqFor(
        firstFourBody({ rowCount: 4, firstFourCount: 4 }),
        '/createTournament',
      ),
      res,
    );

    // The assertion #593 exists for: nothing else in the suite pins the loop's
    // index arithmetic or the field-name mapping between the ff_* body keys and
    // the firstFourData objects createFirstFourGames writes to Firestore.
    expect(createNewBracket.mock.calls[0][3]).toEqual(
      FIRST_FOUR_GAMES.slice(0, 4),
    );

    // And the four R1 slots those play-ins feed arrived blank in the same
    // request — the two halves of a First Four bracket have to agree, since a
    // filled slot plus a play-in feeding it would double-book the game.
    const games = createNewBracket.mock.calls[0][0];
    expect(games.filter((g) => g.endsWith('-'))).toHaveLength(4);
    for (const ff of FIRST_FOUR_GAMES.slice(0, 4)) {
      expect(games).toContain(
        `${BRACKET_REGION_IDS[R1_GAME_ID_OFFSETS.findIndex((off) => ff.nextGameID > off && ff.nextGameID <= off + 8)]}-${ff.nextGameID}-${ff.seed}-`,
      );
    }
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('builds exactly firstFourCount rows, ignoring extra ff_* rows in the body', async () => {
    const res = mockRes();
    // Six row groups present, but the count says 2 — only rows 0 and 1 are read.
    await createTournament(
      reqFor(
        firstFourBody({ rowCount: 6, firstFourCount: 2 }),
        '/createTournament',
      ),
      res,
    );

    expect(createNewBracket.mock.calls[0][3]).toEqual(
      FIRST_FOUR_GAMES.slice(0, 2),
    );
  });

  test('defaults firstFourCount to 4 when it is omitted', async () => {
    const res = mockRes();
    // parsePositiveInt's `defaultValue: 4` half of the contract.
    await createTournament(
      reqFor(firstFourBody({ rowCount: 4 }), '/createTournament'),
      res,
    );

    expect(createNewBracket.mock.calls[0][3]).toEqual(
      FIRST_FOUR_GAMES.slice(0, 4),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('rejects an out-of-range or non-numeric firstFourCount without creating a bracket', async () => {
    // parsePositiveInt(..., { defaultValue: 4, max: 8 }): 0 fails the positive
    // check, 9 exceeds max, 'abc' is not a number, -1 is negative.
    for (const firstFourCount of [0, 9, 'abc', -1, 2.5]) {
      createNewBracket.mockClear();
      const res = mockRes();
      await createTournament(
        reqFor(
          firstFourBody({ rowCount: 4, firstFourCount }),
          '/createTournament',
        ),
        res,
      );

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation Error',
          field: 'firstFourCount',
        }),
      );
    }
  });

  test('rejects a missing or non-array games field without creating a bracket', async () => {
    // Unlike the sibling handlers, this one corrupted without the guard, and
    // an even-length string is the shape that did it: createNewBracketStructure
    // tests gamesData.length % 2 and then calls gamesData[i].split('-'), both
    // of which a string satisfies. 'abcd' therefore passed every downstream
    // check and wrote rows with NaN regionID/gameID/seed and null team ids at
    // HTTP 200. 'abc' is the odd-length control: it was already rejected, but
    // by a length message naming gamesData rather than this field. Both must
    // now fail here, before createNewBracket is reached.
    for (const games of [undefined, null, 'abcd', 'abc', {}, 42]) {
      createNewBracket.mockClear();
      const body = createTournamentBody();
      if (games === undefined) delete body.games;
      else body.games = games;

      const res = mockRes();
      await createTournament(reqFor(body, '/createTournament'), res);

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation Error', field: 'games' }),
      );
    }
  });

  test('rejects a bad year without creating a bracket', async () => {
    for (const year of ['not-a-year', '', 1979, 2026.5]) {
      createNewBracket.mockClear();
      const res = mockRes();
      await createTournament(
        reqFor(createTournamentBody({ year }), '/createTournament'),
        res,
      );

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation Error', field: 'year' }),
      );
    }
  });

  // ── Characterization tests: these pin behavior that is arguably wrong ──────
  //
  // Both assert what the controller does *today*, not what it should do. They
  // are here because #593's whole point is that these lines execute untested,
  // and a defect nothing executes is a defect nothing can verify a fix for.
  // Each names the issue that would change it; when that issue is fixed, the
  // test is expected to fail and must be rewritten to the new contract rather
  // than deleted.

  // #591: these replace the CHARACTERIZATION test that pinned the old
  // NaN-persists-silently behavior. The swap-in it carried in a comment is now
  // the contract — a partial First Four fails the whole request.
  test('rejects a missing ff_ field instead of persisting NaN (#591)', async () => {
    // firstFourCount says 4, but the body only carries rows 0, 1 and 3 — the
    // stale/partial admin form #591 describes.
    const body = firstFourBody({ rowCount: 4, firstFourCount: 4 });
    delete body.ff_team1_2;

    const res = mockRes();
    await createTournament(reqFor(body, '/createTournament'), res);

    // Nothing is written: the throw happens while building firstFourData, so
    // the three well-formed games are not created either. That is the intent —
    // a half-specified First Four should not create a tournament at all.
    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        field: 'ff_team1_2',
      }),
    );
  });

  test('rejects every one of the five per-game fields when missing (#591)', async () => {
    // The whole class, not just team1ID: each field is the only one removed.
    for (const field of [
      'ff_team1_1',
      'ff_team2_1',
      'ff_seed_1',
      'ff_nextGame_1',
      'ff_nextGameSpot_1',
    ]) {
      vi.clearAllMocks();
      const body = firstFourBody({ rowCount: 4, firstFourCount: 4 });
      delete body[field];

      const res = mockRes();
      await createTournament(reqFor(body, '/createTournament'), res);

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field }));
    }
  });

  test('rejects out-of-range seed and nextGameSpot (#591)', async () => {
    // seed is bounded to the 16 lines of a region and nextGameSpot to the two
    // slots of an R1 game, so both carry a max. 0 is the value the admin form
    // produces for a blank seed input, which is why it is pinned explicitly.
    for (const [field, value] of [
      ['ff_seed_0', 0],
      ['ff_seed_0', 17],
      ['ff_nextGameSpot_0', 0],
      ['ff_nextGameSpot_0', 3],
    ]) {
      vi.clearAllMocks();
      const body = firstFourBody({ rowCount: 4, firstFourCount: 4 });
      body[field] = value;

      const res = mockRes();
      await createTournament(reqFor(body, '/createTournament'), res);

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field }));
    }
  });

  test('still accepts the real First Four payload unchanged (#591)', async () => {
    // The regression guard for the fix: valid input must be untouched by the
    // added validation, including seed 16 and nextGameSpot 2 at the bounds.
    createNewBracket.mockResolvedValue();
    const res = mockRes();
    await createTournament(
      reqFor(
        firstFourBody({ rowCount: 4, firstFourCount: 4 }),
        '/createTournament',
      ),
      res,
    );

    expect(createNewBracket.mock.calls[0][3]).toEqual(
      FIRST_FOUR_GAMES.slice(0, 4),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("CHARACTERIZATION: includeFirstFour as the string 'true' silently skips First Four creation", async () => {
    // Line :98 is a strict `=== true`. The shipped admin form posts JSON, so it
    // sends a real boolean and is unaffected; any urlencoded caller (a hand-built
    // form post, curl -d) sends 'true' and gets a bracket with no First Four
    // games and a 200 — no warning that the FF rows it submitted were dropped.
    const res = mockRes();
    await createTournament(
      reqFor(
        firstFourBody({
          rowCount: 4,
          firstFourCount: 4,
          includeFirstFour: 'true',
        }),
        '/createTournament',
      ),
      res,
    );

    expect(createNewBracket.mock.calls[0][3]).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // ── The region list createTournament now validates ────────────────────────
  //
  // `tournamentUpdate` has always guarded the identical list (:60-72), because
  // a partial one let it write an incomplete bracket and still return 200
  // (#371). The create path writes the whole bracket rather than editing one
  // game, so the same input reached strictly more writes with strictly less
  // checking. These were characterization tests pinning that gap; the guard is
  // now mirrored onto createTournament, so they assert the contract instead.
  //
  // Every case below reached `createNewBracket` with a 200 before the guard.

  test('rejects a non-numeric region id instead of writing NaN', async () => {
    const res = mockRes();
    // A complete, otherwise-valid bracket — only the third region id is junk,
    // which is what a stale or hand-built form posts.
    await createTournament(
      reqFor(
        createTournamentBody({ regions: ['1', '2', 'South', '4'] }),
        '/createTournament',
      ),
      res,
    );

    // Previously: 200, with all 64 R1 slots written against a region id that
    // fails every later comparison used to find them again — the NaN-persists
    // failure mode #591 closed on the First Four fields.
    expect(createNewBracket).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation Error', field: 'regions' }),
    );
  });

  test('rejects a region list that is not the four distinct quadrants', async () => {
    // The same shapes tournamentUpdate rejects: the six-entry list carrying the
    // Final Four/Championship pseudo-regions, a duplicated quadrant that leaves
    // one of the four unwritten, a short list, and ids outside 1-4.
    for (const regions of [
      [1, 2, 3, 4, 5, 6],
      [1, 1, 2, 3],
      [1, 2, 3],
      [0, 1, 2, 3],
      [1, 2, 3, 5],
    ]) {
      createNewBracket.mockClear();
      const res = mockRes();
      await createTournament(
        reqFor(createTournamentBody({ regions }), '/createTournament'),
        res,
      );

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('rejects a missing or non-array regions field as a 400, not a generic 500', async () => {
    // Previously :95 called .map on req.body.regions with no guard, so a
    // missing field was a TypeError landing in controllerWrapper's generic
    // branch — nothing written, but a 500 that told the admin nothing.
    for (const regions of [undefined, null, 'East,West,South,Midwest', 4]) {
      createNewBracket.mockClear();
      const body = createTournamentBody();
      if (regions === undefined) delete body.regions;
      else body.regions = regions;

      const res = mockRes();
      await createTournament(reqFor(body, '/createTournament'), res);

      expect(createNewBracket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  test('still accepts the real four-quadrant payload unchanged', async () => {
    // The guard must not narrow the happy path: the genuine 2022 bracket still
    // reaches the service with all 64 R1 slots and its region list intact.
    const res = mockRes();
    await createTournament(
      reqFor(createTournamentBody(), '/createTournament'),
      res,
    );

    expect(createNewBracket.mock.calls[0][2]).toEqual(BRACKET_REGION_IDS);
    expect(createNewBracket.mock.calls[0][0]).toHaveLength(R1_SLOT_COUNT);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('a failed createNewBracket returns 500 without naming the service', async () => {
    // The highest-consequence write in the app is also the one whose failure
    // message would be most tempting to surface. Firestore paths and service
    // names stay server-side unless DEBUG_ERRORS is explicitly on.
    delete process.env.DEBUG_ERRORS;
    createNewBracket.mockRejectedValue(
      new ServiceError(
        'write failed at tournaments/2026/schoolRecords',
        'tourneyService',
      ),
    );

    const res = mockRes();
    await createTournament(
      reqFor(
        firstFourBody({ rowCount: 4, firstFourCount: 4 }),
        '/createTournament',
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('service');
    expect(payload).toEqual({
      error: 'Service Error',
      message: 'A service error occurred.',
    });
  });
});

describe('pollEspnScheduled', () => {
  test('fetches games and resolves sIDs using teamMap', async () => {
    loadTeamMap.mockReturnValue({
      'Duke Blue Devils': 264,
      'Kansas Jayhawks': 2305,
    });
    fetchScheduledTournamentGames.mockResolvedValueOnce([
      {
        espnEventId: '1',
        team1DisplayName: 'Duke Blue Devils',
        team2DisplayName: 'Kansas Jayhawks',
      },
    ]);

    const req = {
      body: { date1: '20240321' },
      method: 'POST',
      url: '/pollEspnScheduled',
    };
    const res = mockRes();

    await pollEspnScheduled(req, res);

    expect(loadTeamMap).toHaveBeenCalled();
    expect(fetchScheduledTournamentGames).toHaveBeenCalledWith('20240321');
    expect(res.json).toHaveBeenCalledWith({
      games: [
        {
          espnEventId: '1',
          team1DisplayName: 'Duke Blue Devils',
          team2DisplayName: 'Kansas Jayhawks',
          team1SID: 264,
          team2SID: 2305,
        },
      ],
    });
  });

  test('handles missing team mapping gracefully', async () => {
    loadTeamMap.mockReturnValue({});
    fetchScheduledTournamentGames.mockResolvedValueOnce([
      {
        espnEventId: '2',
        team1DisplayName: 'Unknown Team',
        team2DisplayName: 'Another Unknown',
      },
    ]);

    const req = {
      body: { date1: '20240322' },
      method: 'POST',
      url: '/pollEspnScheduled',
    };
    const res = mockRes();

    await pollEspnScheduled(req, res);

    expect(res.json).toHaveBeenCalledWith({
      games: [
        {
          espnEventId: '2',
          team1DisplayName: 'Unknown Team',
          team2DisplayName: 'Another Unknown',
          team1SID: null,
          team2SID: null,
        },
      ],
    });
  });
});

describe('espnTournamentSetupPage', () => {
  beforeEach(() => {
    tourneyRepository.getAllRegionTypes.mockResolvedValue([
      { regionID: 1, regionName: 'East' },
      { regionID: 2, regionName: 'West' },
      { regionID: 3, regionName: 'South' },
      { regionID: 4, regionName: 'Midwest' },
      { regionID: 5, regionName: 'Final Four' },
      { regionID: 6, regionName: 'Championship' },
    ]);
  });

  test('renders the setup page with the requested year and the 4 bracket regions in canonical order', async () => {
    const req = { query: { year: '2027' }, method: 'GET', url: '/x' };
    const res = mockRes();
    await espnTournamentSetupPage(req, res);
    expect(res.render).toHaveBeenCalledWith('espnTournamentSetup', {
      year: 2027,
      bracketRegions: [
        { regionID: 1, regionName: 'East' },
        { regionID: 2, regionName: 'West' },
        { regionID: 3, regionName: 'South' },
        { regionID: 4, regionName: 'Midwest' },
      ],
    });
  });

  test('defaults to the current year when none is given', async () => {
    const req = { query: {}, method: 'GET', url: '/x' };
    const res = mockRes();
    await espnTournamentSetupPage(req, res);
    expect(res.render.mock.calls[0][1].year).toBe(new Date().getFullYear());
  });
});

const READY_PLAN = {
  ready: true,
  year: 2027,
  gamesData: ['1-1-1-10'],
  firstFourData: [],
  playInCount: 4,
  preview: { regions: [] },
  diagnostics: [],
  infoDiagnostics: [],
  fetchSummary: [{ date: '20270318', found: 2, excluded: 0 }],
};

function espnPlanBody(overrides = {}) {
  return {
    year: 2027,
    playInDates: ['20270318'],
    playInCounts: [4],
    r1Dates: ['20270320', '20270321'],
    expectedPlayInCount: 4,
    ...overrides,
  };
}

describe('previewEspnTournamentPlan', () => {
  beforeEach(() => {
    buildEspnBracketPlan.mockResolvedValue(READY_PLAN);
  });

  test('rejects a missing playInDates field before calling buildEspnBracketPlan', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({ playInDates: undefined }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test('rejects a tampered playInDates that is a string instead of an array', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({ playInDates: '20270318' }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test('rejects a malformed date entry', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({ playInDates: ['2027-03-18'] }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test('rejects a regionOrder with a duplicate region id', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({ regionOrder: [1, 1, 3, 4] }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test('passes the parsed input through and returns a compact response with no gamesData/firstFourData', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(espnPlanBody(), '/admin/tournament/espn-plan'),
      res,
    );

    expect(buildEspnBracketPlan).toHaveBeenCalledWith({
      year: 2027,
      playInDates: ['20270318'],
      playInCounts: [4],
      r1Dates: ['20270320', '20270321'],
      expectedPlayInCount: 4,
      regionOrder: [1, 2, 3, 4],
      ignoreResolvedPlayIns: false,
    });

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg).not.toHaveProperty('gamesData');
    expect(jsonArg).not.toHaveProperty('firstFourData');
    expect(jsonArg).toEqual({
      ready: true,
      year: 2027,
      playInCount: 4,
      preview: { regions: [] },
      diagnostics: [],
      infoDiagnostics: [],
      fetchSummary: [{ date: '20270318', found: 2, excluded: 0 }],
    });
  });
});

describe('createTournamentFromEspn', () => {
  beforeEach(() => {
    buildEspnBracketPlan.mockResolvedValue(READY_PLAN);
    createNewBracket.mockResolvedValue();
  });

  test('rejects when confirmPairings is not explicitly true, and never fetches ESPN data', async () => {
    const res = mockRes();
    await createTournamentFromEspn(
      reqFor(espnPlanBody(), '/createTournamentFromEspn'), // no confirmPairings
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
    expect(createNewBracket).not.toHaveBeenCalled();
  });

  test('rejects a truthy-but-not-boolean confirmPairings (e.g. tampered string "true")', async () => {
    const res = mockRes();
    await createTournamentFromEspn(
      reqFor(
        espnPlanBody({ confirmPairings: 'true' }),
        '/createTournamentFromEspn',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createNewBracket).not.toHaveBeenCalled();
  });

  test('rejects a tampered payload with an invalid region id, before any write', async () => {
    const res = mockRes();
    await createTournamentFromEspn(
      reqFor(
        espnPlanBody({ confirmPairings: true, regionOrder: [1, 2, 3, 99] }),
        '/createTournamentFromEspn',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
    expect(createNewBracket).not.toHaveBeenCalled();
  });

  test('refuses to create when the reassembled plan is not ready, even if the client claims it is', async () => {
    buildEspnBracketPlan.mockResolvedValue({
      ...READY_PLAN,
      ready: false,
      gamesData: null,
      firstFourData: null,
      diagnostics: [{ code: 'unresolved-team', message: 'x' }],
    });
    const res = mockRes();
    await createTournamentFromEspn(
      reqFor(
        espnPlanBody({ confirmPairings: true }),
        '/createTournamentFromEspn',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createNewBracket).not.toHaveBeenCalled();
  });

  test('reassembles server-side and creates using the freshly-built plan, not any client-supplied gamesData', async () => {
    const res = mockRes();
    await createTournamentFromEspn(
      reqFor(
        {
          ...espnPlanBody({ confirmPairings: true }),
          // A tampered client could try to smuggle its own gamesData/firstFourData
          // in the body — the controller must never read these fields at all.
          gamesData: ['9-9-9-9'],
          firstFourData: [{ team1ID: 1, team2ID: 2 }],
        },
        '/createTournamentFromEspn',
      ),
      res,
    );

    expect(buildEspnBracketPlan).toHaveBeenCalledWith({
      year: 2027,
      playInDates: ['20270318'],
      playInCounts: [4],
      r1Dates: ['20270320', '20270321'],
      expectedPlayInCount: 4,
      regionOrder: [1, 2, 3, 4],
      ignoreResolvedPlayIns: false,
    });
    expect(createNewBracket).toHaveBeenCalledWith(
      READY_PLAN.gamesData,
      READY_PLAN.year,
      [1, 2, 3, 4],
      READY_PLAN.firstFourData,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Tournament created successfully from ESPN',
      year: 2027,
      playInCount: 4,
    });
  });
});

describe('ESPN plan review boundary regressions', () => {
  beforeEach(() => {
    buildEspnBracketPlan.mockResolvedValue(READY_PLAN);
  });

  test.each([undefined, [], [0], [-1], [1.5], ['4'], [9], [2, 2]])(
    'rejects invalid per-day counts %j before fetching or writing',
    async (playInCounts) => {
      const res = mockRes();
      await createTournamentFromEspn(
        reqFor(
          espnPlanBody({ playInCounts, confirmPairings: true }),
          '/createTournamentFromEspn',
        ),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(buildEspnBracketPlan).not.toHaveBeenCalled();
      expect(createNewBracket).not.toHaveBeenCalled();
    },
  );

  test('rejects repeated play-in dates', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({
          playInDates: ['20270318', '20270318'],
          playInCounts: [2, 2],
        }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test('rejects a total over eight even when each daily count is valid', async () => {
    const res = mockRes();
    await previewEspnTournamentPlan(
      reqFor(
        espnPlanBody({
          playInDates: ['20270318', '20270319'],
          playInCounts: [5, 4],
        }),
        '/admin/tournament/espn-plan',
      ),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildEspnBracketPlan).not.toHaveBeenCalled();
  });

  test.each([true, false, undefined, 'true'])(
    'preview and create preserve pairings, counts and strict test-mode choice (%s)',
    async (ignoreResolvedPlayIns) => {
      const body = espnPlanBody({
        regionOrder: [1, 4, 2, 3],
        playInDates: ['20270318', '20270319'],
        playInCounts: [1, 3],
        expectedPlayInCount: 99,
        ignoreResolvedPlayIns,
      });
      await previewEspnTournamentPlan(
        reqFor(body, '/admin/tournament/espn-plan'),
        mockRes(),
      );
      await createTournamentFromEspn(
        reqFor({ ...body, confirmPairings: true }, '/createTournamentFromEspn'),
        mockRes(),
      );
      expect(buildEspnBracketPlan).toHaveBeenCalledTimes(2);
      expect(buildEspnBracketPlan.mock.calls[0][0]).toEqual(
        buildEspnBracketPlan.mock.calls[1][0],
      );
      expect(buildEspnBracketPlan.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          regionOrder: [1, 4, 2, 3],
          playInCounts: [1, 3],
          expectedPlayInCount: 4,
          ignoreResolvedPlayIns: ignoreResolvedPlayIns === true,
        }),
      );
      expect(createNewBracket).toHaveBeenCalledWith(
        READY_PLAN.gamesData,
        READY_PLAN.year,
        [1, 4, 2, 3],
        READY_PLAN.firstFourData,
      );
    },
  );
});
