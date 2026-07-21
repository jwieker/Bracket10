// Type definitions and interfaces for better code understanding

/**
 * @typedef {Object} TournamentRound
 * @property {number} roundPoints - Points awarded for this round
 * @property {number} points - Cumulative points up to this round
 * @property {number} loserPoints - Points awarded to losers in this round
 * @property {number} wins - Number of wins needed to reach this round
 * @property {string} name - Human-readable round name
 */

/**
 * @typedef {Object} Team
 * @property {number} sID - Team ID
 * @property {string} name - Team name
 * @property {string} mascot - Team mascot
 * @property {string} nameNick - Team nickname
 * @property {number} confID - Conference ID
 * @property {number} seed - Tournament seed
 * @property {number} points - Current tournament points
 * @property {string[]} gameStatus - Array of game results (W/L)
 * @property {number} regionID - Tournament region ID
 */

/**
 * @typedef {Object} Game
 * @property {number} gameID - Unique game identifier
 * @property {number} regionID - Tournament region
 * @property {number} year - Tournament year
 * @property {number} team1ID - First team ID
 * @property {number} team2ID - Second team ID
 * @property {number} round - Tournament round
 * @property {number} winner - Winning team ID (null if not played)
 * @property {number} nextGameID - Next game in bracket
 * @property {number} nextGameSpot - Position in next game (1 or 2)
 * @property {string} team1Name - First team name (enriched)
 * @property {string} team1Seed - First team seed (enriched)
 * @property {string} team2Name - Second team name (enriched)
 * @property {string} team2Seed - Second team seed (enriched)
 */

/**
 * @typedef {Object} Entry
 * @property {number} id - Entry ID
 * @property {string} email - User email
 * @property {string} teamName - User's team name
 * @property {number[]} picks - Array of team IDs
 * @property {string} group - Group name
 * @property {string} person - Person name
 * @property {number} year - Tournament year
 * @property {number} totalPoints - Current points
 * @property {number} possPoints - Maximum possible points
 * @property {Date} created_at - Creation timestamp
 * @property {Date} edited_at - Last edit timestamp
 */

/**
 * @typedef {Object} GroupTeam
 * @property {number} id - Entry ID
 * @property {string} teamName - Team name
 * @property {number[]} picks - Team picks
 * @property {number} totalPoints - Current points
 * @property {string} person - Person name
 * @property {number} possPoints - Maximum possible points
 * @property {number} rank - Current rank in group
 * @property {number} maxRank - Best possible rank
 * @property {number} minRank - Worst possible rank
 */

/**
 * @typedef {Object} PointsCalculation
 * @property {number} currentPoints - Current tournament points
 * @property {number} maxPoints - Maximum possible points
 * @property {Array<Array<number|string>>} futureGamePaths - Potential future game paths
 */

/**
 * @typedef {Object} TournamentData
 * @property {boolean} isNewTournament - Whether tournament has started
 * @property {Game[]} activeGames - Current active games
 * @property {number} year - Tournament year
 * @property {Object[]} regions - Available regions
 */

// Export type definitions for JSDoc usage
export const Types = {
  TournamentRound: 'TournamentRound',
  Team: 'Team',
  Game: 'Game',
  Entry: 'Entry',
  GroupTeam: 'GroupTeam',
  PointsCalculation: 'PointsCalculation',
  TournamentData: 'TournamentData',
};
