// Phase 5 (end-to-end compatibility review) of
// docs/plans/espn-tournament-creation-2026-09-20.md: proves data produced by
// the ESPN pipeline (Phase 1's pure assembler) survives, unchanged, through
// the atomic creation contract (Phase 2) and the existing editor's balanced
// diff (Phase 3) — the three phases were built and tested independently, in
// separate branches; this is the one test that exercises all three together
// against the same bracket data.

import { assembleBracketPlan } from '../src/services/bracketPlanService.js';
import {
  createNewBracket,
  updateBracket,
  setRepositories,
} from '../src/services/tourneyService.js';

const PAIRS = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];
const REGION_NAME_TO_ID = { East: 1, West: 2, South: 3, Midwest: 4 };
const REGION_ORDER = [1, 2, 3, 4];
const YEAR = 2027;

function makeTeam({ sID, seed, matchMethod = 'espnId' }) {
  if (matchMethod === 'placeholder') {
    return { espnId: null, displayName: 'TBD', seed, sID: null, matchMethod };
  }
  return {
    espnId: String(sID),
    displayName: `School ${sID}`,
    seed,
    sID,
    matchMethod,
  };
}

function makeRegionR1Events(regionName, regionID, skipSeeds = []) {
  return PAIRS.map(([lowSeed, highSeed], i) => ({
    espnEventId: `${regionName}-r1-${i}`,
    round: '1st Round',
    regionName,
    team1: skipSeeds.includes(lowSeed)
      ? makeTeam({ seed: lowSeed, matchMethod: 'placeholder' })
      : makeTeam({ sID: regionID * 100 + lowSeed, seed: lowSeed }),
    team2: skipSeeds.includes(highSeed)
      ? makeTeam({ seed: highSeed, matchMethod: 'placeholder' })
      : makeTeam({ sID: regionID * 100 + highSeed, seed: highSeed }),
    winner: null,
  }));
}

function makeFirstFourEvent({ espnEventId, regionName, seed, sidA, sidB }) {
  return {
    espnEventId,
    round: 'First Four',
    regionName,
    team1: makeTeam({ sID: sidA, seed }),
    team2: makeTeam({ sID: sidB, seed }),
    winner: null,
  };
}

// One play-in per region (seed 16 East/West, seed 11 South/Midwest) — 4 total,
// matching the plan's stated default and Phase 1's own golden-path fixture.
function buildEspnMatchedEvents() {
  const skips = { East: [16], West: [16], South: [11], Midwest: [11] };
  const events = [];
  let sid = 9000;
  for (const [regionName, regionID] of Object.entries(REGION_NAME_TO_ID)) {
    events.push(...makeRegionR1Events(regionName, regionID, skips[regionName]));
    const seed = skips[regionName][0];
    sid += 2;
    events.push(
      makeFirstFourEvent({
        espnEventId: `ff-${regionName}`,
        regionName,
        seed,
        sidA: sid - 1,
        sidB: sid,
      }),
    );
  }
  return events;
}

describe('ESPN pipeline -> atomic creation -> editor compatibility (Phase 5)', () => {
  test('assembler output creates via createBracketAtomic with the exact expected write shape', async () => {
    const plan = assembleBracketPlan({
      year: YEAR,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildEspnMatchedEvents(),
    });
    expect(plan.ready).toBe(true);
    expect(plan.playInCount).toBe(4);

    const repo = {
      getYearOccupancy: vi.fn().mockResolvedValue({ occupied: false }),
      createBracketAtomic: vi.fn().mockResolvedValue({ writeCount: 142 }),
    };
    setRepositories(repo, {}, {}, {});

    await createNewBracket(
      plan.gamesData,
      YEAR,
      REGION_ORDER,
      plan.firstFourData,
    );

    expect(repo.createBracketAtomic).toHaveBeenCalledTimes(1);
    const [call] = repo.createBracketAtomic.mock.calls[0];
    expect(call.year).toBe(YEAR);
    expect(call.regionIDs).toEqual([1, 2, 3, 4, 5, 6]);
    // 32 R1 games total; the 4 play-in-fed ones (both null in gamesData only
    // when BOTH slots are unresolved, which isn't the case here) still carry
    // one real team, so all 32 land in gamesWithTeams.
    expect(call.gamesWithTeams).toHaveLength(32);
    // 31 R2-through-championship shell games, never with teams at creation.
    expect(call.gamesWithoutTeams).toHaveLength(31);
    // 64 - 4 play-in-fed slots = 60 canonical R1 school records.
    expect(call.schoolRecords).toHaveLength(60);
    expect(call.firstFourGames).toHaveLength(4);
    expect(call.firstFourSchoolRecords).toHaveLength(8);
    expect(call.tournamentDocExtra).toEqual({
      hasFirstFour: true,
      firstFourGameCount: 4,
    });
  });

  test('an ESPN-created bracket with 4 unresolved play-ins submits unchanged through the editor as 0 additions / 0 removals', async () => {
    const plan = assembleBracketPlan({
      year: YEAR,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildEspnMatchedEvents(),
    });
    expect(plan.ready).toBe(true);

    // What getSchoolRecordsForYear would return right after creation: the 60
    // canonical R1 records createBracketAtomic wrote, keyed `${regionID}_${seed}`,
    // plus the 8 ff_* play-in participant records it also wrote.
    const canonicalRecords = [];
    for (const line of plan.gamesData) {
      const [regionID, , seed, sIDRaw] = line.split('-');
      if (!sIDRaw) continue; // play-in-fed slot — no canonical record yet
      canonicalRecords.push({
        sID: Number(sIDRaw),
        year: YEAR,
        seed: Number(seed),
        regionID: Number(regionID),
        docId: `${regionID}_${seed}`,
        canonicalDocId: null,
      });
    }
    const ffRecords = plan.firstFourData.flatMap((ff, i) => [
      {
        sID: ff.team1ID,
        year: YEAR,
        seed: ff.seed,
        regionID: null,
        docId: `ff_${64 + i}_1`,
        canonicalDocId: `x_${ff.seed}`,
      },
      {
        sID: ff.team2ID,
        year: YEAR,
        seed: ff.seed,
        regionID: null,
        docId: `ff_${64 + i}_2`,
        canonicalDocId: `x_${ff.seed}`,
      },
    ]);
    expect(canonicalRecords).toHaveLength(60);
    expect(ffRecords).toHaveLength(8);

    const repo = {
      getSchoolRecordsForYear: vi
        .fn()
        .mockResolvedValue([...canonicalRecords, ...ffRecords]),
      updateMultipleGamesWithTeams: vi.fn().mockResolvedValue(),
      updateMultipleSchoolRecords: vi.fn().mockResolvedValue(),
    };
    setRepositories(repo, {}, {}, {});

    // Resubmitting the exact same gamesData the assembler produced — the
    // admin changed nothing.
    const sIDChanges = await updateBracket(plan.gamesData, YEAR, REGION_ORDER);

    expect(sIDChanges).toEqual([]);
  });
});
