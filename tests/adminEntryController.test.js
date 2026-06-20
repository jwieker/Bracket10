import { findEntry, getUnpaidEntries, viewEntry, entryUpdate, addGroup, getUnsentEmails, markEmailsSentController, deleteEntry } from '../src/controllers/adminEntryController.js';

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
  entryRepository: { getUnpaidEntriesForGroup: vi.fn(), deleteEntry: vi.fn() },
  viewRepository: { getAllGroups: vi.fn() },
  conferenceRepository: { getAllConferences: vi.fn() },
}));
vi.mock('../src/config/app.js', () => ({
  thisYear: 2024,
  isRegistrationOpen: vi.fn(() => true),
  APP_CONFIG: {
    tournament: { paymentCollectorGroup: '', priorityGroups: [], defaultGroup: 'Default' },
    payments: { collectorName: '', collectorEmail: '', collectorPhone: '' },
  },
}));

import { findEntriesByName, addNewGroup, verifyGroupExists, getGroupRegistrationData, calculateMaxPossiblePoints, normalizeFirstFourPicks, normalizeAndValidateEntryPicks, getUnsentEmailEntries, markEmailsSent } from '../src/services/index.js';
import { gameRepository, entryRepository, viewRepository } from '../src/repositories/index.js';
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
  normalizeAndValidateEntryPicks.mockImplementation(async (picks) => [...picks]);
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
    const req = { query: { year: '2024', name: 'Alex' }, method: 'GET', url: '/findEntry' };
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
    const req = { query: { year: '2024' }, method: 'GET', url: '/getUnpaidEntries' };
    const res = mockRes();
    await getUnpaidEntries(req, res);
    expect(entryRepository.getUnpaidEntriesForGroup).toHaveBeenCalledWith('Family', '2024');
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
    const req = { query: { entryId: '99', year: '2024', fromAdmin: 'false' }, method: 'GET', url: '/viewEntry' };
    const res = mockRes();
    await viewEntry(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Entry not found' });
  });

  test('renders editEntry with entry data', async () => {
    const entry = { id: 1, person: 'Alex', picks: [1, 2], groups: ['Family'] };
    gameRepository.getEntryById.mockResolvedValue(entry);
    const req = { query: { entryId: '1', year: '2024', fromAdmin: 'false' }, method: 'GET', url: '/viewEntry' };
    const res = mockRes();
    await viewEntry(req, res);
    expect(res.render).toHaveBeenCalledWith('editEntry', expect.objectContaining({
      entryData: entry,
      regions: ['East', 'West'],
    }));
  });

  test('normalises groups to array when entry.groups is not an array', async () => {
    const entry = { id: 1, group: 'Family', picks: [] };
    gameRepository.getEntryById.mockResolvedValue(entry);
    const req = { query: { entryId: '1', year: '2024', fromAdmin: 'false' }, method: 'GET', url: '/viewEntry' };
    const res = mockRes();
    await viewEntry(req, res);
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.entryData.groups).toEqual(['Family']);
  });

  test('prioritises Family and House at the top of availableGroups', async () => {
    viewRepository.getAllGroups.mockResolvedValue(['Alpha', 'Family', 'House', 'Zeta']);
    gameRepository.getEntryById.mockResolvedValue({ id: 1, picks: [], groups: [] });
    const req = { query: { entryId: '1', year: '2024', fromAdmin: 'false' }, method: 'GET', url: '/viewEntry' };
    const res = mockRes();
    await viewEntry(req, res);
    const rendered = res.render.mock.calls[0][1];
    expect(rendered.availableGroups.slice(0, 2)).toEqual(['Family', 'House']);
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
        entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
        teamSelect1: '101, Duke', teamSelect2: '202, Kansas',
        groups: ['Family'], maxPoints: '150',
      },
      method: 'POST', url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: '1', email: 'a@b.com', picks: [101, 202],
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({ name: 'Alex' }));
  });

  test('normalises groups to array when single string', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
        teamSelect1: '101, Duke',
        groups: 'Family', maxPoints: '0',
      },
      method: 'POST', url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ groups: ['Family'] })
    );
  });

  test('rejects duplicate picks with 400 and does not persist (#157)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: {
        entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
        teamSelect1: '101, Duke', teamSelect2: '101, Duke',
        groups: ['Family'], maxPoints: '0',
      },
      method: 'POST', url: '/entryUpdate',
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
        entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
        teamSelect1: '101, Duke', groups: [], maxPoints: '0',
        paymentSectionRendered: 'true', hasPaid: 'on', paymentNote: 'cash', payByCheck: 'on',
      },
      method: 'POST', url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ hasPaid: true, paymentNote: 'cash', payByCheck: true })
    );
  });

  test('ignores client maxPoints and persists server-recomputed possPoints (#159)', async () => {
    gameRepository.updateEntry.mockResolvedValue();
    calculateMaxPossiblePoints.mockResolvedValue(177);
    const req = {
      body: {
        entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
        teamSelect1: '101, Duke', teamSelect2: '202, Kansas',
        groups: ['Family'], maxPoints: '99999',
      },
      method: 'POST', url: '/entryUpdate',
    };
    const res = mockRes();
    await entryUpdate(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([101, 202], 2024);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ possPoints: 177 })
    );
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
    const req = { body: { groupName: '   ' }, method: 'POST', url: '/addGroup' };
    const res = mockRes();
    await addGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 409 when group already exists', async () => {
    verifyGroupExists.mockResolvedValue('Existing');
    const req = { body: { groupName: 'Existing' }, method: 'POST', url: '/addGroup' };
    const res = mockRes();
    await addGroup(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('calls addNewGroup and returns 201 on success', async () => {
    verifyGroupExists.mockResolvedValue(null);
    addNewGroup.mockResolvedValue();
    const req = { body: { groupName: 'NewGroup' }, method: 'POST', url: '/addGroup' };
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
    const req = { query: { year: '2024' }, method: 'GET', url: '/getUnsentEmails' };
    const res = mockRes();
    await getUnsentEmails(req, res);
    expect(getUnsentEmailEntries).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: { entries, count: 2 },
    }));
  });
});

// ---------------------------------------------------------------------------
// markEmailsSentController
// ---------------------------------------------------------------------------

describe('markEmailsSentController', () => {
  test('returns 400 when year is missing', async () => {
    const req = { body: { entryIds: [1] }, method: 'POST', url: '/markEmailsSent' };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when entryIds is missing', async () => {
    const req = { body: { year: 2024 }, method: 'POST', url: '/markEmailsSent' };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when entryIds is not an array', async () => {
    const req = { body: { year: 2024, entryIds: 'not-array' }, method: 'POST', url: '/markEmailsSent' };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls markEmailsSent and returns 200', async () => {
    markEmailsSent.mockResolvedValue();
    const req = { body: { year: 2024, entryIds: [1, 2, 3] }, method: 'POST', url: '/markEmailsSent' };
    const res = mockRes();
    await markEmailsSentController(req, res);
    expect(markEmailsSent).toHaveBeenCalledWith([1, 2, 3], 2024);
    expect(res.status).toHaveBeenCalledWith(200);
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
    const req = { body: { entryId: '5', year: '2024' }, method: 'POST', url: '/deleteEntry' };
    const res = mockRes();
    await deleteEntry(req, res);
    expect(entryRepository.deleteEntry).toHaveBeenCalledWith(5, 2024);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
  });
});

