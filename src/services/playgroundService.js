import {
  gameRepository as _gameRepository,
} from '../repositories/index.js';
import { buildFullGridData } from './viewService.js';
import { TOURNAMENT_ROUNDS } from '../config/const.js';

let gameRepository = _gameRepository;

export function setRepositories(newGameRepository) {
  gameRepository = newGameRepository;
}

/**
 * Builds all data needed for the playground page.
 * Read-only — no DB writes. Uses the existing cache for tournament details.
 *
 * Returns data shaped for client-side simulation (all scoring runs in the browser).
 */
export async function buildPlaygroundData(groupName, year) {
  const details = await gameRepository.getAllTournamentDetails(year);
  const [{ allGames, teams }, { groupData }] = await Promise.all([
    Promise.resolve(details),
    buildFullGridData(groupName, year, details),
  ]);

  // Identify FF losers to exclude from school records
  const ffLoserSIDs = new Set();
  for (const g of allGames) {
    if (g.round === 0 && g.winner) {
      ffLoserSIDs.add(g.winner === g.team1ID ? g.team2ID : g.team1ID);
    }
  }

  // sID → team lookup for enriching pending games with names/seeds (exclude ff_ docs)
  const teamMap = new Map(
    teams.filter(t => !t.isFFDoc).map(t => [t.sID, t])
  );

  // Pending games: both teams set, no winner, round > 0 (exclude FF play-in games)
  const pendingGames = allGames
    .filter(g => g.round > 0 && g.team1ID && g.team2ID && !g.winner)
    .sort((a, b) => a.round - b.round || a.gameID - b.gameID)
    .map(g => {
      const t1 = teamMap.get(g.team1ID) || {};
      const t2 = teamMap.get(g.team2ID) || {};
      return {
        gameID: g.gameID,
        round: g.round,
        roundName: TOURNAMENT_ROUNDS[g.round]?.name || `Round ${g.round}`,
        nextGameID: g.nextGameID || null,
        nextGameSpot: g.nextGameSpot || null,
        team1ID: g.team1ID,
        team1Name: t1.nameNick || t1.name || `Team ${g.team1ID}`,
        team1Seed: t1.seed ?? null,
        team2ID: g.team2ID,
        team2Name: t2.nameNick || t2.name || `Team ${g.team2ID}`,
        team2Seed: t2.seed ?? null,
      };
    });

  // All games for client-side bracket simulation — exclude FF play-in games (round 0)
  const allGamesForClient = allGames.filter(g => g.round > 0).map(g => ({
    gameID: g.gameID,
    round: g.round,
    nextGameID: g.nextGameID || null,
    nextGameSpot: g.nextGameSpot || null,
    team1ID: g.team1ID || null,
    team2ID: g.team2ID || null,
    winner: g.winner || null,
  }));

  // Parallel arrays indexed by round-1 (roundPoints[0] = Round 1 points, etc.)
  const roundPoints = Object.values(TOURNAMENT_ROUNDS).map(r => r.roundPoints);
  // roundNames for display in the round filter tabs
  const roundNames = Object.entries(TOURNAMENT_ROUNDS).map(([round, r]) => ({
    round: Number(round),
    name: r.name,
  }));

  // Slim entries for client-side use — only the fields needed for simulation + display
  const entries = groupData.map(e => ({
    id: e.id,
    person: e.person,
    teamName: e.teamName,
    picks: e.picks,
    totalPoints: e.totalPoints,
    rank: e.rank,
    teamsRemaining: e.teamsRemaining,
  }));

  // School records for client-side simulation — exclude FF losers and ff_ docs
  const schoolRecords = teams.filter(t => !ffLoserSIDs.has(t.sID) && !t.isFFDoc).map(t => ({
    sID: t.sID,
    nameNick: t.nameNick,
    name: t.name,
    seed: t.seed,
    gameStatus: t.gameStatus ? [...t.gameStatus] : [],
  }));

  return {
    entries,
    schoolRecords,
    pendingGames,
    allGamesForClient,
    roundPoints,
    roundNames,
  };
}
