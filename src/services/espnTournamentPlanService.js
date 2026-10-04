// Orchestration layer between the ESPN-plan routes and the pure Phase 1
// pieces: fetches the admin-requested dates, resolves schools through
// repository reads, and hands everything to the pure assembler. Neither
// fetchNormalizedTournamentEvents nor assembleBracketPlan does I/O of its
// own — this is where that I/O happens, so both stay independently testable.

import { teamRepository, tourneyRepository } from '../repositories/index.js';
import { fetchNormalizedTournamentEvents, loadTeamMap } from './espnService.js';
import { matchSchoolsForEvents } from './schoolMatchingService.js';
import { assembleBracketPlan } from './bracketPlanService.js';
import { ValidationError } from '../utils/errors.js';

const MAX_DISTINCT_DATES = 8;

/**
 * @param {Object} input
 * @param {number} input.year
 * @param {string[]} input.playInDates - YYYYMMDD
 * @param {string[]} input.r1Dates - YYYYMMDD
 * @param {number|null} [input.expectedPlayInCount]
 * @param {number[]} input.regionOrder - 4 distinct regionIDs, admin-confirmed order
 * @param {number[]} [input.playInCounts] - expected counts aligned with playInDates
 * @param {boolean} [input.ignoreResolvedPlayIns] - opt-in historical test mode
 * @returns {Promise<{
 *   ready: boolean,
 *   year: number,
 *   gamesData: string[]|null,
 *   firstFourData: Array|null,
 *   playInCount: number,
 *   preview: Object|null,
 *   diagnostics: Array,
 *   infoDiagnostics: Array,
 *   fetchSummary: Array<{date: string, found: number, excluded: number}>,
 * }>}
 */
export async function buildEspnBracketPlan({
  year,
  playInDates,
  r1Dates,
  expectedPlayInCount = null,
  regionOrder,
  playInCounts = null,
  ignoreResolvedPlayIns = false,
}) {
  const distinctDates = [
    ...new Set([...(playInDates ?? []), ...(r1Dates ?? [])]),
  ];
  if (distinctDates.length === 0) {
    throw new ValidationError(
      'At least one play-in or 1st Round date is required',
      'dates',
    );
  }
  if (distinctDates.length > MAX_DISTINCT_DATES) {
    throw new ValidationError(
      `Too many distinct dates requested (max ${MAX_DISTINCT_DATES})`,
      'dates',
    );
  }

  const [allSchools, allRegionTypes] = await Promise.all([
    teamRepository.getAllSchools(),
    tourneyRepository.getAllRegionTypes(),
  ]);
  const teamMap = loadTeamMap();

  const regionNameToId = {};
  for (const region of allRegionTypes) {
    const id = Number(region.regionID);
    if (id >= 1 && id <= 4) regionNameToId[region.regionName] = id;
  }

  const fetchSummary = [];
  const rawEvents = [];
  const excludedWithDate = [];
  for (const dateStr of distinctDates) {
    const { events, excluded } = await fetchNormalizedTournamentEvents(dateStr);
    fetchSummary.push({
      date: dateStr,
      found: events.length,
      excluded: excluded.length,
    });
    rawEvents.push(...events);
    excludedWithDate.push(...excluded.map((e) => ({ ...e, date: dateStr })));
  }

  // Fetching multiple dates can return the same event twice (e.g. a game
  // spanning a UTC date boundary) — dedupe the same way pollEspnScheduled
  // already does for the manual flow's ESPN-assist button.
  const dedupedEvents = [
    ...new Map(rawEvents.map((e) => [e.espnEventId, e])).values(),
  ];

  const dailyDiagnostics = [];
  if (playInCounts) {
    const eventDay = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const countsByDate = new Map();
    for (const event of dedupedEvents.filter(
      (event) => event.round === 'First Four',
    )) {
      const timestamp = Date.parse(event.eventDate);
      if (!Number.isFinite(timestamp)) {
        dailyDiagnostics.push({
          code: 'missing-play-in-date',
          message: 'A play-in game has no valid scheduled date.',
        });
        continue;
      }
      const parts = Object.fromEntries(
        eventDay
          .formatToParts(new Date(timestamp))
          .map(({ type, value }) => [type, value]),
      );
      const date = `${parts.year}${parts.month}${parts.day}`;
      countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
      if (!playInDates.includes(date)) {
        dailyDiagnostics.push({
          code: 'unexpected-play-in-date',
          message: `A play-in game is scheduled on an unconfigured date (${date}).`,
        });
      }
    }
    playInDates.forEach((date, index) => {
      const found = countsByDate.get(date) ?? 0;
      const summary = fetchSummary.find((item) => item.date === date);
      summary.expectedPlayIns = playInCounts[index];
      summary.foundPlayIns = found;
      if (found !== playInCounts[index]) {
        dailyDiagnostics.push({
          code: 'daily-play-in-count-mismatch',
          message: `${date}: expected ${playInCounts[index]} play-in games, found ${found}.`,
        });
      }
    });
  }

  const { events: matchedEvents, diagnostics: matchDiagnostics } =
    matchSchoolsForEvents(dedupedEvents, allSchools, teamMap);

  const assembled = assembleBracketPlan({
    year,
    regionOrder,
    regionNameToId,
    matchedEvents,
    expectedPlayInCount,
    ignoreResolvedPlayIns,
  });

  // Excluded-event reasons are informational (e.g. an unrelated game on the
  // same date) — they explain why a count looks off but never by themselves
  // block Create. An unresolved school or a structural assembler diagnostic
  // does block it.
  const infoDiagnostics = excludedWithDate.map((e) => ({
    code: 'espn-event-excluded',
    message: `Excluded event on ${e.date}: ${e.reason}`,
    espnEventId: e.espnEventId,
  }));
  for (const event of dedupedEvents) {
    if (event.round === 'First Four' && event.completed) {
      infoDiagnostics.push({
        code: 'completed-play-in',
        message: `${event.team1.displayName} / ${event.team2.displayName}: this play-in is already completed on ESPN. Creation leaves its result unresolved; record the result with the existing admin controls or the configured poll job.`,
        espnEventId: event.espnEventId,
      });
    }
  }
  const blockingDiagnostics = [
    ...dailyDiagnostics,
    ...matchDiagnostics,
    ...assembled.diagnostics,
  ];
  const ready = assembled.ready && blockingDiagnostics.length === 0;

  return {
    ready,
    year: assembled.year,
    gamesData: ready ? assembled.gamesData : null,
    firstFourData: ready ? assembled.firstFourData : null,
    playInCount: assembled.playInCount,
    preview: assembled.preview,
    diagnostics: blockingDiagnostics,
    infoDiagnostics,
    fetchSummary,
  };
}
