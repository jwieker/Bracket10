import { createRequire } from 'module';
import Logger from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';

const require = createRequire(import.meta.url);

/**
 * ESPN's scoreboard API takes an 8-digit `YYYYMMDD` date. The value reaches an
 * outbound URL, and on the scheduled-poll path it originates from an admin
 * request, so reject anything that isn't exactly 8 digits before interpolating.
 * The host is a fixed constant (not open SSRF), but this closes the hygiene gap.
 */
function assertValidDateStr(dateStr) {
  if (!/^\d{8}$/.test(dateStr)) {
    // Don't echo the raw (untrusted) value back in the error message — state the
    // expected format instead, so the text is safe even if a ValidationError is
    // ever rendered into an HTML context downstream. The rejected value is still
    // recorded at debug level for troubleshooting.
    Logger.debug(
      `assertValidDateStr: rejected dateStr ${JSON.stringify(dateStr)}`,
    );
    throw new ValidationError('Invalid ESPN date format (expected YYYYMMDD)');
  }
  return dateStr;
}

const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

const NY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Loads the ESPN display-name → internal sID mapping from config.
 * Returns an object like { "Duke Blue Devils": 264, ... }
 */
export function loadTeamMap() {
  try {
    return require('../config/espnTeamMap.json');
  } catch {
    Logger.warn(
      'ESPN poll: espnTeamMap.json not found or invalid — no games will be matched',
    );
    return {};
  }
}

/**
 * Shared fetch+timeout+error-logging wrapper for the ESPN scoreboard endpoint.
 * Each caller passes its own log prefix so failures are traceable to the
 * specific consumer (poll vs. scheduled-preview vs. plan normalization).
 */
async function fetchScoreboardData(dateStr, logPrefix) {
  const url = `${ESPN_SCOREBOARD_URL}?limit=200&dates=${dateStr}`;
  Logger.info(`${logPrefix}: fetching scoreboard for date ${dateStr}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ESPN API returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    Logger.error(`${logPrefix}: failed to fetch scoreboard`, err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches completed NCAA tournament games from ESPN's unofficial scoreboard API.
 * @param {string} dateStr - Date in YYYYMMDD format (defaults to today)
 * @returns {Promise<Array<{espnEventId, team1DisplayName, team2DisplayName, winnerDisplayName}>>}
 */
export async function fetchCompletedTournamentGames(dateStr = null) {
  const date = assertValidDateStr(dateStr ?? getTodayDateStr());
  const data = await fetchScoreboardData(date, 'ESPN poll');

  const events = data?.events ?? [];
  const completedGames = [];

  for (const event of events) {
    const isCompleted = event?.status?.type?.completed === true;
    if (!isCompleted) continue;

    const competition = event?.competitions?.[0];
    if (!competition) continue;

    const competitors = competition?.competitors ?? [];
    if (competitors.length !== 2) continue;

    const winner = competitors.find((c) => c.winner === true);
    const loser = competitors.find((c) => c.winner === false);
    if (!winner || !loser) continue;

    completedGames.push({
      espnEventId: event.id,
      team1DisplayName: winner.team?.displayName,
      team2DisplayName: loser.team?.displayName,
      winnerDisplayName: winner.team?.displayName,
    });
  }

  Logger.info(
    `ESPN poll: found ${completedGames.length} completed game(s) on ${date}`,
  );
  return completedGames;
}

/**
 * Fetches all NCAA tournament games (scheduled and completed) from ESPN's scoreboard API.
 * Used only by the tournament creation page to auto-populate team dropdowns.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {Promise<Array<{espnEventId, team1DisplayName, team2DisplayName, team1Seed, team2Seed, completed, winnerDisplayName, regionName}>>}
 */
export async function fetchScheduledTournamentGames(dateStr) {
  assertValidDateStr(dateStr);
  const data = await fetchScoreboardData(dateStr, 'ESPN scheduled');

  const events = data?.events ?? [];
  const games = [];

  for (const event of events) {
    const competition = event?.competitions?.[0];
    if (!competition) continue;

    const competitors = competition?.competitors ?? [];
    if (competitors.length !== 2) continue;

    const completed = event?.status?.type?.completed === true;
    const winner = competitors.find((c) => c.winner === true);

    // Extract region name from notes headline, e.g.
    // "NCAA Men's Basketball Championship - West Region - 1st Round" → "West"
    const noteHeadline = competition?.notes?.[0]?.headline ?? '';
    const regionMatch = noteHeadline.match(/- (\w+) Region -/);
    const regionName = regionMatch ? regionMatch[1] : null;

    // ESPN orders home/away; normalize to a consistent team1/team2
    const [c1, c2] = competitors;

    games.push({
      espnEventId: event.id,
      team1DisplayName: c1.team?.displayName,
      team2DisplayName: c2.team?.displayName,
      team1Seed: c1.curatedRank?.current ?? null,
      team2Seed: c2.curatedRank?.current ?? null,
      completed,
      winnerDisplayName: winner?.team?.displayName ?? null,
      regionName,
    });
  }

  Logger.info(`ESPN scheduled: found ${games.length} game(s) on ${dateStr}`);
  return games;
}

// Only these two round labels are admitted for the ESPN-driven bracket-creation
// feature; every other event (NIT, later rounds, non-tournament games) is
// reported back as excluded rather than silently dropped, per the plan's
// "diagnostics, not disappear" requirement.
const RECOGNIZED_ROUNDS = new Set(['First Four', '1st Round']);

/**
 * @typedef {Object} NormalizedTournamentTeam
 * @property {string|null} espnId - Raw ESPN team id (string); null for an
 *   unresolved/TBD play-in destination slot.
 * @property {string|null} displayName
 * @property {number|null} seed
 */

/**
 * @typedef {Object} NormalizedTournamentEvent
 * @property {string} espnEventId
 * @property {string|null} eventDate - ISO timestamp as ESPN reports it.
 * @property {string} round - "First Four" or "1st Round".
 * @property {string} regionName
 * @property {boolean} completed
 * @property {NormalizedTournamentTeam} team1
 * @property {NormalizedTournamentTeam} team2
 * @property {NormalizedTournamentTeam|null} winner
 */

/**
 * Normalizes one date's ESPN scoreboard into First Four / Round 1 men's
 * championship events, for the ESPN-driven tournament-creation assembler.
 * Distinct from `fetchScheduledTournamentGames` (kept as-is for its existing
 * `pollEspnScheduled` consumer): this adds competitor ESPN ids, event
 * timestamps, round labels, and an admission filter, and never silently
 * drops an event — anything not admitted is returned in `excluded` with a
 * reason so the caller can surface it as a diagnostic.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {Promise<{events: NormalizedTournamentEvent[], excluded: Array<{espnEventId: string|null, reason: string}>}>}
 */
export async function fetchNormalizedTournamentEvents(dateStr) {
  assertValidDateStr(dateStr);
  const data = await fetchScoreboardData(dateStr, 'ESPN normalized');

  const rawEvents = data?.events ?? [];
  const seenEventIds = new Set();
  const events = [];
  const excluded = [];

  for (const event of rawEvents) {
    const espnEventId = event?.id ?? null;
    if (!espnEventId) {
      excluded.push({ espnEventId: null, reason: 'missing event id' });
      continue;
    }
    if (seenEventIds.has(espnEventId)) continue;
    seenEventIds.add(espnEventId);

    const competition = event?.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    if (!competition || competitors.length !== 2) {
      excluded.push({ espnEventId, reason: 'not a two-competitor event' });
      continue;
    }

    // Real ESPN headline (verified against recorded 2025 responses — see
    // tests/fixtures/espn/): "Men's Basketball Championship - West Region -
    // 1st Round". No "NCAA " prefix, unlike the format assumed in an earlier
    // draft of this function.
    const noteHeadline = competition?.notes?.[0]?.headline ?? '';
    const headlineMatch = noteHeadline.match(
      /Men's Basketball Championship - (\w+) Region - (.+)$/,
    );
    if (!headlineMatch) {
      excluded.push({
        espnEventId,
        reason: "headline did not match the men's championship round format",
      });
      continue;
    }
    const [, regionName, roundText] = headlineMatch;
    const round = roundText.trim();
    if (!RECOGNIZED_ROUNDS.has(round)) {
      excluded.push({ espnEventId, reason: `unrecognized round "${round}"` });
      continue;
    }

    const [c1, c2] = competitors;
    const winnerCompetitor = competitors.find((c) => c.winner === true);

    events.push({
      espnEventId,
      eventDate: event?.date ?? null,
      round,
      regionName,
      completed: event?.status?.type?.completed === true,
      team1: toNormalizedTeam(c1),
      team2: toNormalizedTeam(c2),
      winner: winnerCompetitor ? toNormalizedTeam(winnerCompetitor) : null,
    });
  }

  Logger.info(
    `ESPN normalized: ${events.length} admitted, ${excluded.length} excluded on ${dateStr}`,
  );
  return { events, excluded };
}

function toNormalizedTeam(competitor) {
  return {
    espnId: competitor?.team?.id ?? null,
    displayName: competitor?.team?.displayName ?? null,
    seed: competitor?.curatedRank?.current ?? null,
  };
}

function getTodayDateStr() {
  // Use America/New_York timezone to match scheduler and game times (Cloud Run runs in UTC)
  const parts = Object.fromEntries(
    NY_DATE_FORMATTER.formatToParts(new Date()).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

/**
 * Returns a YYYYMMDD date string for N days before today (in America/New_York time).
 * @param {number} daysAgo
 */
export function getDateStrDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const parts = Object.fromEntries(
    NY_DATE_FORMATTER.formatToParts(d).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}
