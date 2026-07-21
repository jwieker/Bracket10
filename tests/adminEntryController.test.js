import {
  findEntry,
  getUnpaidEntries,
  viewEntry,
  entryUpdate,
  addGroup,
  getUnsentEmails,
  markEmailsSentController,
  deleteEntry,
  restoreEntry,
  purgeEntry,
  getDeletedEntriesController,
} from '../src/controllers/adminEntryController.js';

vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  validateEntryPicks: vi.fn(),
  normalizeAndValidateEntryPicks: vi.fn(),
  createNewEntry: vi.fn(),
  addPickCount: vi.fn(),
  calculateMaxPossiblePoints: vi.fn(),
  getAllYearsforGroup: vi.fn(),
  getEntriesForUser: vi.fn(),
  getEntryIdsForUserInGroup: vi.fn(),
  findEntriesByName: vi.fn(),
  addNewGroup: vi.fn(),
  buildFullGridData: vi.fn(),
  buildGameViewData: vi.fn(),
  getUnsentEmailEntries: vi.fn(),
  markEmailsSent: vi.fn(),
  updatePointsForAffectedEntries: vi.fn(),
}));
vi.mock('../src/repositories/index.js', () => ({
  gameRepository: { getEntryById: vi.fn(), updateEntry: vi.fn() },
  teamRepository: {
    getAllSchools: vi.fn(),
    getSchoolById: vi.fn(),
    findSchoolsByName: vi.fn(),
    getMaxSchoolId: vi.fn(),
    insertSchool: vi.fn(),
    deleteSchool: vi.fn(),
    updateSchool: vi.fn(),
    updateSchoolConferenceHistory: vi.fn(),
  },
  entryRepository: {
    getUnpaidEntriesForGroup: vi.fn(),
    deleteEntry: vi.fn(),
    restoreEntry: vi.fn(),
    purgeEntry: vi.fn(),
    getDeletedEntries: vi.fn(),
    updateMultipleEntryPoints: vi.fn(),
  },
  viewRepository: { getAllGroups: vi.fn() },
  conferenceRepository: { getAllConferences: vi.fn() },
}));
vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  isRegistrationOpen: vi.fn(() => true),
  APP_CONFIG: {
    tournament: {
      paymentCollectorGroup: '',
      priorityGroups: [],
      defaultGroup: 'Default',
    },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));

import {
  findEntriesByName,
  addNewGroup,
  verifyGroupExists,
  getGroupRegistrationData,
  calculateMaxPossiblePoints,
  normalizeFirstFourPicks,
  normalizeAndValidateEntryPicks,
  getUnsentEmailEntries,
  markEmailsSent,
  updatePointsForAffectedEntries,
} from '../src/services/index.js';
import {
  gameRepository,
  entryRepository,
  viewRepository,
} from '../src/repositories/index.js';
import { APP_CONFIG } from '../src/config/app.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
    set: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  APP_CONFIG.tournament.paymentCollectorGroup = 'Family';
  APP_CONFIG.tournament.priorityGroups = ['Family', 'House'];
  // The pick pipeline lives in the service layer; default both the low-level FF
  // normalizer and the full pipeline to identity passthroughs. Tests needing a
  // rule violation override normalizeAndValidateEntryPicks to throw.
  normalizeFirstFourPicks.mockImplementation(async (picks) => [...picks]);
  normalizeAndValidateEntryPicks.mockImplementation(async (picks) => [
    ...picks,
  ]);
});

describe('findEntry', () => {
  test('returns 400 when year and name are missing', async () => {
    const req = { query: {}, method: 'GET', url: '/findEntry' };
    const res = mockRes();
    await findEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when name is missing', async () => {
    const req = { query: { year: '2024' }, method: 'GET', url: '/findEntry' };
    const res = mockRes();
    await findEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when year is missing', async () => {
    const req = { query: { name: 'Alex' }, method: 'GET', url: '/findEntry' };
    const res = mockRes();
    await findEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls findEntriesByName and returns json', async () => {
    const entries = [{ id: 1, person: 'Alex' }];
    findEntriesByName.mockResolvedValue(entries);
    const req = {
      query: { year: '2024', name: 'Alex' },
      method: 'GET',
      url: '/findEntry',
    };
    const res = mockRes();
    await findEntry(req, res);
    expect(findEntriesByName).toHaveBeenCalledWith('Alex', '2024');
    expect(res.json).toHaveBeenCalledWith(entries);
  });
});

// ---------------------------------------------------------------------------
// getUnpaidEntries
// ---------------------------------------------------------------------------

describe('getUnpaidEntries', () => {
  test('returns 400 when year is missing', async () => {
    const req = { query: {}, method: 'GET', url: '/getUnpaidEntries' };
    const res = mockRes();
    await getUnpaidEntries(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls entryRepository.getUnpaidEntriesForGroup with the configured collector group and year', async () => {
    const entries = [{ id: 1 }];
    entryRepository.getUnpaidEntriesForGroup.mockResolvedValue(entries);
    const req = {
      query: { year: '2024' },
      method: 'GET',
      url: '/getUnpaidEntries',
    };
    const res = mockRes();
    await getUnpaidEntries(req, res);
    expect(entryRepository.getUnpaidEntriesForGroup).toHaveBeenCalledWith(
      'Family',
      '2024',
    );
    expect(res.json).toHaveBeenCalledWith(entries);
  });
});

// ---------------------------------------------------------------------------
// viewTeam
// ---------------------------------------------------------------------------

describe('viewEntry', () => {
  beforeEach(() => {
    getGroupRegistrationData.mockResolvedValue({
      teamData: [],
      gameData: [],
      regions: [{ regionName: 'East' }, { regionName: 'West' }],
    });
    viewRepository.getAllGroups.mockResolvedValue(['Family', 'House']);
  });

  test('returns 404 when entry is not found', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      query: { entryId: '99', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Entry not found' });
  });

  test('renders editEntry with entry data', async () => {
    const entry = { id: 1, person: 'Alex', picks: [1, 2], groups: ['Family'] };
    gameRepository.getEntryById.mockResolvedValue(entry);
    const req = {
      query: { entryId: '1', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'editEntry',
      expect.objectContaining({
        entryData: entry,
        regions: ['East', 'West'],
      }),
    );
  });

  test('normalises groups to array when entry.groups is not an array', async () => {
    const entry = { id: 1, group: 'Family', picks: [] };
    gameRepository.getEntryById.mockResolvedValue(entry);
    const req = {
      query: { entryId: '1', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.entryData.groups).toEqual(['Family']);
  });

  test('prioritises Family and House at the top of availableGroups', async () => {
    viewRepository.getAllGroups.mockResolvedValue([
      'Alpha',
      'Family',
      'House',
      'Zeta',
    ]);
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      picks: [],
      groups: [],
    });
    const req = {
      query: { entryId: '1', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.availableGroups.slice(0, 2)).toEqual(['Family', 'House']);
  });

  test('returns 400 for a malformed entryId without querying the repository (#335)', async () => {
    const req = {
      query: { entryId: 'x/schoolRecords/y', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
  });

  test('renders with an empty availableGroups list instead of throwing when getAllGroups resolves null (#378)', async () => {
    viewRepository.getAllGroups.mockResolvedValue(null);
    gameRepository.getEntryById.mockResolvedValue({
      id: 1,
      picks: [],
      groups: [],
    });
    const req = {
      query: { entryId: '1', year: '2024', fromAdmin: 'false' },
      method: 'GET',
      url: '/viewEntry',
    };
    const res = mockRes();
    await viewEntry(req, res);
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.availableGroups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// entryUpdate
// ---------------------------------------------------------------------------

describe('entryUpdate', () => {
  test('calls updateEntry with payload and renders confirm', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '202, Kansas',
        groups: ['Family'],
        maxPoints: '150',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        email: 'a@b.com',
        picks: [101, 202],
      }),
    );
    expect(res.render).toHaveBeenCalledWith(
      'confirm',
      expect.objectContaining({ name: 'Alex' }),
    );
  });

  test('normalises groups to array when single string', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        groups: 'Family',
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ groups: ['Family'] }),
    );
  });

  test('rejects duplicate picks with 400 and does not persist (#157)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '101, Duke',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('sets hasPaid from paymentSectionRendered flag', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        groups: [],
        maxPoints: '0',
        paymentSectionRendered: 'true',
        hasPaid: 'on',
        paymentNote: 'cash',
        payByCheck: 'on',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        hasPaid: true,
        paymentNote: 'cash',
        payByCheck: true,
      }),
    );
  });

  test('ignores client maxPoints and persists server-recomputed possPoints (#159)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    calculateMaxPossiblePoints.mockResolvedValue(177);
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '202, Kansas',
        groups: ['Family'],
        maxPoints: '99999',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([101, 202], 2024);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ possPoints: 177 }),
    );
  });

  test('returns 400 for a malformed entryId without persisting (#335)', async () => {
    const req = {
      body: {
        entryId: 'x/schoolRecords/y',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('recomputes totalPoints via updatePointsForAffectedEntries when picks changed (#430)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    gameRepository.getEntryById.mockResolvedValue({ picks: [101] });
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '202, Kansas',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.getEntryById).toHaveBeenCalledWith('1', 2024);
    expect(updatePointsForAffectedEntries).toHaveBeenCalledWith(
      2024,
      [101, 202],
    );
  });

  test('does not recompute totalPoints when picks are unchanged (#430)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    gameRepository.getEntryById.mockResolvedValue({ picks: [101, 202] });
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '202, Kansas',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('zeroes points directly when a repair clears every pick (#430)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    gameRepository.getEntryById.mockResolvedValue({ picks: [101, 202] });
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    // The targeted recompute can't reach a picks-less entry, so the controller
    // must zero the entry's points itself rather than calling the recompute.
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
    expect(entryRepository.updateMultipleEntryPoints).toHaveBeenCalledWith(
      [{ entryID: 1, points: 0, possPoints: 0 }],
      2024,
    );
  });

  test('does not recompute totalPoints when the same picks are merely reordered (#430)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    gameRepository.getEntryById.mockResolvedValue({ picks: [202, 101] });
    const req = {
      body: {
        entryId: '1',
        email: 'a@b.com',
        year: '2024',
        team: 'Dukes',
        name: 'Alex',
        teamSelect1: '101, Duke',
        teamSelect2: '202, Kansas',
        groups: ['Family'],
        maxPoints: '0',
      },
      method: 'POST',
      url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entryVerify — pick parser validation (C2 regression)
// ---------------------------------------------------------------------------

describe('addGroup', () => {
  test('returns 400 when groupName is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/addGroup' };
    const res = mockRes();
    await addGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when groupName is blank', async () => {
    const req = {
      body: { groupName: '   ' },
      method: 'POST',
      url: '/addGroup',
    };
    const res = mockRes();
    await addGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 409 when group already exists', async () => {
    verifyGroupExists.mockResolvedValue('Existing');
    const req = {
      body: { groupName: 'Existing' },
      method: 'POST',
      url: '/addGroup',
    };
    const res = mockRes();
    await addGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('calls addNewGroup and returns 201 on success', async () => {
    verifyGroupExists.mockResolvedValue(null);
    addNewGroup.mockResolvedValue();
    const req = {
      body: { groupName: 'NewGroup' },
      method: 'POST',
      url: '/addGroup',
    };
    const res = mockRes();
    await addGroup(req, res);
    expect(addNewGroup).toHaveBeenCalledWith('NewGroup');
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// ---------------------------------------------------------------------------
// myEntryLookup
// ---------------------------------------------------------------------------

describe('getUnsentEmails', () => {
  test('returns 400 when year is missing', async () => {
    const req = { query: {}, method: 'GET', url: '/getUnsentEmails' };
    const res = mockRes();
    await getUnsentEmails(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns entries from getUnsentEmailEntries', async () => {
    const entries = [{ id: 1 }, { id: 2 }];
    getUnsentEmailEntries.mockResolvedValue(entries);
    const req = {
      query: { year: '2024' },
      method: 'GET',
      url: '/getUnsentEmails',
    };
    const res = mockRes();
    await getUnsentEmails(req, res);
    expect(getUnsentEmailEntries).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { entries, count: 2 },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// markEmailsSentController
// ---------------------------------------------------------------------------

describe('markEmailsSentController', () => {
  test('returns 400 when year is missing', async () => {
    const req = {
      body: { entryIds: [1] },
      method: 'POST',
      url: '/markEmailsSent',
    };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when entryIds is missing', async () => {
    const req = {
      body: { year: 2024 },
      method: 'POST',
      url: '/markEmailsSent',
    };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when entryIds is not an array', async () => {
    const req = {
      body: { year: 2024, entryIds: 'not-array' },
      method: 'POST',
      url: '/markEmailsSent',
    };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls markEmailsSent and returns 200', async () => {
    markEmailsSent.mockResolvedValue();
    const req = {
      body: { year: 2024, entryIds: [1, 2, 3] },
      method: 'POST',
      url: '/markEmailsSent',
    };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(markEmailsSent).toHaveBeenCalledWith([1, 2, 3], 2024);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 and never calls markEmailsSent for a path-shaped entryId (#335)', async () => {
    const req = {
      body: { year: 2024, entryIds: [1, 'x/schoolRecords/y'] },
      method: 'POST',
      url: '/markEmailsSent',
    };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(markEmailsSent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteEntry
// ---------------------------------------------------------------------------

describe('deleteEntry', () => {
  test('returns 400 when entryId is missing', async () => {
    const req = { body: { year: '2024' }, method: 'POST', url: '/deleteEntry' };
    const res = mockRes();
    await deleteEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when year is missing', async () => {
    const req = { body: { entryId: '1' }, method: 'POST', url: '/deleteEntry' };
    const res = mockRes();
    await deleteEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls entryRepository.deleteEntry and redirects to /updates', async () => {
    entryRepository.deleteEntry.mockResolvedValue();
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/deleteEntry',
    };
    const res = mockRes();
    await deleteEntry(req, res);
    expect(entryRepository.deleteEntry).toHaveBeenCalledWith(5, 2024);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
  });
});

// ---------------------------------------------------------------------------
// restoreEntry
// ---------------------------------------------------------------------------

describe('restoreEntry', () => {
  test('returns 400 when entryId or year is missing', async () => {
    const req = {
      body: { year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn(),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(entryRepository.restoreEntry).not.toHaveBeenCalled();
  });

  test('calls entryRepository.restoreEntry and redirects back to the entry for a plain form post', async () => {
    entryRepository.restoreEntry.mockResolvedValue(true);
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(entryRepository.restoreEntry).toHaveBeenCalledWith(5, 2024);
    expect(res.redirect).toHaveBeenCalledWith(
      '/viewEntry?entryId=5&year=2024&fromAdmin=true',
    );
  });

  test('returns JSON when called via fetch (Content-Type: application/json)', async () => {
    entryRepository.restoreEntry.mockResolvedValue(true);
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn().mockReturnValue(true),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  test("recomputes points for the restored entry's picks (#390)", async () => {
    entryRepository.restoreEntry.mockResolvedValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: 5,
      year: 2024,
      picks: [101, 102, 103],
    });
    updatePointsForAffectedEntries.mockResolvedValue();
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(gameRepository.getEntryById).toHaveBeenCalledWith(5, 2024);
    expect(updatePointsForAffectedEntries).toHaveBeenCalledWith(
      2024,
      [101, 102, 103],
    );
  });

  test('skips the recompute when the restored entry has no picks (defensive, should not throw)', async () => {
    entryRepository.restoreEntry.mockResolvedValue(true);
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      '/viewEntry?entryId=5&year=2024&fromAdmin=true',
    );
  });

  test('skips the recompute entirely when restoreEntry reports no change (already-live entry)', async () => {
    entryRepository.restoreEntry.mockResolvedValue(false);
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/restoreEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await restoreEntry(req, res);
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      '/viewEntry?entryId=5&year=2024&fromAdmin=true',
    );
  });
});

// ---------------------------------------------------------------------------
// purgeEntry
// ---------------------------------------------------------------------------

describe('purgeEntry', () => {
  test('returns 400 when entryId or year is missing', async () => {
    const req = {
      body: { entryId: '5' },
      method: 'POST',
      url: '/purgeEntry',
      is: vi.fn(),
    };
    const res = mockRes();
    await purgeEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(entryRepository.purgeEntry).not.toHaveBeenCalled();
  });

  test('calls entryRepository.purgeEntry and redirects to /admin/entries for a plain form post', async () => {
    entryRepository.purgeEntry.mockResolvedValue();
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/purgeEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await purgeEntry(req, res);
    expect(entryRepository.purgeEntry).toHaveBeenCalledWith(5, 2024);
    expect(res.redirect).toHaveBeenCalledWith('/admin/entries');
  });

  test('returns JSON when called via fetch (Content-Type: application/json)', async () => {
    entryRepository.purgeEntry.mockResolvedValue();
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/purgeEntry',
      is: vi.fn().mockReturnValue(true),
    };
    const res = mockRes();
    await purgeEntry(req, res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  test('propagates a 400 when the repository rejects a not-yet-soft-deleted entry', async () => {
    const { ValidationError } = await import('../src/utils/errors.js');
    entryRepository.purgeEntry.mockRejectedValue(
      new ValidationError(
        'Entry must be soft-deleted before it can be permanently deleted.',
        'entryId',
      ),
    );
    const req = {
      body: { entryId: '5', year: '2024' },
      method: 'POST',
      url: '/purgeEntry',
      is: vi.fn().mockReturnValue(false),
    };
    const res = mockRes();
    await purgeEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// getDeletedEntriesController
// ---------------------------------------------------------------------------

describe('getDeletedEntriesController', () => {
  test('returns 400 when year is missing', async () => {
    const req = { query: {}, method: 'GET', url: '/admin/deleted-entries' };
    const res = mockRes();
    await getDeletedEntriesController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns the repository result as JSON', async () => {
    const deleted = [
      { id: 5, person: 'Alice', deletedAt: '2024-03-01T00:00:00.000Z' },
    ];
    entryRepository.getDeletedEntries.mockResolvedValue(deleted);
    const req = {
      query: { year: '2024' },
      method: 'GET',
      url: '/admin/deleted-entries',
    };
    const res = mockRes();
    await getDeletedEntriesController(req, res);
    expect(entryRepository.getDeletedEntries).toHaveBeenCalledWith(2024);
    expect(res.json).toHaveBeenCalledWith(deleted);
  });
});
