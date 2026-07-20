import {
  buildPlaygroundData,
  setRepositories,
} from '../src/services/playgroundService.js';

const { buildFullGridDataMock } = vi.hoisted(() => ({
  buildFullGridDataMock: vi.fn(),
}));

vi.mock('../src/services/viewService.js', () => ({
  buildFullGridData: buildFullGridDataMock,
}));

describe('playgroundService', () => {
  const mockGameRepository = {
    getAllTournamentDetails: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setRepositories(mockGameRepository);
  });

  test('buildPlaygroundData prepares full payload, excludes FF losers + FF docs, enriches pending games', async () => {
    const mockDetails = {
      allGames: [
        // FF play-in: 9901 won, so 9902 is the FF loser
        {
          gameID: 64,
          round: 0,
          team1ID: 9901,
          team2ID: 9902,
          winner: 9901,
          nextGameID: 5,
          nextGameSpot: 1,
        },
        // Pending Round-1 game
        {
          gameID: 5,
          round: 1,
          team1ID: 9901,
          team2ID: 102,
          winner: null,
          nextGameID: 33,
          nextGameSpot: 2,
        },
        // Decided Round-1 game
        {
          gameID: 6,
          round: 1,
          team1ID: 103,
          team2ID: 104,
          winner: 103,
          nextGameID: 33,
          nextGameSpot: 1,
        },
      ],
      teams: [
        {
          sID: 9901,
          name: 'First Four A',
          nameNick: 'FFA',
          seed: 16,
          gameStatus: ['W'],
          isFFDoc: false,
        },
        {
          sID: 9902,
          name: 'First Four B',
          nameNick: 'FFB',
          seed: 16,
          gameStatus: ['L'],
          isFFDoc: false,
        },
        {
          sID: 102,
          name: 'Kansas',
          nameNick: 'Jayhawks',
          seed: 1,
          gameStatus: [],
          isFFDoc: false,
        },
        {
          sID: 103,
          name: 'Duke',
          nameNick: 'Blue Devils',
          seed: 2,
          gameStatus: ['W'],
          isFFDoc: false,
        },
        {
          sID: 104,
          name: 'North Carolina',
          nameNick: 'Tar Heels',
          seed: 15,
          gameStatus: ['L'],
          isFFDoc: false,
        },
        {
          sID: 105,
          name: 'FF Doc',
          nameNick: 'FFDoc',
          seed: 16,
          gameStatus: [],
          isFFDoc: true,
        },
      ],
    };

    const mockGroupData = [
      {
        id: 1,
        person: 'Family',
        teamName: 'Bob Pick',
        picks: [9901, 103],
        totalPoints: 10,
        rank: 1,
        teamsRemaining: 2,
        otherField: 'should be stripped',
      },
    ];

    mockGameRepository.getAllTournamentDetails.mockResolvedValue(mockDetails);
    buildFullGridDataMock.mockResolvedValue({ groupData: mockGroupData });

    const result = await buildPlaygroundData('BobGroup', 2024);

    expect(mockGameRepository.getAllTournamentDetails).toHaveBeenCalledWith(
      2024,
    );
    expect(buildFullGridDataMock).toHaveBeenCalledWith(
      'BobGroup',
      2024,
      mockDetails,
    );

    // entries: slim shape, extra fields dropped
    expect(result.entries).toEqual([
      {
        id: 1,
        person: 'Family',
        teamName: 'Bob Pick',
        picks: [9901, 103],
        totalPoints: 10,
        rank: 1,
        teamsRemaining: 2,
      },
    ]);
    expect(result.entries[0]).not.toHaveProperty('otherField');

    // schoolRecords: FF loser 9902 excluded, FF doc 105 excluded, no isFFDoc/points fields leak
    expect(result.schoolRecords).toEqual([
      {
        sID: 9901,
        nameNick: 'FFA',
        name: 'First Four A',
        seed: 16,
        gameStatus: ['W'],
      },
      {
        sID: 102,
        nameNick: 'Jayhawks',
        name: 'Kansas',
        seed: 1,
        gameStatus: [],
      },
      {
        sID: 103,
        nameNick: 'Blue Devils',
        name: 'Duke',
        seed: 2,
        gameStatus: ['W'],
      },
      {
        sID: 104,
        nameNick: 'Tar Heels',
        name: 'North Carolina',
        seed: 15,
        gameStatus: ['L'],
      },
    ]);

    // pendingGames: only round>0 with no winner; enriched with team names + seeds
    expect(result.pendingGames).toEqual([
      {
        gameID: 5,
        round: 1,
        roundName: 'First Round',
        nextGameID: 33,
        nextGameSpot: 2,
        team1ID: 9901,
        team1Name: 'FFA',
        team1Seed: 16,
        team2ID: 102,
        team2Name: 'Jayhawks',
        team2Seed: 1,
      },
    ]);

    // allGamesForClient: excludes round 0, only basic fields
    expect(result.allGamesForClient).toEqual([
      {
        gameID: 5,
        round: 1,
        nextGameID: 33,
        nextGameSpot: 2,
        team1ID: 9901,
        team2ID: 102,
        winner: null,
      },
      {
        gameID: 6,
        round: 1,
        nextGameID: 33,
        nextGameSpot: 1,
        team1ID: 103,
        team2ID: 104,
        winner: 103,
      },
    ]);

    // schoolRecords.gameStatus must be a *copy*, not the same array as input
    const inputTeam = mockDetails.teams[2];
    const outputRecord = result.schoolRecords.find((r) => r.sID === 102);
    expect(outputRecord.gameStatus).toEqual([]);
    expect(outputRecord.gameStatus).not.toBe(inputTeam.gameStatus);

    // roundPoints is indexed by round-1: gameStatus never records First Four
    // games, so index 0 must be Round 1 points (2), not the FF value (0)
    expect(result.roundPoints).toEqual([2, 3, 5, 9, 17, 33]);
    expect(Array.isArray(result.roundNames)).toBe(true);
    expect(result.roundNames[0]).toHaveProperty('round');
    expect(result.roundNames[0]).toHaveProperty('name');
  });

  test('pendingGames sort by round ascending, then by gameID', async () => {
    const teams = [
      {
        sID: 1,
        name: 'A',
        nameNick: 'A',
        seed: 1,
        gameStatus: [],
        isFFDoc: false,
      },
      {
        sID: 2,
        name: 'B',
        nameNick: 'B',
        seed: 2,
        gameStatus: [],
        isFFDoc: false,
      },
    ];
    mockGameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [
        { gameID: 50, round: 2, team1ID: 1, team2ID: 2, winner: null },
        { gameID: 10, round: 1, team1ID: 1, team2ID: 2, winner: null },
        { gameID: 11, round: 1, team1ID: 1, team2ID: 2, winner: null },
      ],
      teams,
    });
    buildFullGridDataMock.mockResolvedValue({ groupData: [] });

    const { pendingGames } = await buildPlaygroundData('G', 2024);
    expect(pendingGames.map((p) => p.gameID)).toEqual([10, 11, 50]);
  });

  test('pendingGames falls back to "Team {id}" name when team not in teamMap', async () => {
    mockGameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [
        { gameID: 5, round: 1, team1ID: 999, team2ID: 1000, winner: null },
      ],
      teams: [], // no team data — exercise the fallback branch
    });
    buildFullGridDataMock.mockResolvedValue({ groupData: [] });

    const { pendingGames } = await buildPlaygroundData('G', 2024);
    expect(pendingGames[0].team1Name).toBe('Team 999');
    expect(pendingGames[0].team2Name).toBe('Team 1000');
    expect(pendingGames[0].team1Seed).toBeNull();
    expect(pendingGames[0].team2Seed).toBeNull();
  });

  test('pendingGames excludes games missing a team slot (one side undecided)', async () => {
    mockGameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [
        { gameID: 5, round: 1, team1ID: 1, team2ID: null, winner: null }, // half-empty: skip
        { gameID: 6, round: 1, team1ID: null, team2ID: 2, winner: null }, // half-empty: skip
        { gameID: 7, round: 1, team1ID: 1, team2ID: 2, winner: null }, // pending: keep
      ],
      teams: [
        {
          sID: 1,
          name: 'A',
          nameNick: 'A',
          seed: 1,
          gameStatus: [],
          isFFDoc: false,
        },
        {
          sID: 2,
          name: 'B',
          nameNick: 'B',
          seed: 2,
          gameStatus: [],
          isFFDoc: false,
        },
      ],
    });
    buildFullGridDataMock.mockResolvedValue({ groupData: [] });

    const { pendingGames } = await buildPlaygroundData('G', 2024);
    expect(pendingGames.map((p) => p.gameID)).toEqual([7]);
  });

  test('repository errors propagate (no swallowing)', async () => {
    mockGameRepository.getAllTournamentDetails.mockRejectedValue(
      new Error('Firestore unavailable'),
    );
    buildFullGridDataMock.mockResolvedValue({ groupData: [] });
    await expect(buildPlaygroundData('G', 2024)).rejects.toThrow(
      'Firestore unavailable',
    );
  });

  test('with no FF play-in games, all non-FFDoc teams remain in schoolRecords', async () => {
    mockGameRepository.getAllTournamentDetails.mockResolvedValue({
      allGames: [{ gameID: 1, round: 1, team1ID: 1, team2ID: 2, winner: 1 }],
      teams: [
        {
          sID: 1,
          name: 'A',
          nameNick: 'A',
          seed: 1,
          gameStatus: ['W'],
          isFFDoc: false,
        },
        {
          sID: 2,
          name: 'B',
          nameNick: 'B',
          seed: 2,
          gameStatus: ['L'],
          isFFDoc: false,
        },
      ],
    });
    buildFullGridDataMock.mockResolvedValue({ groupData: [] });

    const { schoolRecords } = await buildPlaygroundData('G', 2024);
    expect(schoolRecords.map((r) => r.sID).sort()).toEqual([1, 2]);
  });
});
