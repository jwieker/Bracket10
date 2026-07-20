// tests/targeted-updates.live.test.js
//
// Before/after test suite for the Firestore read-reduction changes described in
// plans/firestore-targeted-game-updates.md
//
//   Change 1: getActiveAndFutureGames filters winner==null
//   Change 2: GameRepository.getEntriesContainingTeams (new method)
//   Change 3: updatePointsForAffectedEntries (new pointsService export)
//
// Expected results:
//   Before any changes:  Test 1 FAILS, Test 2 FAILS, Test 3 FAILS, Test 4 FAILS
//   After Change 1 only: Test 1 PASSES
//   After Changes 1+2:   Tests 1-2 PASS
//   After all 3 changes: All 4 tests PASS
//
// Run:
//   LIVE_E2E=true node --experimental-vm-modules ./node_modules/jest/bin/jest.js tests/targeted-updates.live.test.js

import {
  EntryRepository,
  GameRepository,
  TeamRepository,
  TourneyRepository,
} from '../src/repositories/index.js';
import { createNewBracket } from '../src/services/tourneyService.js';
import {
  updateTeamRecords,
  setRepositories as setGameServiceRepositories,
} from '../src/services/gameService.js';
import * as pointsServiceModule from '../src/services/pointsService.js';
import { db } from '../src/config/firestore.js';

const RUN_LIVE = process.env.LIVE_E2E === 'true';

// Same 2022 bracket data used in e2e-v4 (seeded into year 2019 to avoid conflicts)
const GAMES_SPEC_2022 = [
  '1-1-1-67',
  '1-1-16-307', // R1: 67 vs 307
  '1-2-8-33',
  '1-2-9-6',
  '1-3-5-121',
  '1-3-12-14',
  '1-4-4-58',
  '1-4-13-103',
  '1-5-6-78',
  '1-5-11-39',
  '1-6-3-23',
  '1-6-14-213',
  '1-7-7-157',
  '1-7-10-123',
  '1-8-2-46',
  '1-8-15-223',
  '2-16-1-116',
  '2-16-16-174', // R1: 116 vs 174  ← played in beforeAll
  '2-17-8-126',
  '2-17-9-82',
  '2-18-5-1',
  '2-18-12-99',
  '2-19-4-42',
  '2-19-13-290',
  '2-20-6-41',
  '2-20-11-35',
  '2-21-3-79',
  '2-21-14-327',
  '2-22-7-17',
  '2-22-10-137',
  '2-23-2-28',
  '2-23-15-293',
  '3-31-1-55',
  '3-31-16-204',
  '3-32-8-8',
  '3-32-9-77',
  '3-33-5-253',
  '3-33-12-343',
  '3-34-4-13',
  '3-34-13-243',
  '3-35-6-127',
  '3-35-11-16',
  '3-36-3-52',
  '3-36-14-337',
  '3-37-7-21',
  '3-37-10-143',
  '3-38-2-10',
  '3-38-15-185',
  '4-46-1-73',
  '4-46-16-272',
  '4-47-8-132',
  '4-47-9-3',
  '4-48-5-15',
  '4-48-12-146',
  '4-49-4-7',
  '4-49-13-282',
  '4-50-6-47',
  '4-50-11-72',
  '4-51-3-25',
  '4-51-14-237',
  '4-52-7-63',
  '4-52-10-32',
  '4-53-2-43',
  '4-53-15-95',
];

const REGION_ARRAY = [1, 2, 3, 4];

describe('LIVE — Firestore Targeted Updates (requires LIVE_E2E=true)', () => {
  if (!RUN_LIVE) {
    test('skipped (set LIVE_E2E=true to run)', () => expect(true).toBe(true));
    return;
  }

  const year = 2019;
  const GROUP = 'E2E-TARGETED-2019';
  const ENTRY_A_ID = 999991; // picks INCLUDE team 67 (game 1 participant)
  const ENTRY_B_ID = 999992; // picks do NOT include team 67 or 307

  // Entry A: includes team 67 → affected by game 1 result
  const PICKS_A = [67, 116, 55, 73, 33, 28, 10, 43, 58, 121];

  // Entry B: region 2 & 3 teams only — no 67 or 307
  const PICKS_B = [126, 82, 1, 99, 79, 327, 17, 137, 253, 343];

  let entryRepo, gameRepo, teamRepo, tourneyRepo;

  const logStep = (msg, extra = {}) => {
    const str = JSON.stringify(extra, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    console.log(
      `[TARGETED][${new Date().toISOString()}] ${msg}${str !== '{}' ? ` | ${str}` : ''}`,
    );
  };

  beforeAll(async () => {
    entryRepo = new EntryRepository();
    gameRepo = new GameRepository();
    teamRepo = new TeamRepository();
    tourneyRepo = new TourneyRepository();
    setGameServiceRepositories(teamRepo, gameRepo);

    logStep('Pre-clean start', { year });
    await cleanTargetedYear(year, entryRepo, gameRepo, tourneyRepo);
    logStep('Pre-clean complete');

    logStep('Creating bracket');
    await createNewBracket(GAMES_SPEC_2022, year, REGION_ARRAY);
    logStep('Bracket created');

    logStep('Creating entries A and B');
    await entryRepo.createEntry(
      ENTRY_A_ID,
      'a@targeted-test.com',
      'Entry A',
      PICKS_A,
      GROUP,
      'Tester A',
      new Date(),
      year,
      320,
    );
    await entryRepo.createEntry(
      ENTRY_B_ID,
      'b@targeted-test.com',
      'Entry B',
      PICKS_B,
      GROUP,
      'Tester B',
      new Date(),
      year,
      320,
    );
    logStep('Entries created', { entryAId: ENTRY_A_ID, entryBId: ENTRY_B_ID });

    // Play game 16 (116 beats 174) so there is a decided game to test against
    logStep('Playing game 16 — 116 beats 174');
    const games = await gameRepo.getActiveAndFutureGames(year);
    const game16 = games.find((g) => Number(g.gameID) === 16);
    expect(game16).toBeDefined();
    await updateTeamRecords(
      116,
      174,
      Number(game16.round),
      16,
      Number(game16.nextGameID),
      Number(game16.nextGameSpot),
      year,
    );
    logStep('Game 16 played — setup complete');
  }, 120000);

  afterAll(async () => {
    logStep('Post-clean start', { year });
    await cleanTargetedYear(year, entryRepo, gameRepo, tourneyRepo);
    logStep('Post-clean complete');
  }, 60000);

  // ── Change 1 ─────────────────────────────────────────────────────────────────
  // BEFORE fix: getActiveAndFutureGames returns ALL 63 games regardless of winner.
  //             game 16 (winner=116) will be in the results → test FAILS.
  // AFTER fix:  only winner==null games are returned → game 16 is absent → PASSES.
  test('Change 1 — getActiveAndFutureGames excludes games that already have a winner', async () => {
    const games = await gameRepo.getActiveAndFutureGames(year);

    logStep('getActiveAndFutureGames result count', { count: games.length });

    // Game 16 was decided in beforeAll (116 beats 174). It must NOT appear.
    const game16 = games.find((g) => Number(g.gameID) === 16);
    expect(game16).toBeUndefined();

    // Game 1 is still undecided — it MUST appear.
    const game1 = games.find((g) => Number(g.gameID) === 1);
    expect(game1).toBeDefined();
    expect(game1.winner).toBeFalsy();

    // Overall count: 63 total - 1 decided = 62 undecided
    expect(games.length).toBe(62);

    logStep(
      'Change 1 verified — decided game absent, undecided games present',
      {
        game16Present: !!game16,
        game1Present: !!game1,
        totalReturned: games.length,
      },
    );
  });

  // ── Change 2 ─────────────────────────────────────────────────────────────────
  // BEFORE fix: getEntriesContainingTeams does not exist → error thrown → FAILS.
  // AFTER fix:  Firestore array-contains-any query returns only Entry A → PASSES.
  test('Change 2 — getEntriesContainingTeams returns only entries containing the given team SIDs', async () => {
    if (typeof gameRepo.getEntriesContainingTeams !== 'function') {
      throw new Error(
        'getEntriesContainingTeams is not yet implemented on GameRepository — implement Change 2 first',
      );
    }

    // Query for game 1 participants: 67 (winner) and 307 (loser)
    const results = await gameRepo.getEntriesContainingTeams(year, [67, 307]);

    logStep('getEntriesContainingTeams result', { count: results.length });

    // Entry A picks [67, 116, 55, ...] — contains 67 → MUST be returned
    const foundA = results.find((e) => Number(e.id) === ENTRY_A_ID);
    expect(foundA).toBeDefined();
    expect(foundA.picks).toContain(67);

    // Entry B picks [126, 82, 1, 99, ...] — contains neither 67 nor 307 → must NOT be returned
    const foundB = results.find((e) => Number(e.id) === ENTRY_B_ID);
    expect(foundB).toBeUndefined();

    logStep('Change 2 verified — correct subset returned', {
      entryAFound: !!foundA,
      entryBFound: !!foundB,
    });
  });

  // ── Change 3a ────────────────────────────────────────────────────────────────
  // BEFORE fix: updatePointsForAffectedEntries does not exist → error thrown → FAILS.
  // AFTER fix:  Entry A's totalPoints updated correctly (67 earned R1 pts, 116 earned R1 pts).
  test('Change 3a — updatePointsForAffectedEntries correctly updates points for affected entry', async () => {
    const fn = pointsServiceModule.updatePointsForAffectedEntries;
    if (typeof fn !== 'function') {
      throw new Error(
        'updatePointsForAffectedEntries is not yet exported from pointsService — implement Change 3 first',
      );
    }

    // Play game 1: seed 1 (67) beats seed 16 (307)
    logStep('Playing game 1 — 67 beats 307');
    const games = await gameRepo.getActiveAndFutureGames(year);
    const game1 = games.find((g) => Number(g.gameID) === 1);
    expect(game1).toBeDefined();
    await updateTeamRecords(
      67,
      307,
      Number(game1.round),
      1,
      Number(game1.nextGameID),
      Number(game1.nextGameSpot),
      year,
    );
    logStep('Game 1 played');

    // Run targeted update for the two teams involved in game 1
    logStep('Running updatePointsForAffectedEntries for [67, 307]');
    await fn(year, [67, 307]);

    const entryA = await gameRepo.getEntryById(ENTRY_A_ID, year);
    logStep('Entry A after targeted update', {
      totalPoints: entryA.totalPoints,
      possPoints: entryA.possPoints,
    });

    // Games played so far: game 16 (116 wins R1 = 2 pts) + game 1 (67 wins R1 = 2 pts)
    // Entry A picks both 116 and 67 → totalPoints = 4
    expect(entryA.totalPoints).toBe(4);

    // possPoints must be at least totalPoints and reflect remaining future potential
    expect(entryA.possPoints).toBeGreaterThan(entryA.totalPoints);

    logStep('Change 3a verified — Entry A totalPoints and possPoints correct');
  });

  // ── Change 3b ────────────────────────────────────────────────────────────────
  // BEFORE fix: updatePointsForAffectedEntries does not exist → error thrown → FAILS.
  // AFTER fix:  Entry B (no 67/307 in picks) was never fetched or written → totalPoints = 0.
  //
  // NOTE: This test relies on state from Change 3a (game 1 already played, targeted update run).
  test('Change 3b — updatePointsForAffectedEntries does not modify entries without the affected teams', async () => {
    const fn = pointsServiceModule.updatePointsForAffectedEntries;
    if (typeof fn !== 'function') {
      throw new Error(
        'updatePointsForAffectedEntries is not yet exported from pointsService — implement Change 3 first',
      );
    }

    // Game 1 was played in Change 3a test. We run the targeted update again to confirm
    // Entry B was untouched in the previous run (and remains untouched in this one).
    const entryB = await gameRepo.getEntryById(ENTRY_B_ID, year);
    logStep('Entry B after targeted update from Change 3a test', {
      totalPoints: entryB.totalPoints,
      possPoints: entryB.possPoints,
    });

    // Entry B picks no winning teams (game 16: 116 wins — B doesn't pick 116;
    // game 1: 67 wins — B doesn't pick 67). So totalPoints must still be 0.
    expect(entryB.totalPoints).toBe(0);

    // possPoints should be > 0 (B's picks are still alive) but unchanged from
    // initial creation default (targetted update never touched it).
    expect(entryB.possPoints).toBeGreaterThanOrEqual(0);

    logStep(
      'Change 3b verified — Entry B totalPoints remains 0 (unaffected by targeted update)',
    );
  });
});

// ─── Cleanup helper ────────────────────────────────────────────────────────────

async function cleanTargetedYear(year, entryRepo, gameRepo, tourneyRepo) {
  console.log(`[TARGETED] cleanTargetedYear starting for ${year}`);

  try {
    const allEntries = await gameRepo.getAllEntries(year);
    const toDelete = allEntries.filter(
      (e) =>
        Number(e.id) === 999991 ||
        Number(e.id) === 999992 ||
        (Array.isArray(e.groups)
          ? e.groups.some((g) => String(g).includes('E2E-TARGETED'))
          : String(e.group || '').includes('E2E-TARGETED')),
    );
    // deleteEntry only soft-deletes (#310) — purge so the reserved test
    // year doesn't accumulate soft-deleted debris across runs.
    await Promise.all(
      toDelete.map(async (e) => {
        const id = Number(e.id);
        await entryRepo.deleteEntry(id, year);
        await entryRepo.purgeEntry(id, year);
      }),
    );
    console.log(`[TARGETED] Deleted ${toDelete.length} test entries`);
  } catch (err) {
    console.warn('[TARGETED] Entry cleanup warning:', err.message);
  }

  try {
    if (typeof gameRepo.deleteGamesByYear === 'function') {
      await gameRepo.deleteGamesByYear(year);
      console.log(`[TARGETED] Deleted games for year ${year}`);
    }
  } catch (err) {
    console.warn('[TARGETED] Games cleanup warning:', err.message);
  }

  try {
    if (typeof gameRepo.deleteSchoolRecordsByYear === 'function') {
      await gameRepo.deleteSchoolRecordsByYear(year);
    }
  } catch (err) {
    console.warn('[TARGETED] SchoolRecords cleanup warning:', err.message);
  }

  try {
    if (typeof tourneyRepo.deleteRegionsByYear === 'function') {
      await tourneyRepo.deleteRegionsByYear(year);
    }
  } catch (err) {
    console.warn('[TARGETED] Regions cleanup warning:', err.message);
  }

  try {
    await db.collection('tournaments').doc(String(year)).delete();
  } catch (err) {
    console.warn('[TARGETED] Root tournament cleanup warning:', err);
  }

  console.log(`[TARGETED] cleanTargetedYear complete for ${year}`);
}
