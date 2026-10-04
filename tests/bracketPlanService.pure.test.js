import { assembleBracketPlan } from '../src/services/bracketPlanService.js';

// Mirrors the seed-pair order the assembler encodes internally (also used by
// newTourneyComplete.ejs / tourneyService.js elsewhere in the app).
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

// One region's 8 R1 events. `skipSeeds` marks which seed slots are TBD
// (play-in destinations) instead of a resolved school. Resolved sIDs follow
// `regionID*100+seed`, so expected gamesData strings are easy to predict.
function makeRegionR1Events(regionName, regionID, skipSeeds = []) {
  return PAIRS.map(([lowSeed, highSeed], i) => ({
    espnEventId: `${regionName}-r1-${i}`,
    round: '1st Round',
    regionName,
    eventDate: '2026-03-20T17:00Z',
    completed: false,
    team1: skipSeeds.includes(lowSeed)
      ? makeTeam({ seed: lowSeed, matchMethod: 'placeholder' })
      : makeTeam({ sID: regionID * 100 + lowSeed, seed: lowSeed }),
    team2: skipSeeds.includes(highSeed)
      ? makeTeam({ seed: highSeed, matchMethod: 'placeholder' })
      : makeTeam({ sID: regionID * 100 + highSeed, seed: highSeed }),
    winner: null,
  }));
}

function makeFirstFourEvent({
  espnEventId,
  regionName,
  seed,
  sidA,
  sidB,
  eventDate,
}) {
  return {
    espnEventId,
    round: 'First Four',
    regionName,
    eventDate,
    completed: false,
    team1: makeTeam({ sID: sidA, seed }),
    team2: makeTeam({ sID: sidB, seed }),
    winner: null,
  };
}

// Builds a full 4-region matchedEvents array. `skipsByRegion` marks which
// seeds are play-in destinations per region; a matching First Four event is
// auto-generated for each skip unless its `region:seed` key is listed in
// `omitFirstFourForSeeds`. `extraFirstFour` appends hand-built events.
function buildMatchedEvents({
  skipsByRegion = {},
  omitFirstFourForSeeds = [],
  extraFirstFour = [],
} = {}) {
  const events = [];
  let sidCounter = 9000;
  let ffCounter = 0;

  for (const [regionName, regionID] of Object.entries(REGION_NAME_TO_ID)) {
    const skips = skipsByRegion[regionName] ?? [];
    events.push(...makeRegionR1Events(regionName, regionID, skips));

    for (const seed of skips) {
      if (omitFirstFourForSeeds.includes(`${regionName}:${seed}`)) continue;
      ffCounter++;
      sidCounter += 2;
      events.push(
        makeFirstFourEvent({
          espnEventId: `ff-${regionName}-${seed}`,
          regionName,
          seed,
          sidA: sidCounter - 1,
          sidB: sidCounter,
          eventDate: `2026-03-18T${String(10 + ffCounter).padStart(2, '0')}:00Z`,
        }),
      );
    }
  }

  return [...events, ...extraFirstFour];
}

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

describe('assembleBracketPlan — golden path', () => {
  const skipsByRegion = { East: [16], West: [16], South: [11], Midwest: [11] };

  test('assembles a complete N=4 bracket', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.playInCount).toBe(4);
    expect(result.gamesData).toHaveLength(64);
    expect(result.firstFourData).toHaveLength(4);
  });

  test('R1 gamesData strings use region-gameID-seed-sID, empty sID for a play-in slot', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    // East is regionOrder position 0 -> block start 1; pair 0 is [1, 16].
    expect(result.gamesData[0]).toBe('1-1-1-101');
    expect(result.gamesData[1]).toBe('1-1-16-');
  });

  test('firstFourData points at the correct R1 gameID/spot, sorted by date then event id', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    // East's seed-16 play-in feeds region 1's gameID 1, slot 2 (16 is the high seed of pair 0).
    expect(result.firstFourData[0]).toEqual({
      team1ID: 9001,
      team2ID: 9002,
      seed: 16,
      nextGameID: 1,
      nextGameSpot: 2,
    });
  });

  test('preview reports the confirmed semifinal pairings by regionOrder position', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    expect(result.preview.semifinalPairings).toEqual([
      { gameID: 61, regions: [1, 2] },
      { gameID: 62, regions: [3, 4] },
    ]);
  });

  test('preview marks an empty R1 slot with its play-in matchup', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    const eastFirstPair = result.preview.regions[0].games[0];
    expect(eastFirstPair.team1).toEqual({
      sID: 101,
      seed: 1,
      displayName: 'School 101',
    });
    expect(eastFirstPair.team2.seed).toBe(16);
    expect(eastFirstPair.team2.playIn).toMatchObject({
      espnEventId: 'ff-East-16',
      team1: { sID: 9001 },
      team2: { sID: 9002 },
    });
  });
});

// ---------------------------------------------------------------------------
// Non-default region order
// ---------------------------------------------------------------------------

describe('assembleBracketPlan — non-default region order', () => {
  test('slot-to-game blocks and semifinal pairings follow regionOrder position, not regionID value', () => {
    const skipsByRegion = { South: [16] };
    const reorderedRegionOrder = [3, 4, 1, 2]; // South, Midwest, East, West

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: reorderedRegionOrder,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: buildMatchedEvents({ skipsByRegion }),
    });

    expect(result.ready).toBe(true);
    expect(result.preview.semifinalPairings).toEqual([
      { gameID: 61, regions: [3, 4] },
      { gameID: 62, regions: [1, 2] },
    ]);
    // South is now position 0 -> block start 1, same as East was in the default order.
    expect(result.gamesData[0]).toBe('3-1-1-301');
    expect(result.gamesData[1]).toBe('3-1-16-');
    // South's seed-16 play-in now feeds gameID 1 (South's new block), not 31.
    expect(result.firstFourData[0]).toMatchObject({
      nextGameID: 1,
      nextGameSpot: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Validation diagnostics
// ---------------------------------------------------------------------------

describe('assembleBracketPlan — validation', () => {
  test('rejects a non-integer year', () => {
    const result = assembleBracketPlan({
      year: NaN,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: [],
    });
    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'invalid-year')).toBe(
      true,
    );
  });

  test('rejects a regionOrder that is not exactly 4 regions', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: [1, 2, 3],
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: [],
    });
    expect(result.ready).toBe(false);
    expect(result.gamesData).toBeNull();
    expect(result.diagnostics).toEqual([
      {
        code: 'invalid-region-order',
        message: 'regionOrder must list exactly 4 regions, got 3',
      },
    ]);
  });

  test('rejects a regionOrder with a duplicate region', () => {
    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: [1, 2, 3, 3],
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: [],
    });
    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'duplicate-region')).toBe(
      true,
    );
  });

  test('flags a region with other than 8 R1 events', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    }).filter((e) => e.espnEventId !== 'East-r1-7'); // drop one East R1 event

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'incomplete-region' && d.message.includes('Region 1'),
      ),
    ).toBe(true);
  });

  test('flags an unresolved (unmatched) team', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    });
    events[0] = {
      ...events[0],
      team2: { ...events[0].team2, sID: null, matchMethod: 'unresolved' },
    };

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'unresolved-team')).toBe(
      true,
    );
  });

  test('flags an unrecognized seed', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    });
    events[0] = {
      ...events[0],
      team1: { ...events[0].team1, seed: 17 },
    };

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'invalid-seed')).toBe(
      true,
    );
  });

  test('flags two R1 events disagreeing on the same region+seed', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    });
    // Same region+seed as events[0].team1 (East seed 1), different sID.
    events.push({
      ...events[0],
      espnEventId: 'East-r1-dupe',
      team1: { ...events[0].team1, sID: 999 },
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'seed-conflict')).toBe(
      true,
    );
  });

  test('flags First Four teams with mismatched seeds', () => {
    const badFf = makeFirstFourEvent({
      espnEventId: 'ff-bad',
      regionName: 'East',
      seed: 11,
      sidA: 9101,
      sidB: 9102,
      eventDate: '2026-03-18T10:00Z',
    });
    badFf.team2 = { ...badFf.team2, seed: 12 };

    const events = buildMatchedEvents({
      skipsByRegion: { East: [16] },
      extraFirstFour: [badFf],
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'seed-mismatch')).toBe(
      true,
    );
  });

  test.each([false, true])(
    'rejects an unrelated R1 occupant even with test mode %s',
    (ignoreResolvedPlayIns) => {
      const extraFf = makeFirstFourEvent({
        espnEventId: 'ff-extra',
        regionName: 'East',
        seed: 1, // East seed 1 already has a resolved team (no skip)
        sidA: 9201,
        sidB: 9202,
        eventDate: '2026-03-18T10:00Z',
      });

      const events = buildMatchedEvents({
        skipsByRegion: { East: [16] },
        extraFirstFour: [extraFf],
      });

      const result = assembleBracketPlan({
        year: 2026,
        regionOrder: REGION_ORDER,
        regionNameToId: REGION_NAME_TO_ID,
        matchedEvents: events,
        ignoreResolvedPlayIns,
      });

      expect(result.ready).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === 'destination-already-filled'),
      ).toBe(true);
    },
  );

  test('flags two First Four games targeting the same destination', () => {
    const dupeFf = makeFirstFourEvent({
      espnEventId: 'ff-East-16-dupe',
      regionName: 'East',
      seed: 16,
      sidA: 9301,
      sidB: 9302,
      eventDate: '2026-03-18T11:00Z',
    });

    const events = buildMatchedEvents({
      skipsByRegion: { East: [16] },
      extraFirstFour: [dupeFf],
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'duplicate-destination'),
    ).toBe(true);
  });

  test('flags an R1 slot that is empty with no First Four game supplying it', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16] },
      omitFirstFourForSeeds: ['East:16'],
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'unfilled-slot')).toBe(
      true,
    );
  });

  test('rejects zero play-ins (below the 1-8 creation limit)', () => {
    const events = buildMatchedEvents({}); // fully resolved bracket, no play-ins

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.playInCount).toBe(0);
    expect(result.diagnostics).toEqual([
      {
        code: 'play-in-count-out-of-range',
        message: 'Expected 1-8 First Four games total, resolved 0',
      },
    ]);
  });

  test('rejects more than 8 play-ins', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16, 9, 12, 13, 11, 14, 10, 15, 1] }, // 9 play-ins in one region
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.playInCount).toBe(9);
    expect(
      result.diagnostics.some((d) => d.code === 'play-in-count-out-of-range'),
    ).toBe(true);
  });

  test('flags a mismatch against the admin-configured play-in count instead of silently trusting ESPN', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
      expectedPlayInCount: 5,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        code: 'play-in-count-mismatch',
        message: 'Configured play-in count is 5 but 4 were resolved from ESPN',
      },
    ]);
  });

  test('flags an event whose regionName is not one of the 4 configured regions', () => {
    const events = buildMatchedEvents({
      skipsByRegion: { East: [16], West: [16], South: [11], Midwest: [11] },
    });
    events.push({
      espnEventId: 'nit-game',
      round: '1st Round',
      regionName: 'Not A Region',
      eventDate: '2026-03-20T17:00Z',
      completed: false,
      team1: makeTeam({ sID: 555, seed: 1 }),
      team2: makeTeam({ sID: 556, seed: 16 }),
      winner: null,
    });

    const result = assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
    });

    expect(result.ready).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'unknown-region')).toBe(
      true,
    );
  });
});

describe('review regressions: play-in occupants and unique schools', () => {
  function plan(events, ignoreResolvedPlayIns = false) {
    return assembleBracketPlan({
      year: 2026,
      regionOrder: REGION_ORDER,
      regionNameToId: REGION_NAME_TO_ID,
      matchedEvents: events,
      ignoreResolvedPlayIns,
    });
  }

  test.each(['team1', 'team2'])(
    'accepts either play-in participant in the corresponding R1 slot (%s)',
    (winnerSpot) => {
      const events = buildMatchedEvents({ skipsByRegion: { East: [16] } });
      const playIn = events.find((event) => event.round === 'First Four');
      const r1 = events.find(
        (event) => event.round === '1st Round' && event.regionName === 'East',
      );
      r1.team2 = { ...playIn[winnerSpot] };
      playIn.completed = true;
      const blocked = plan(events);
      expect(blocked.ready).toBe(false);
      expect(blocked.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'destination-already-filled' }),
      );
      const result = plan(events, true);
      expect(result.ready).toBe(true);
      expect(result.gamesData[1]).toBe('1-1-16-');
      expect(result.firstFourData).toHaveLength(1);
      expect(result.preview.firstFour[0].completed).toBe(true);
      expect(r1.team2.sID).toBe(playIn[winnerSpot].sID);
    },
  );

  test.each(['two R1 slots', 'both play-in participants', 'R1 and play-in'])(
    'rejects a school repeated in %s',
    (scenario) => {
      const events = buildMatchedEvents({ skipsByRegion: { East: [16] } });
      const r1 = events.filter((event) => event.round === '1st Round');
      const playIn = events.find((event) => event.round === 'First Four');
      if (scenario === 'two R1 slots') r1[1].team1.sID = r1[0].team1.sID;
      if (scenario === 'both play-in participants')
        playIn.team2.sID = playIn.team1.sID;
      if (scenario === 'R1 and play-in') r1[1].team1.sID = playIn.team1.sID;
      const result = plan(events);
      expect(result.ready).toBe(false);
      expect(result.gamesData).toBeNull();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'duplicate-school' }),
      );
    },
  );
});
