import { TOURNAMENT_ROUNDS } from '../config/app.js';
import Logger from './logger.js';

// Tolerance for tie detection in `possibleRanking`. Point increments are integers
// (min 1), so any window below 1 cannot collapse genuinely distinct totals while
// safely absorbing float-accumulation drift from upstream Firestore values.
const POINTS_EPSILON = 1e-9;

function computeUniqueMask(picksLen, picks, otherPickSet) {
  let mask = 0;
  for (let i = 0; i < picksLen; i++) {
    if (!otherPickSet.has(picks[i])) {
      mask |= 1 << i;
    }
  }
  return mask;
}

function getPathsFromMask(mask, picksLen, futureGames) {
  const paths = [];
  for (let i = 0; i < picksLen; i++) {
    if (mask & (1 << i)) {
      paths.push(futureGames[i]);
    }
  }
  return paths;
}

function getCachedPotential(
  entry,
  otherPickSet,
  picksLen,
  uniquePotentialCache,
) {
  const uniqueMask = computeUniqueMask(picksLen, entry.picks, otherPickSet);
  let potentialFromUniquePicks = uniquePotentialCache.get(uniqueMask);

  if (potentialFromUniquePicks === undefined) {
    const uniqueToEntryPaths = getPathsFromMask(
      uniqueMask,
      picksLen,
      entry.futureGames,
    );
    potentialFromUniquePicks = getFuturePoints(
      uniqueToEntryPaths,
      entry.points,
    );
    uniquePotentialCache.set(uniqueMask, potentialFromUniquePicks);
  }
  return potentialFromUniquePicks;
}

function getCachedRelativeMin(
  otherEntry,
  entryPickSet,
  otherMinCaches,
  sortedGames,
  incomingGames,
) {
  const otherPicksLen = otherEntry.picks.length;
  const otherUniqueMask = computeUniqueMask(
    otherPicksLen,
    otherEntry.picks,
    entryPickSet,
  );

  let otherRelativeMin;
  let otherCacheForEntry = otherMinCaches?.get(otherEntry.entryID);
  if (otherCacheForEntry) {
    otherRelativeMin = otherCacheForEntry.get(otherUniqueMask);
  } else if (otherMinCaches) {
    otherCacheForEntry = new Map();
    otherMinCaches.set(otherEntry.entryID, otherCacheForEntry);
  }

  if (otherRelativeMin === undefined) {
    const otherUniquePaths = getPathsFromMask(
      otherUniqueMask,
      otherPicksLen,
      otherEntry.futureGames,
    );
    otherRelativeMin = minPoints(
      otherUniquePaths,
      otherEntry.points,
      sortedGames,
      incomingGames,
    );
    if (otherCacheForEntry) {
      otherCacheForEntry.set(otherUniqueMask, otherRelativeMin);
    }
  }
  return otherRelativeMin;
}

function getHighestPlace(
  entry,
  allBobEntries,
  otherMinCaches = null,
  sortedGames = null,
  incomingGames = null,
) {
  let highestPlace = 1;
  let ties = 0;

  const entryPickSet = entry.pickSet ?? new Set(entry.picks);
  const entryMaxPoints = entry.maxPoints;
  const entryCurrentPoints = entry.points;

  // Memoize potentialFromUniquePicks keyed by the bitmask of entry-picks that
  // are unique vs. each otherEntry. Many otherEntries share the same overlap
  // subset, so the cache turns the hot O(N²) inner work into O(distinct-masks).
  // maxPicksPerEntry is 10, so a 32-bit signed int is plenty (bit 30 max).
  const picksLen = entry.picks.length;
  if (picksLen >= 32)
    Logger.warn(
      `getHighestPlace: picks.length=${picksLen} exceeds 32-bit mask`,
    );
  const uniquePotentialCache = new Map();

  for (const otherEntry of allBobEntries) {
    if (otherEntry.entryID === entry.entryID) continue;

    // ── Early-exit bounds checks ──
    // When absolute bounds are available (from enrichEntriesWithPotentialRankings),
    // we can skip the expensive unique-pick analysis for clear-cut pairs.
    if (entryMaxPoints != null && otherEntry.maxPoints != null) {
      // If our ceiling is below their current points, they beat us in every scenario.
      if (entryMaxPoints < otherEntry.points) {
        highestPlace++;
        continue;
      }
      // If our current points already exceed their ceiling, we beat them in every scenario.
      if (entryCurrentPoints > otherEntry.maxPoints) {
        continue;
      }
    }

    const otherPickSet = otherEntry.pickSet ?? new Set(otherEntry.picks);

    // A's ceiling: unique future potential only (picks not shared with B).
    const potentialFromUniquePicks = getCachedPotential(
      entry,
      otherPickSet,
      picksLen,
      uniquePotentialCache,
    );

    // B's relative floor: only clashes among B's UNIQUE picks (shared picks excluded).
    const otherRelativeMin = getCachedRelativeMin(
      otherEntry,
      entryPickSet,
      otherMinCaches,
      sortedGames,
      incomingGames,
    );

    // Use epsilon-tolerant equality for the tie branch. Point values are
    // integers today, but `points` reads from Firestore which has no integer
    // type, so any upstream change that introduces fractional arithmetic could
    // desync mathematically-equal values via float accumulation. A 1e-9 window
    // is far below the smallest possible point increment (1) so it cannot
    // collapse genuinely distinct totals.
    if (potentialFromUniquePicks < otherRelativeMin - POINTS_EPSILON) {
      highestPlace++;
    } else if (
      Math.abs(potentialFromUniquePicks - otherRelativeMin) < POINTS_EPSILON
    ) {
      ties++;
    }
  }

  return { highestPlace, ties };
}

function minPoints(
  futureGames,
  currentPoints = 0,
  sortedGames = null,
  incomingGames = null,
) {
  if (!sortedGames || !incomingGames) {
    let guaranteedRoundPointsFromClashes = 0;
    const slotCounts = new Map();

    for (const pickPath of futureGames) {
      for (let roundIndex = 0; roundIndex < pickPath.length; roundIndex++) {
        if (pickPath[roundIndex] !== 'W') {
          const gameId = pickPath[roundIndex];
          const prev = slotCounts.get(gameId) || 0;
          if (prev === 1) {
            const round = roundIndex + 1;
            const roundConfig = TOURNAMENT_ROUNDS[round];
            if (roundConfig && roundConfig.roundPoints) {
              guaranteedRoundPointsFromClashes += roundConfig.roundPoints;
            }
          }
          slotCounts.set(gameId, prev + 1);
          break;
        }
      }
    }
    return currentPoints + guaranteedRoundPointsFromClashes;
  }

  let guaranteedRoundPointsFromClashes = 0;
  const activePicksByStartGame = new Map();
  for (const path of futureGames) {
    for (let roundIndex = 0; roundIndex < path.length; roundIndex++) {
      if (path[roundIndex] !== 'W') {
        const gameId = path[roundIndex];
        activePicksByStartGame.set(
          gameId,
          (activePicksByStartGame.get(gameId) || 0) + 1,
        );
        break;
      }
    }
  }

  const guaranteedPicks = new Map();

  for (const g of sortedGames) {
    if (g.round === 0) continue;

    const incoming = incomingGames.get(g.gameID) || [];
    let inPicks = activePicksByStartGame.get(g.gameID) || 0;
    for (const inId of incoming) {
      inPicks += guaranteedPicks.get(inId) || 0;
    }

    if (inPicks >= 2) {
      const roundConfig = TOURNAMENT_ROUNDS[g.round];
      if (roundConfig && roundConfig.roundPoints) {
        guaranteedRoundPointsFromClashes += roundConfig.roundPoints;
      }
      guaranteedPicks.set(g.gameID, Math.floor(inPicks / 2));
    } else {
      guaranteedPicks.set(g.gameID, 0);
    }
  }

  return currentPoints + guaranteedRoundPointsFromClashes;
}

function getFuturePoints(futureGames, currentPoints) {
  // Previously this function swallowed errors and returned `currentPoints`,
  // making "no future points" and "calculation crashed" indistinguishable to
  // callers — a silent ranking corruption hazard. Now we log with the full
  // input shape and rethrow so the boundary (controller / job) can decide
  // whether to fail the request or skip the entry explicitly.
  try {
    // Single pass: walk each pick's projected path and accumulate round points
    // for games we haven't already credited. When two picks collide on the same
    // future game, only the first path through it scores — subsequent paths
    // stop at the collision (the team would be knocked out there).
    let totalPoints = currentPoints;
    const seenGames = new Set();

    for (const path of futureGames) {
      for (let i = 0; i < path.length; i++) {
        const game = path[i];
        if (game === 'W') continue;
        if (seenGames.has(game)) break;
        seenGames.add(game);
        const roundConfig = TOURNAMENT_ROUNDS[i + 1];
        if (roundConfig) {
          totalPoints += roundConfig.roundPoints || 0;
        }
      }
    }
    return totalPoints;
  } catch (error) {
    Logger.error('getFuturePoints failed', {
      message: error?.message,
      currentPoints,
      futureGamesLength: Array.isArray(futureGames) ? futureGames.length : null,
    });
    throw error;
  }
}

export { getHighestPlace, minPoints, getFuturePoints };
