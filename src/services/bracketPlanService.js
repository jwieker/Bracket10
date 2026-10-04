// Pure assembler: turns already-normalized, already-school-matched ESPN
// events (fetchNormalizedTournamentEvents + matchSchoolsForEvents) into the
// exact `gamesData`/`firstFourData` shapes `createNewBracket()` in
// tourneyService.js consumes. No I/O, no repository access — callers resolve
// region order, region-name-to-id, and school matches first and pass the
// results in, so this stays testable with plain fixtures.

// R1 gameID base per regionOrder position (0-3): Region 1 = 1-8, Region 2 =
// 16-23, Region 3 = 31-38, Region 4 = 46-53 — see the gameID scheme comment
// in tourneyService.js. Position, not regionID value, decides the block.
const REGION_BLOCK_STARTS = [1, 16, 31, 46];

// Same seed-pair order used by the manual-creation flow (newTourneyComplete.ejs,
// views/partials/bracket.ejs, tourneyService.js's `seeds` arrays). The lower
// seed of each pair always occupies gamesData slot 1.
const SEED_PAIR_TABLE = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

// seed -> { pairIndex, slot, partnerSeed }; every seed 1-16 appears in
// exactly one pair, so a play-in's seed always resolves its R1 destination
// unambiguously (region + seed, per the plan's normalization rules).
const SEED_INFO = new Map();
SEED_PAIR_TABLE.forEach(([lowSeed, highSeed], pairIndex) => {
  SEED_INFO.set(lowSeed, { pairIndex, slot: 1, partnerSeed: highSeed });
  SEED_INFO.set(highSeed, { pairIndex, slot: 2, partnerSeed: lowSeed });
});

const MIN_PLAY_INS = 1;
const MAX_PLAY_INS = 8;

function isResolvedTeam(team) {
  return team.matchMethod === 'espnId' || team.matchMethod === 'nameMap';
}

/**
 * @param {Object} input
 * @param {number} input.year
 * @param {number[]} input.regionOrder - 4 distinct regionIDs, in the
 *   admin-confirmed position order (index 0/1 feed game 61, 2/3 feed 62).
 * @param {Object<string, number>} input.regionNameToId - ESPN regionName
 *   ("West") -> regionID, for the 4 bracket regions.
 * @param {Array} input.matchedEvents - normalized + school-matched events
 *   (fetchNormalizedTournamentEvents + matchSchoolsForEvents output),
 *   deduplicated across every fetched date.
 * @param {number|null} [input.expectedPlayInCount] - admin-entered daily
 *   play-in count total, if known; a mismatch is a diagnostic, never a
 *   silent override.
 * @param {boolean} [input.ignoreResolvedPlayIns] - reset verified R1 occupants for historical testing
 * @returns {{
 *   ready: boolean,
 *   year: number,
 *   gamesData: string[]|null,
 *   firstFourData: Array|null,
 *   playInCount: number,
 *   preview: Object|null,
 *   diagnostics: Array<{code: string, message: string, espnEventId?: string}>,
 * }}
 */
export function assembleBracketPlan({
  year,
  regionOrder,
  regionNameToId,
  matchedEvents,
  expectedPlayInCount = null,
  ignoreResolvedPlayIns = false,
}) {
  const diagnostics = [];
  const addDiagnostic = (code, message, espnEventId) => {
    diagnostics.push(
      espnEventId !== undefined
        ? { code, message, espnEventId }
        : { code, message },
    );
  };

  if (!Number.isInteger(year) || year < 1) {
    addDiagnostic(
      'invalid-year',
      `year must be a positive integer, got ${year}`,
    );
  }

  const hasFourRegions = Array.isArray(regionOrder) && regionOrder.length === 4;
  if (!hasFourRegions) {
    addDiagnostic(
      'invalid-region-order',
      `regionOrder must list exactly 4 regions, got ${regionOrder?.length ?? 0}`,
    );
  } else if (new Set(regionOrder).size !== 4) {
    addDiagnostic(
      'duplicate-region',
      'regionOrder must list 4 distinct regions',
    );
  }
  const validRegionOrder = hasFourRegions && new Set(regionOrder).size === 4;

  // region -> Map(seed -> {sID, seed, espnEventId})
  const regionSeedTeams = new Map(
    validRegionOrder ? regionOrder.map((r) => [r, new Map()]) : [],
  );
  const regionR1EventCount = new Map(
    validRegionOrder ? regionOrder.map((r) => [r, 0]) : [],
  );
  const claimedDestinations = new Set(); // `${regionID}:${seed}`
  const firstFourData = [];
  const firstFourPreview = [];

  if (validRegionOrder) {
    const r1Events = matchedEvents.filter((e) => e.round === '1st Round');
    const firstFourEvents = matchedEvents.filter(
      (e) => e.round === 'First Four',
    );

    for (const event of r1Events) {
      const regionID = regionNameToId[event.regionName];
      if (regionID == null || !regionSeedTeams.has(regionID)) {
        addDiagnostic(
          'unknown-region',
          `1st Round event region "${event.regionName}" is not one of the 4 configured bracket regions`,
          event.espnEventId,
        );
        continue;
      }
      regionR1EventCount.set(regionID, regionR1EventCount.get(regionID) + 1);

      for (const [label, team] of [
        ['team1', event.team1],
        ['team2', event.team2],
      ]) {
        if (team.matchMethod === 'placeholder') continue; // resolved via a First Four link below
        if (!isResolvedTeam(team)) {
          addDiagnostic(
            'unresolved-team',
            `1st Round ${label} "${team.displayName}" is not matched to an existing school`,
            event.espnEventId,
          );
          continue;
        }
        if (!SEED_INFO.has(team.seed)) {
          addDiagnostic(
            'invalid-seed',
            `1st Round ${label} "${team.displayName}" has an unrecognized seed (${team.seed})`,
            event.espnEventId,
          );
          continue;
        }
        const seedMap = regionSeedTeams.get(regionID);
        const existing = seedMap.get(team.seed);
        if (existing && existing.sID !== team.sID) {
          addDiagnostic(
            'seed-conflict',
            `Region ${regionID} seed ${team.seed} has two different resolved teams (school ${existing.sID} and school ${team.sID})`,
            event.espnEventId,
          );
          continue;
        }
        seedMap.set(team.seed, {
          sID: team.sID,
          seed: team.seed,
          displayName: team.displayName ?? null,
          espnEventId: event.espnEventId,
        });
      }
    }

    for (const regionID of regionOrder) {
      const count = regionR1EventCount.get(regionID);
      if (count !== 8) {
        addDiagnostic(
          'incomplete-region',
          `Region ${regionID} has ${count} 1st Round event(s), expected 8`,
        );
      }
    }

    // Stable ordering so game IDs/preview links don't depend on fetch order.
    const sortedFirstFour = [...firstFourEvents].sort((a, b) => {
      const dateCompare = (a.eventDate ?? '').localeCompare(b.eventDate ?? '');
      if (dateCompare !== 0) return dateCompare;
      return String(a.espnEventId).localeCompare(
        String(b.espnEventId),
        undefined,
        {
          numeric: true,
        },
      );
    });

    for (const event of sortedFirstFour) {
      const regionID = regionNameToId[event.regionName];
      if (regionID == null || !regionSeedTeams.has(regionID)) {
        addDiagnostic(
          'unknown-region',
          `First Four event region "${event.regionName}" is not one of the 4 configured bracket regions`,
          event.espnEventId,
        );
        continue;
      }

      const { team1, team2 } = event;
      let teamsResolved = true;
      for (const [label, team] of [
        ['team1', team1],
        ['team2', team2],
      ]) {
        if (!isResolvedTeam(team)) {
          addDiagnostic(
            'unresolved-team',
            `First Four ${label} "${team.displayName}" is not matched to an existing school`,
            event.espnEventId,
          );
          teamsResolved = false;
        }
      }
      if (!teamsResolved) continue;

      if (team1.seed == null || team1.seed !== team2.seed) {
        addDiagnostic(
          'seed-mismatch',
          `First Four teams must share one seed (got ${team1.seed}, ${team2.seed})`,
          event.espnEventId,
        );
        continue;
      }
      const seed = team1.seed;
      const seedInfo = SEED_INFO.get(seed);
      if (!seedInfo) {
        addDiagnostic(
          'invalid-seed',
          `First Four game has an unrecognized seed (${seed})`,
          event.espnEventId,
        );
        continue;
      }

      const destinationKey = `${regionID}:${seed}`;
      if (claimedDestinations.has(destinationKey)) {
        addDiagnostic(
          'duplicate-destination',
          `More than one First Four game targets region ${regionID} seed ${seed}`,
          event.espnEventId,
        );
        continue;
      }
      const seedMap = regionSeedTeams.get(regionID);
      const occupant = seedMap.get(seed);
      if (
        occupant &&
        (ignoreResolvedPlayIns !== true ||
          ![team1.sID, team2.sID].includes(occupant.sID))
      ) {
        addDiagnostic(
          'destination-already-filled',
          `First Four game targets region ${regionID} seed ${seed}, which already has a resolved 1st Round team`,
          event.espnEventId,
        );
        continue;
      }
      seedMap.delete(seed);
      claimedDestinations.add(destinationKey);

      const regionPosition = regionOrder.indexOf(regionID);
      const nextGameID =
        REGION_BLOCK_STARTS[regionPosition] + seedInfo.pairIndex;
      const nextGameSpot = seedInfo.slot;

      firstFourData.push({
        team1ID: team1.sID,
        team2ID: team2.sID,
        seed,
        nextGameID,
        nextGameSpot,
      });
      firstFourPreview.push({
        espnEventId: event.espnEventId,
        eventDate: event.eventDate,
        completed: event.completed === true,
        regionID,
        seed,
        team1: { sID: team1.sID, displayName: team1.displayName },
        team2: { sID: team2.sID, displayName: team2.displayName },
        nextGameID,
        nextGameSpot,
      });
    }

    // Every seed slot must end up either a resolved team or a claimed
    // play-in destination — never both, never neither.
    for (const regionID of regionOrder) {
      const seedMap = regionSeedTeams.get(regionID);
      for (const [lowSeed, highSeed] of SEED_PAIR_TABLE) {
        for (const seed of [lowSeed, highSeed]) {
          const hasTeam = seedMap.has(seed);
          const hasPlayIn = claimedDestinations.has(`${regionID}:${seed}`);
          if (!hasTeam && !hasPlayIn) {
            addDiagnostic(
              'unfilled-slot',
              `Region ${regionID} seed ${seed} has no resolved team and no First Four game`,
            );
          }
        }
      }
    }
  }

  const playInCount = firstFourData.length;
  // Downstream count checks assume a valid region set to count within — an
  // invalid regionOrder already reported its own diagnostic above, so don't
  // pile a meaningless "0 play-ins" complaint on top of it.
  if (
    validRegionOrder &&
    (playInCount < MIN_PLAY_INS || playInCount > MAX_PLAY_INS)
  ) {
    addDiagnostic(
      'play-in-count-out-of-range',
      `Expected 1-8 First Four games total, resolved ${playInCount}`,
    );
  }
  if (
    validRegionOrder &&
    expectedPlayInCount != null &&
    expectedPlayInCount !== playInCount
  ) {
    addDiagnostic(
      'play-in-count-mismatch',
      `Configured play-in count is ${expectedPlayInCount} but ${playInCount} were resolved from ESPN`,
    );
  }

  if (validRegionOrder) {
    const filledSlotCount = regionOrder.reduce(
      (sum, regionID) => sum + regionSeedTeams.get(regionID).size,
      0,
    );
    if (filledSlotCount !== 64 - playInCount) {
      addDiagnostic(
        'slot-count-mismatch',
        `Expected ${64 - playInCount} resolved 1st Round slots (64 - ${playInCount} play-ins), got ${filledSlotCount}`,
      );
    }
  }

  if (validRegionOrder) {
    const schoolIDs = [
      ...[...regionSeedTeams.values()].flatMap((seeds) =>
        [...seeds.values()].map((team) => team.sID),
      ),
      ...firstFourData.flatMap((game) => [game.team1ID, game.team2ID]),
    ];
    if (new Set(schoolIDs).size !== schoolIDs.length) {
      addDiagnostic(
        'duplicate-school',
        'A school appears in more than one tournament slot. Review the school mappings.',
      );
    }
  }

  const ready = diagnostics.length === 0;
  if (!ready) {
    return {
      ready,
      year,
      gamesData: null,
      firstFourData: null,
      playInCount,
      preview: null,
      diagnostics,
    };
  }

  const gamesData = [];
  const regionPreview = regionOrder.map((regionID, position) => {
    const blockStart = REGION_BLOCK_STARTS[position];
    const seedMap = regionSeedTeams.get(regionID);
    const games = SEED_PAIR_TABLE.map(([lowSeed, highSeed], pairIndex) => {
      const gameID = blockStart + pairIndex;
      const lowTeam = seedMap.get(lowSeed) ?? null;
      const highTeam = seedMap.get(highSeed) ?? null;

      gamesData.push(
        `${regionID}-${gameID}-${lowSeed}-${lowTeam ? lowTeam.sID : ''}`,
      );
      gamesData.push(
        `${regionID}-${gameID}-${highSeed}-${highTeam ? highTeam.sID : ''}`,
      );

      const findPlayIn = (spot) =>
        firstFourPreview.find(
          (f) => f.nextGameID === gameID && f.nextGameSpot === spot,
        ) ?? null;

      return {
        gameID,
        team1: lowTeam
          ? {
              sID: lowTeam.sID,
              seed: lowSeed,
              displayName: lowTeam.displayName,
            }
          : { seed: lowSeed, playIn: findPlayIn(1) },
        team2: highTeam
          ? {
              sID: highTeam.sID,
              seed: highSeed,
              displayName: highTeam.displayName,
            }
          : { seed: highSeed, playIn: findPlayIn(2) },
      };
    });
    return { regionID, position, games };
  });

  const preview = {
    regions: regionPreview,
    firstFour: firstFourPreview,
    semifinalPairings: [
      { gameID: 61, regions: [regionOrder[0], regionOrder[1]] },
      { gameID: 62, regions: [regionOrder[2], regionOrder[3]] },
    ],
  };

  return {
    ready,
    year,
    gamesData,
    firstFourData,
    playInCount,
    preview,
    diagnostics,
  };
}
