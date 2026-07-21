import { describe, it, expect } from 'vitest';
import * as services from '../src/services/index.js';

describe('Services Index', () => {
  it('should export all expected services and functions', () => {
    const expectedExports = [
      'Logger',

      // pointsService.js
      'updatePossiblePoints',
      'getFuturePoints',
      'findNextGameId',
      'getTournamentData',
      'possibleRanking',
      'calculateEntryPointsAndPaths',
      'enrichEntriesWithPotentialRankings',
      'getNextFutureGame',

      // gameService.js
      'updateTeamRecords',
      'undoTeamRecords',
      'setRepositories',

      // pollService.js
      'runEspnPoll',

      // tourneyService.js
      'createNewBracketStructure',
      'updateEntrywithNewSchools',
      'prepareRegionVerifyData',
      'prepareNewTournamentData',
      'createNewBracket',
      'createFirstFourGames',
      'getAllGames',
      'updateBracket',
      'deleteTournament',

      // espnService.js
      'fetchScheduledTournamentGames',

      // emailService.js
      'getUnsentEmailEntries',
      'markEmailsSent',

      // cloudService.js
      'getBudgetStatus',
      'triggerProductionDeploy',
      'getCloudConsoleLinks',

      // viewService.js
      'getGroupTeamDetails',
      'addTeamProgressforGroup',
      'verifyGroupExists',
      'getGroupRegistrationData',
      'createNewEntry',
      'addPickCount',
      'calculateMaxPossiblePoints',
      'getAllYearsforGroup',
      'getEntriesForUser',
      'getEntryIdsForUserInGroup',
      'getRegionsForYear',
      'findEntriesByName',
      'addNewGroup',
      'getRegionIDForYear',
      'normalizeFirstFourPicks',
      'validateEntryPicks',
      'normalizeAndValidateEntryPicks',
      'buildFullGridData',
      'buildGameViewData',
    ];

    // Check that all expected exports exist
    for (const exp of expectedExports) {
      expect(services[exp]).toBeDefined();
    }
  });
});
