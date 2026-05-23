import Logger from "../utils/logger.js";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

const NY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Fetches completed NCAA tournament games from ESPN's unofficial scoreboard API.
 * @param {string} dateStr - Date in YYYYMMDD format (defaults to today)
 * @returns {Promise<Array<{espnEventId, team1DisplayName, team2DisplayName, winnerDisplayName}>>}
 */
export async function fetchCompletedTournamentGames(dateStr = null) {
  const date = dateStr ?? getTodayDateStr();
  const url = `${ESPN_SCOREBOARD_URL}?limit=200&dates=${date}`;

  Logger.info(`ESPN poll: fetching scoreboard for date ${date}`);

  let data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`ESPN API returned HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (err) {
    Logger.error("ESPN poll: failed to fetch scoreboard", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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

  Logger.info(`ESPN poll: found ${completedGames.length} completed game(s) on ${date}`);
  return completedGames;
}

/**
 * Fetches all NCAA tournament games (scheduled and completed) from ESPN's scoreboard API.
 * Used only by the tournament creation page to auto-populate team dropdowns.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {Promise<Array<{espnEventId, team1DisplayName, team2DisplayName, team1Seed, team2Seed, completed, winnerDisplayName, regionName}>>}
 */
export async function fetchScheduledTournamentGames(dateStr) {
  const url = `${ESPN_SCOREBOARD_URL}?limit=200&dates=${dateStr}`;

  Logger.info(`ESPN scheduled: fetching scoreboard for date ${dateStr}`);

  let data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`ESPN API returned HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (err) {
    Logger.error("ESPN scheduled: failed to fetch scoreboard", err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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

function getTodayDateStr() {
  // Use America/New_York timezone to match scheduler and game times (Cloud Run runs in UTC)
  const parts = Object.fromEntries(
    NY_DATE_FORMATTER.formatToParts(new Date()).map(({ type, value }) => [type, value])
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
    NY_DATE_FORMATTER.formatToParts(d).map(({ type, value }) => [type, value])
  );
  return `${parts.year}${parts.month}${parts.day}`;
}
