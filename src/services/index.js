// Centralized service exports for cleaner imports
export { default as Logger } from '../utils/logger.js';

// Points Service
export {
    updatePossiblePoints,
    getFuturePoints,
    findNextGameId,
    getTournamentData,
    possibleRanking,
    calculateEntryPointsAndPaths,
    enrichEntriesWithPotentialRankings,
    getNextFutureGame,
} from './pointsService.js';

// Game Service
export {
    updateTeamRecords,
    undoTeamRecords,
    setRepositories,
} from './gameService.js';

// ESPN Poll Service
export { runEspnPoll } from './pollService.js';

// Tourney Service
export {
    createNewBracketStructure,
    updateEntrywithNewSchools,
    prepareRegionVerifyData,
    prepareNewTournamentData,
    createNewBracket,
    createFirstFourGames,
    getAllGames,
    updateBracket,
    deleteTournament,
} from './tourneyService.js';

// ESPN Service
export { fetchScheduledTournamentGames } from './espnService.js';

// Email Service
export { getUnsentEmailEntries, markEmailsSent } from './emailService.js';

// Cloud Service (GCP budget + deploy trigger for admin dashboard)
export {
    getBudgetStatus,
    triggerProductionDeploy,
    getCloudConsoleLinks,
} from './cloudService.js';

// View Service
export {
    getGroupTeamDetails,
    addTeamProgressforGroup,
    verifyGroupExists,
    getGroupRegistrationData,
    createNewEntry,
    addPickCount,
    calculateMaxPossiblePoints,
    getAllYearsforGroup,
    getEntriesForUser,
    getEntryIdsForUserInGroup,
    getRegionsForYear,
    findEntriesByName,
    addNewGroup,
    getRegionIDForYear,
    normalizeFirstFourPicks,
    buildFullGridData,
    buildGameViewData,
} from './viewService.js';
