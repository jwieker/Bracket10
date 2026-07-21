import {
  gamesVerify,
  regionVerify,
} from '../src/controllers/tourneyController.js';
import {
  createNewBracketStructure,
  prepareRegionVerifyData,
} from '../src/services/tourneyService.js';

// Mock the tourneyRepository instance in tourneyService.js
vi.mock('../src/services/tourneyService.js', async () => {
  const originalModule = await vi.importActual(
    '../src/services/tourneyService.js',
  );
  const mockedTourneyRepository = {
    insertMultipleGamesWithoutTeams: vi.fn().mockResolvedValue(),
    insertMultipleGamesWithTeams: vi.fn().mockResolvedValue(),
    insertMultipleSchoolRecords: vi.fn().mockResolvedValue(),
    getAllRegions: vi.fn().mockResolvedValue([
      { regionID: 1, regionName: 'East' },
      { regionID: 2, regionName: 'West' },
      { regionID: 3, regionName: 'South' },
      { regionID: 4, regionName: 'Midwest' },
    ]),
    getAllTeams: vi.fn().mockResolvedValue([
      {
        sid: 345,
        name: 'Abilene Christian',
        mascot: 'Wildcats',
        nameNick: 'ACU',
        confID: 32,
      },
      {
        sid: 125,
        name: 'Air Force',
        mascot: 'Falcons',
        nameNick: 'Air Force',
        confID: 11,
      },
      { sid: 103, name: 'Akron', mascot: 'Zips', nameNick: 'Akron', confID: 9 },
      {
        sid: 11,
        name: 'Xavier University',
        mascot: 'Musketeers',
        nameNick: 'Xavier',
        confID: 1,
      },
      {
        sid: 213,
        name: 'Yale',
        mascot: 'Bulldogs',
        nameNick: 'Yale',
        confID: 18,
      },
      {
        sid: 205,
        name: 'Youngstown State',
        mascot: 'Penguins',
        nameNick: 'YSU',
        confID: 17,
      },
    ]),
  };
  return {
    ...originalModule,
    tourneyRepository: mockedTourneyRepository,
    createNewBracket: vi.fn().mockResolvedValue(),
    prepareRegionVerifyData: vi.fn(async (regions, _year) => {
      const allRegionNames = await mockedTourneyRepository.getAllRegions();
      const regionNames = regions.map(
        (regionId) =>
          allRegionNames.find((r) => r.regionID === regionId)?.regionName,
      );
      const allTeams = await mockedTourneyRepository.getAllTeams();
      const seeds = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

      return {
        regions,
        regionNames,
        allTeams,
        seeds,
      };
    }),
  };
});

describe('gamesVerify', () => {
  let mockClient;
  let mockQuery;
  let res;

  beforeEach(() => {
    // Reset mocks before each test
    mockQuery = vi.fn().mockResolvedValue([[]]);
    mockClient = {
      query: mockQuery,
      createQueryJob: vi.fn().mockResolvedValue([
        {
          getQueryResults: vi.fn().mockResolvedValue([[]]),
        },
      ]),
    };

    // Mock response object
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    // tourneyRepository is provided via the vi.mock() factory above
    vi.clearAllMocks();
  });

  const req = {
    body: {
      year: 2023,
      region: [3, 1, 4, 2], //games verify puts this into an array
      games: [
        '3-1-1-23',
        '3-1-16-272',
        '3-2-8-82',
        '3-2-9-92',
        '3-3-5-28',
        '3-3-12-279',
        '3-4-4-52',
        '3-4-13-176',
        '3-5-6-46',
        '3-5-11-7',
        '3-6-3-74',
        '3-6-14-327',
        '3-7-7-17',
        '3-7-10-63',
        '3-8-2-6',
        '3-8-15-290',
        '1-16-1-73',
        '1-16-16-304',
        '1-17-8-42',
        '1-17-9-13',
        '1-18-5-121',
        '1-18-12-149',
        '1-19-4-1',
        '1-19-13-216',
        '1-20-6-77',
        '1-20-11-56',
        '1-21-3-116',
        '1-21-14-347',
        '1-22-7-20',
        '1-22-10-126',
        '1-23-2-58',
        '1-23-15-340',
        '4-31-1-41',
        '4-31-16-262',
        '4-32-8-12',
        '4-32-9-80',
        '4-33-5-132',
        '4-33-12-184',
        '4-34-4-38',
        '4-34-13-246',
        '4-35-6-3',
        '4-35-11-34',
        '4-36-3-67',
        '4-36-14-355',
        '4-37-7-50',
        '4-37-10-135',
        '4-38-2-55',
        '4-38-15-212',
        '2-46-1-71',
        '2-46-16-200',
        '2-47-8-15',
        '2-47-9-43',
        '2-48-5-32',
        '2-48-12-152',
        '2-49-4-14',
        '2-49-13-109',
        '2-50-6-72',
        '2-50-11-49',
        '2-51-3-11',
        '2-51-14-317',
        '2-52-7-53',
        '2-52-10-22',
        '2-53-2-78',
        '2-53-15-237',
      ],
    },
  };

  test('should successfully create a new bracket', async () => {
    // Setup successful query responses
    mockClient.createQueryJob.mockResolvedValue([
      {
        getQueryResults: vi.fn().mockResolvedValue([[]]),
      },
    ]);
    mockQuery.mockResolvedValue([]);

    await gamesVerify(req, res);

    // Verify correct response was sent
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'New Bracket Created Successfully',
    });

    // Verify correct number of database insertions
    // Verify correct number of database insertions
    //expect(tourneyRepository.insertMultipleGamesWithoutTeams).toHaveBeenCalledTimes(1);
    //expect(tourneyRepository.insertMultipleGamesWithTeams).toHaveBeenCalledTimes(1);
    //expect(tourneyRepository.insertMultipleSchoolRecords).toHaveBeenCalledTimes(1);
  });
});

describe('createNewBracket', () => {
  test('should correctly format games and team records', async () => {
    const year = 2023;
    const regionArray = [3, 1, 4, 2];
    const games = [
      '3-1-1-23',
      '3-1-16-272',
      '3-2-8-82',
      '3-2-9-92',
      '3-3-5-28',
      '3-3-12-279',
      '3-4-4-52',
      '3-4-13-176',
      '3-5-6-46',
      '3-5-11-7',
      '3-6-3-74',
      '3-6-14-327',
      '3-7-7-17',
      '3-7-10-63',
      '3-8-2-6',
      '3-8-15-290',
      '1-16-1-73',
      '1-16-16-304',
      '1-17-8-42',
      '1-17-9-13',
      '1-18-5-121',
      '1-18-12-149',
      '1-19-4-1',
      '1-19-13-216',
      '1-20-6-77',
      '1-20-11-56',
      '1-21-3-116',
      '1-21-14-347',
      '1-22-7-20',
      '1-22-10-126',
      '1-23-2-58',
      '1-23-15-340',
      '4-31-1-41',
      '4-31-16-262',
      '4-32-8-12',
      '4-32-9-80',
      '4-33-5-132',
      '4-33-12-184',
      '4-34-4-38',
      '4-34-13-246',
      '4-35-6-3',
      '4-35-11-34',
      '4-36-3-67',
      '4-36-14-355',
      '4-37-7-50',
      '4-37-10-135',
      '4-38-2-55',
      '4-38-15-212',
      '2-46-1-71',
      '2-46-16-200',
      '2-47-8-15',
      '2-47-9-43',
      '2-48-5-32',
      '2-48-12-152',
      '2-49-4-14',
      '2-49-13-109',
      '2-50-6-72',
      '2-50-11-49',
      '2-51-3-11',
      '2-51-14-317',
      '2-52-7-53',
      '2-52-10-22',
      '2-53-2-78',
      '2-53-15-237',
    ];

    const { gamesFormat, teamRecordFormat } = await createNewBracketStructure(
      games,
      year,
      regionArray,
    );

    // Test first round game format
    expect(gamesFormat[0]).toEqual([1, 3, 2023, 23, 272, null, 1, 9, 1, 1, 16]);
    expect(gamesFormat[8]).toEqual([
      16,
      1,
      2023,
      73,
      304,
      null,
      1,
      24,
      1,
      1,
      16,
    ]);
    expect(gamesFormat[16]).toEqual([
      31,
      4,
      2023,
      41,
      262,
      null,
      1,
      39,
      1,
      1,
      16,
    ]);
    expect(gamesFormat[24]).toEqual([
      46,
      2,
      2023,
      71,
      200,
      null,
      1,
      54,
      1,
      1,
      16,
    ]);

    // Test future games format (games without teams)
    expect(gamesFormat[32]).toEqual([
      9,
      3,
      2023,
      null,
      null,
      null,
      2,
      13,
      1,
      null,
      null,
    ]);
    expect(gamesFormat[33]).toEqual([
      10,
      3,
      2023,
      null,
      null,
      null,
      2,
      13,
      2,
      null,
      null,
    ]);
    expect(gamesFormat[62]).toEqual([
      63,
      6,
      2023,
      null,
      null,
      null,
      6,
      0,
      null,
      null,
      null,
    ]);

    // Test team record format - UPDATED
    expect(teamRecordFormat[0]).toEqual({
      sID: 23,
      year: 2023,
      seed: 1,
      regionID: 3,
    });
    expect(teamRecordFormat[16]).toEqual({
      sID: 73,
      year: 2023,
      seed: 1,
      regionID: 1,
    });
    expect(teamRecordFormat[32]).toEqual({
      sID: 41,
      year: 2023,
      seed: 1,
      regionID: 4,
    });
    expect(teamRecordFormat[63]).toEqual({
      sID: 237,
      year: 2023,
      seed: 15,
      regionID: 2,
    });

    // Test array lengths
    expect(gamesFormat.length).toBe(63); // 32 first round + 31 future games
    expect(teamRecordFormat.length).toBe(64); // 32 matchups * 2 teams
  });
});

describe('regionVerify', () => {
  let res;
  let req;

  beforeEach(() => {
    // Mock response object
    res = {
      render: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    req = {
      body: {
        year: '2026',
        region0: '2',
        region1: '3',
        region2: '4',
        region3: '1',
      },
    };
  });

  test('should render newTourneyGames with correct data', async () => {
    await regionVerify(req, res);

    expect(prepareRegionVerifyData).toHaveBeenCalledWith([2, 3, 4, 1], 2026);
    expect(res.render).toHaveBeenCalledWith('newTourneyGames', {
      year: 2026,
      regions: [2, 3, 4, 1],
      regionNames: ['West', 'South', 'Midwest', 'East'],
      allTeams: [
        {
          sid: 345,
          name: 'Abilene Christian',
          mascot: 'Wildcats',
          nameNick: 'ACU',
          confID: 32,
        },
        {
          sid: 125,
          name: 'Air Force',
          mascot: 'Falcons',
          nameNick: 'Air Force',
          confID: 11,
        },
        {
          sid: 103,
          name: 'Akron',
          mascot: 'Zips',
          nameNick: 'Akron',
          confID: 9,
        },
        {
          sid: 11,
          name: 'Xavier University',
          mascot: 'Musketeers',
          nameNick: 'Xavier',
          confID: 1,
        },
        {
          sid: 213,
          name: 'Yale',
          mascot: 'Bulldogs',
          nameNick: 'Yale',
          confID: 18,
        },
        {
          sid: 205,
          name: 'Youngstown State',
          mascot: 'Penguins',
          nameNick: 'YSU',
          confID: 17,
        },
      ],
      seeds: [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15],
    });
  });
});
