import {
  calculateMaxPoints,
  entryConfirm,
  entryVerify,
  findEntry,
  getUnpaidEntries,
  viewTeam,
  updateTeam,
  findTeam,
  addTeamPage,
  addTeam,
  addTeamApi,
  deleteTeam,
  viewEntry,
  entryUpdate,
  addGroup,
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
  getUnsentEmails,
  markEmailsSentController,
  deleteEntry,
  getFullGridCSV,
} from '../src/controllers/viewController.js';
import { toCSVRow } from '../src/utils/csvUtils.js';

vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  normalizeFirstFourPicks: vi.fn(),
  createNewEntry: vi.fn(),
  addPickCount: vi.fn(),
  calculateMaxPossiblePoints: vi.fn(),
  getAllYearsforGroup: vi.fn(),
  getEntriesForUser: vi.fn(),
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

vi.mock('../src/middleware/rateLimit.js', () => ({
  registerFailedAttempt: vi.fn(async () => false),
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
    payments: {
      collectorName: '',
      collectorEmail: '',
      collectorPhone: '',
    },
  },
}));

import { calculateMaxPossiblePoints, findEntriesByName, verifyGroupExists, addNewGroup, getGroupRegistrationData, normalizeFirstFourPicks, getUnsentEmailEntries, markEmailsSent, getEntriesForUser, buildFullGridData } from '../src/services/index.js';
import { entryRepository, teamRepository, conferenceRepository, gameRepository, viewRepository } from '../src/repositories/index.js';
import { isRegistrationOpen, APP_CONFIG } from '../src/config/app.js';
import { registerFailedAttempt } from '../src/middleware/rateLimit.js';

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
  // Reset tournament config to the legacy fixture values these tests were
  // written against (group names that used to be hardcoded in viewController).
  APP_CONFIG.tournament.paymentCollectorGroup = 'Family';
  APP_CONFIG.tournament.priorityGroups = ['Family', 'House'];
  // FF normalization is identity by default; FF-specific tests override it.
  normalizeFirstFourPicks.mockImplementation(async (picks) => [...picks]);
});

// ---------------------------------------------------------------------------
// calculateMaxPoints
// ---------------------------------------------------------------------------

describe('calculateMaxPoints', () => {
  test('returns 400 when teamSIDs is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when teamSIDs is not an array', async () => {
    const req = { body: { teamSIDs: 'not-an-array' }, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation Error' }));
  });

  test('calls calculateMaxPossiblePoints and returns 200 with maxPoints', async () => {
    calculateMaxPossiblePoints.mockResolvedValue(150);
    const req = { body: { teamSIDs: [1, 2, 3], year: '2024' }, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([1, 2, 3], 2024);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { maxPoints: 150 },
    }));
  });

  test('passes undefined year when not provided', async () => {
    calculateMaxPossiblePoints.mockResolvedValue(99);
    const req = { body: { teamSIDs: [1] }, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith([1], undefined);
  });

  test('returns 400 for invalid year', async () => {
    const req = { body: { teamSIDs: [1], year: 'abc' }, method: 'POST', url: '/calculateMaxPoints' };
    const res = mockRes();
    await calculateMaxPoints(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation Error', field: 'year' }));
  });
});

// ---------------------------------------------------------------------------
// entryConfirm
// ---------------------------------------------------------------------------

function makeConfirmSession(overrides = {}) {
  const payload = {
    name: 'Alex', team: 'Dukes', groupName: 'Family',
    picksNames: ['Duke', 'Kansas', 'UNC'],
    expiresAt: Date.now() + 600_000,
    ...overrides,
  };
  return {
    session: { pendingConfirmations: { 'abc123': payload } },
    payload,
  };
}

describe('entryConfirm', () => {
  test('renders confirm from session token', async () => {
    const { session, payload } = makeConfirmSession();
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({
      name: payload.name,
      team: payload.team,
      groupName: payload.groupName,
      picksNames: payload.picksNames,
    }));
  });

  test('isPaymentCollectorGroup is true when groupName matches the configured collector group', async () => {
    const { session } = makeConfirmSession({ groupName: 'Family' });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(true);
  });

  test('isPaymentCollectorGroup is false when groupName does not match', async () => {
    const { session } = makeConfirmSession({ groupName: 'House' });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.render.mock.calls[0][1].isPaymentCollectorGroup).toBe(false);
  });

  test('returns 404 and renders confirmExpired when token is missing', async () => {
    const req = { query: {}, session: { pendingConfirmations: {} }, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is not found in session', async () => {
    const req = { query: { token: 'badtoken' }, session: { pendingConfirmations: {} }, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('returns 404 when token is expired', async () => {
    const { session } = makeConfirmSession({ expiresAt: Date.now() - 1 });
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('confirmExpired');
  });

  test('deletes token from session after use', async () => {
    const { session } = makeConfirmSession();
    const req = { query: { token: 'abc123' }, session, method: 'GET', url: '/entryConfirm' };
    const res = mockRes();
    await entryConfirm(req, res);
    expect(session.pendingConfirmations['abc123']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findEntry
// ---------------------------------------------------------------------------

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

describe('viewTeam', () => {
  test('returns 400 when teamId is missing', async () => {
    const req = { query: {}, method: 'GET', url: '/viewTeam' };
    const res = mockRes();
    await viewTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when team is not found', async () => {
    teamRepository.getSchoolById.mockResolvedValue(null);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    const req = { query: { teamId: '99' }, method: 'GET', url: '/viewTeam' };
    const res = mockRes();
    await viewTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('renders editTeam with team and conferences', async () => {
    const team = { sid: 1, name: 'Duke' };
    const conferences = [{ id: 'ACC', name: 'Atlantic Coast Conference' }];
    teamRepository.getSchoolById.mockResolvedValue(team);
    conferenceRepository.getAllConferences.mockResolvedValue(conferences);
    const req = { query: { teamId: '1' }, method: 'GET', url: '/viewTeam' };
    const res = mockRes();
    await viewTeam(req, res);
    expect(teamRepository.getSchoolById).toHaveBeenCalledWith(1);
    expect(res.render).toHaveBeenCalledWith('editTeam', { team, isNew: false, conferences });
  });
});

// ---------------------------------------------------------------------------
// updateTeam
// ---------------------------------------------------------------------------

describe('updateTeam', () => {
  test('returns 400 when sid is missing', async () => {
    const req = { body: { name: 'Duke' }, method: 'POST', url: '/updateTeam' };
    const res = mockRes();
    await updateTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when name is missing', async () => {
    const req = { body: { sid: '1' }, method: 'POST', url: '/updateTeam' };
    const res = mockRes();
    await updateTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls updateSchool and redirects on success', async () => {
    teamRepository.updateSchool.mockResolvedValue();
    const req = {
      body: { sid: '1', name: 'Duke', mascot: 'Blue Devils', nameNick: 'Duke', confID: 'ACC' },
      method: 'POST', url: '/updateTeam',
    };
    const res = mockRes();
    await updateTeam(req, res);
    expect(teamRepository.updateSchool).toHaveBeenCalledWith({ sid: 1, name: 'Duke', mascot: 'Blue Devils', nameNick: 'Duke', confID: 'ACC' });
    expect(res.redirect).toHaveBeenCalledWith('/viewTeam?teamId=1');
  });

  test('calls updateSchoolConferenceHistory when confHistory array is provided', async () => {
    teamRepository.updateSchool.mockResolvedValue();
    teamRepository.updateSchoolConferenceHistory.mockResolvedValue();
    const req = {
      body: {
        sid: '1', name: 'Duke',
        confHistory: [{ confID: 'ACC', startYear: '2000', endYear: '' }],
      },
      method: 'POST', url: '/updateTeam',
    };
    const res = mockRes();
    await updateTeam(req, res);
    expect(teamRepository.updateSchoolConferenceHistory).toHaveBeenCalledWith(1, [
      { confID: 'ACC', startYear: 2000, endYear: null },
    ]);
  });

  test('skips confHistory rows with empty confID', async () => {
    teamRepository.updateSchool.mockResolvedValue();
    teamRepository.updateSchoolConferenceHistory.mockResolvedValue();
    const req = {
      body: {
        sid: '1', name: 'Duke',
        confHistory: [{ confID: '', startYear: '2000', endYear: '' }],
      },
      method: 'POST', url: '/updateTeam',
    };
    const res = mockRes();
    await updateTeam(req, res);
    expect(teamRepository.updateSchoolConferenceHistory).toHaveBeenCalledWith(1, []);
  });
});

// ---------------------------------------------------------------------------
// findTeam
// ---------------------------------------------------------------------------

describe('findTeam', () => {
  test('returns 400 when name is missing', async () => {
    const req = { query: {}, method: 'GET', url: '/findTeam' };
    const res = mockRes();
    await findTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls findSchoolsByName and returns json', async () => {
    const teams = [{ sid: 1, name: 'Duke' }];
    teamRepository.findSchoolsByName.mockResolvedValue(teams);
    const req = { query: { name: 'Duke' }, method: 'GET', url: '/findTeam' };
    const res = mockRes();
    await findTeam(req, res);
    expect(teamRepository.findSchoolsByName).toHaveBeenCalledWith('Duke');
    expect(res.json).toHaveBeenCalledWith(teams);
  });
});

// ---------------------------------------------------------------------------
// addTeamPage
// ---------------------------------------------------------------------------

describe('addTeamPage', () => {
  test('renders editTeam with isNew=true and empty team', async () => {
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    const req = { method: 'GET', url: '/addTeamPage' };
    const res = mockRes();
    await addTeamPage(req, res);
    expect(res.render).toHaveBeenCalledWith('editTeam', expect.objectContaining({ isNew: true }));
  });
});

// ---------------------------------------------------------------------------
// addTeam
// ---------------------------------------------------------------------------

describe('addTeam', () => {
  test('returns 400 when name is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/addTeam' };
    const res = mockRes();
    await addTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('inserts school with newSid and redirects', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(10);
    teamRepository.insertSchool.mockResolvedValue();
    const req = {
      body: { name: 'Duke', mascot: 'Blue Devils', nameNick: 'Duke', confID: 'ACC' },
      method: 'POST', url: '/addTeam',
    };
    const res = mockRes();
    await addTeam(req, res);
    expect(teamRepository.insertSchool).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 11, name: 'Duke' })
    );
    expect(res.redirect).toHaveBeenCalledWith('/viewTeam?teamId=11');
  });

  test('uses sid=1 when max school id is null', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(null);
    teamRepository.insertSchool.mockResolvedValue();
    const req = { body: { name: 'New School' }, method: 'POST', url: '/addTeam' };
    const res = mockRes();
    await addTeam(req, res);
    expect(teamRepository.insertSchool).toHaveBeenCalledWith(expect.objectContaining({ sid: 1 }));
  });

  test('sets confID to null when not provided', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(5);
    teamRepository.insertSchool.mockResolvedValue();
    const req = { body: { name: 'Duke' }, method: 'POST', url: '/addTeam' };
    const res = mockRes();
    await addTeam(req, res);
    expect(teamRepository.insertSchool).toHaveBeenCalledWith(expect.objectContaining({ confID: null }));
  });
});

// ---------------------------------------------------------------------------
// addTeamApi
// ---------------------------------------------------------------------------

describe('addTeamApi', () => {
  test('returns 400 when name is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/addTeamApi' };
    const res = mockRes();
    await addTeamApi(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'School name is required' });
  });

  test('inserts school and returns 201 with new team data', async () => {
    teamRepository.getMaxSchoolId.mockResolvedValue(20);
    teamRepository.insertSchool.mockResolvedValue();
    const req = {
      body: { name: 'Duke', mascot: 'Blue Devils', nameNick: 'Duke', confID: 'ACC' },
      method: 'POST', url: '/addTeamApi',
    };
    const res = mockRes();
    await addTeamApi(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 21, name: 'Duke', confID: 'ACC' })
    );
  });
});

// ---------------------------------------------------------------------------
// deleteTeam
// ---------------------------------------------------------------------------

describe('deleteTeam', () => {
  test('returns 400 when sid is missing', async () => {
    const req = { body: {}, method: 'POST', url: '/deleteTeam' };
    const res = mockRes();
    await deleteTeam(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls deleteSchool and redirects to /updates', async () => {
    teamRepository.deleteSchool.mockResolvedValue();
    const req = { body: { sid: '5' }, method: 'POST', url: '/deleteTeam' };
    const res = mockRes();
    await deleteTeam(req, res);
    expect(teamRepository.deleteSchool).toHaveBeenCalledWith(5);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
  });
});

// ---------------------------------------------------------------------------
// viewEntry
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

describe('entryVerify pick parser', () => {
  // Builds a body with N valid picks plus any overrides supplied by the caller.
  function buildBody(overrides = {}) {
    const body = {
      name: 'Alex',
      team: 'Dukes',
      email: 'a@b.com',
      groupName: 'Test Group',
      year: '2024',
      maxPoints: '0',
    };
    for (let i = 1; i <= 10; i++) body[`teamSelect${i}`] = `${100 + i}, Team ${i}`;
    return { ...body, ...overrides };
  }

  function wireRegistrationMocks() {
    verifyGroupExists.mockResolvedValue('Test Group');
    getGroupRegistrationData.mockResolvedValue({
      teamData: Array.from({ length: 10 }, (_, i) => ({ sID: 101 + i, nameNick: `Team ${i + 1}`, seed: 1, regionName: 'East' })),
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    teamRepository.getAllSchools.mockResolvedValue([]);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
    // #159: possPoints is now recomputed server-side; default the recompute to 0
    // so existing assertions remain stable. Individual tests override as needed.
    calculateMaxPossiblePoints.mockResolvedValue(0);
  }

  test('rejects a pick whose team name contains ", " (split yields >2 parts)', async () => {
    wireRegistrationMocks();
    // "St. Mary's, CA" splits to ["101", "St. Mary's", "CA"] — 3 parts
    const req = {
      body: buildBody({ teamSelect3: "101, St. Mary's, CA" }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 3.*malformed/i) })
    );
    // createNewEntry must not be called when input is rejected
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  test('rejects a pick with a non-integer ID', async () => {
    wireRegistrationMocks();
    const req = {
      body: buildBody({ teamSelect5: 'notanumber, Duke' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 5.*invalid team ID/i) })
    );
  });

  test('rejects a pick whose team name is empty', async () => {
    wireRegistrationMocks();
    const req = {
      body: buildBody({ teamSelect7: '107, ' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 7.*invalid team name/i) })
    );
  });

  test('accepts 10 well-formed picks and proceeds to createNewEntry', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com',
      'Dukes',
      'Alex',
      'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024,
      0
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/entryConfirm\?token=/));
  });

  test('ignores client-supplied maxPoints and persists the server-recomputed possPoints (#159)', async () => {
    wireRegistrationMocks();
    // The client claims an inflated maxPoints; the server must recompute and
    // persist its own value, never the form value.
    calculateMaxPossiblePoints.mockResolvedValue(150);
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody({ maxPoints: '99999' }),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    // maxPoints recomputed from the normalized picks (not req.body.maxPoints).
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 2024
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com', 'Dukes', 'Alex', 'Test Group',
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024, 150
    );
  });

  test('persists FF-normalized picks on creation (stale FF pick lands on the live winner)', async () => {
    wireRegistrationMocks();
    // Pick 101 is an FF team whose game resolved with winner 999 while the
    // registration form was open; the stored entry must hold 999.
    normalizeFirstFourPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p))
    );
    getGroupRegistrationData.mockResolvedValue({
      teamData: [
        { sID: 999, nameNick: 'FF Winner', seed: 16, regionName: 'East' },
        ...Array.from({ length: 9 }, (_, i) => ({ sID: 102 + i, nameNick: `Team ${i + 2}`, seed: 1, regionName: 'East' })),
      ],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    const { createNewEntry } = await import('../src/services/index.js');
    createNewEntry.mockResolvedValue();
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(normalizeFirstFourPicks).toHaveBeenCalledWith(
      [101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 2024
    );
    expect(createNewEntry).toHaveBeenCalledWith(
      'a@b.com', 'Dukes', 'Alex', 'Test Group',
      [999, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      2024, 0
    );
  });

  test('rejects creation when both FF teams of one game normalize to the same pick', async () => {
    wireRegistrationMocks();
    // 101 and 102 are the two teams of one unresolved FF game → both map to 101.
    normalizeFirstFourPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 102 ? 101 : p))
    );
    const { createNewEntry } = await import('../src/services/index.js');
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: (cb) => cb() },
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Duplicate team picks/i) })
    );
    expect(createNewEntry).not.toHaveBeenCalled();
  });

  // C7 regression: session save must happen BEFORE createNewEntry so a save
  // failure can't leave a successfully-written Firestore entry without a
  // confirmation token, which would silently produce duplicates on retry.
  test('writes pendingConfirmations + session.save BEFORE createNewEntry (C7 regression)', async () => {
    wireRegistrationMocks();
    const { createNewEntry } = await import('../src/services/index.js');
    const callOrder = [];
    createNewEntry.mockImplementation(async () => {
      callOrder.push('createNewEntry');
    });
    const saveSpy = vi.fn((cb) => {
      callOrder.push('session.save');
      cb();
    });
    const req = {
      body: buildBody(),
      method: 'POST',
      url: '/entryVerify',
      session: { save: saveSpy },
    };
    const res = mockRes();
    await entryVerify(req, res);
    // session.save must precede the DB write
    expect(callOrder).toEqual(['session.save', 'createNewEntry']);
    // The pending payload must be persisted on the session before save fires
    expect(req.session.pendingConfirmations).toBeDefined();
    const tokens = Object.keys(req.session.pendingConfirmations);
    expect(tokens).toHaveLength(1);
    expect(req.session.pendingConfirmations[tokens[0]]).toMatchObject({
      name: 'Alex',
      team: 'Dukes',
      groupName: 'Test Group',
    });
  });

  test('rejects a pick that is not in the active tournament team list (invalid/eliminated)', async () => {
    wireRegistrationMocks();
    // registration mock teamData only has 101-110. Pick 5 is 105 (valid), but let's override pick 5 to 999.
    const req = {
      body: buildBody({ teamSelect5: '999, Fake Team' }),
      method: 'POST',
      url: '/entryVerify',
    };
    const res = mockRes();
    await entryVerify(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'registration',
      expect.objectContaining({ errorMessage: expect.stringMatching(/Pick 5 is not a valid team/i) })
    );
    const { createNewEntry } = await import('../src/services/index.js');
    expect(createNewEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addGroup
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

describe('myEntryLookup', () => {
  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { query: {}, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('renders myEntryLookup when registration is open', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = { query: {}, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith('myEntryLookup', expect.objectContaining({ currentYear: 2024 }));
  });

  test('passes error query param to view', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = { query: { error: 'notfound' }, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith('myEntryLookup', expect.objectContaining({ error: 'notfound' }));
  });

  test('passes entryId and year query params to view for pre-fill', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = { query: { entryId: 'abc123', year: '2024' }, method: 'GET', url: '/my-entry' };
    const res = mockRes();
    await myEntryLookup(req, res);
    expect(res.render).toHaveBeenCalledWith('myEntryLookup', expect.objectContaining({ entryId: 'abc123', year: '2024' }));
  });
});

// ---------------------------------------------------------------------------
// myEntryVerify
// ---------------------------------------------------------------------------

describe('myEntryVerify', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { body: { entryId: '1', year: '2024', email: 'a@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('returns 400 when email is missing', async () => {
    const req = { body: { entryId: '1', year: '2024' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('redirects with error=invalid when entry not found', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = { body: { entryId: 'bad', year: '2024', email: 'a@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid'));
  });

  test('redirects with error=invalid when email does not match', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'real@b.com' });
    const req = { body: { entryId: '1', year: '2024', email: 'wrong@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid'));
  });

  test('not-found and email-mismatch produce an identical response (no existence oracle — #166)', async () => {
    // Same entryId/year/email for both cases so the redirect query string
    // (which echoes them) is directly comparable; the only difference is whether
    // the entry exists. The responses must be byte-identical so the endpoint
    // can't be used to probe which entry IDs exist.
    const body = { entryId: '1', year: '2024', email: 'wrong@b.com' };

    gameRepository.getEntryById.mockResolvedValue(null); // not found
    const resNotFound = mockRes();
    await myEntryVerify({ body, session: {}, method: 'POST', url: '/my-entry/verify' }, resNotFound);

    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'real@b.com' }); // exists, wrong email
    const resMismatch = mockRes();
    await myEntryVerify({ body, session: {}, method: 'POST', url: '/my-entry/verify' }, resMismatch);

    // Neither short-circuits to a distinguishable branch: same redirect target,
    // and neither sets a status (both fall through to the same 302 redirect).
    expect(resNotFound.redirect.mock.calls).toEqual(resMismatch.redirect.mock.calls);
    expect(resNotFound.status.mock.calls).toEqual(resMismatch.status.mock.calls);
    expect(resNotFound.render.mock.calls).toEqual(resMismatch.render.mock.calls);
  });

  test('a whitespace email never authenticates against an entry with empty/null stored email (#166)', async () => {
    // Both submitted and stored normalize to '' under trim+lowercase; the
    // `!!entryData?.email` guard must reject the match rather than grant access.
    for (const storedEmail of ['', null, undefined]) {
      gameRepository.getEntryById.mockResolvedValue({ id: '1', email: storedEmail });
      const session = { regenerate: vi.fn((cb) => cb(null)), save: vi.fn((cb) => cb(null)) };
      const req = { body: { entryId: '1', year: '2024', email: '   ' }, session, method: 'POST', url: '/my-entry/verify' };
      const res = mockRes();
      await myEntryVerify(req, res);
      // Must NOT reach the verified-edit path.
      expect(res.redirect).not.toHaveBeenCalledWith(expect.stringContaining('/my-entry/edit'));
      expect(session.regenerate).not.toHaveBeenCalled();
    }
  });

  test('counts a failed verification toward the per-entryId guard', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'real@b.com' });
    const req = { body: { entryId: '7', year: '2024', email: 'wrong@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(registerFailedAttempt).toHaveBeenCalledWith('verify:7', expect.any(Number), expect.any(Number));
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=invalid'));
  });

  test('uses the tightened 5-failures / 15-minute verify window (#166 interim)', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'real@b.com' });
    const req = { body: { entryId: '7', year: '2024', email: 'wrong@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(registerFailedAttempt).toHaveBeenCalledWith('verify:7', 15 * 60 * 1000, 5);
  });

  test('matches email constant-time with trim + case folding (#166)', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'User@Example.COM' });
    const session = { regenerate: vi.fn((cb) => cb(null)), save: vi.fn((cb) => cb(null)) };
    const req = { body: { entryId: '1', year: '2024', email: '  user@example.com  ' }, session, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry/edit'));
    expect(registerFailedAttempt).not.toHaveBeenCalled();
  });

  test('returns 429 once the per-entryId failure window is exhausted', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'real@b.com' });
    registerFailedAttempt.mockResolvedValueOnce(true);
    const req = { body: { entryId: '1', year: '2024', email: 'wrong@b.com' }, session: {}, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.render).toHaveBeenCalledWith('myEntryLookup', expect.objectContaining({ error: 'ratelimited' }));
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('a successful verification never consumes the failure bucket', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'a@b.com' });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = { body: { entryId: '1', year: '2024', email: 'a@b.com' }, session, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(registerFailedAttempt).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry/edit'));
  });

  test('email comparison is case-insensitive', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'User@Example.COM' });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = { body: { entryId: '1', year: '2024', email: 'user@example.com' }, session, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry/edit'));
  });

  test('sets session flag and redirects to edit on valid email', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'a@b.com' });
    const session = {
      regenerate: vi.fn((cb) => cb(null)),
      save: vi.fn((cb) => cb(null)),
    };
    const req = { body: { entryId: '1', year: '2024', email: 'a@b.com' }, session, method: 'POST', url: '/my-entry/verify' };
    const res = mockRes();
    await myEntryVerify(req, res);
    expect(session.verifiedEntries?.['2024:1']).toBe(true);
    expect(session.regenerate).toHaveBeenCalled();
    expect(session.save).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry/edit'));
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('entryId=1'));
  });
});

// ---------------------------------------------------------------------------
// myEntryView
// ---------------------------------------------------------------------------

describe('myEntryView', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
    getGroupRegistrationData.mockResolvedValue({
      teamData: [], gameData: [], regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { query: { entryId: '1', year: '2024' }, session: { verifiedEntries: { '2024:1': true } }, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when entryId or year are missing', async () => {
    const req = { query: {}, session: {}, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('redirects to /my-entry when session is missing', async () => {
    const req = { query: { entryId: '1', year: '2024' }, session: {}, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry'));
    expect(res.render).not.toHaveBeenCalled();
  });

  test('redirects to /my-entry when entryId not in session', async () => {
    const req = { query: { entryId: '1', year: '2024' }, session: { verifiedEntries: { '99': true } }, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/my-entry'));
    expect(res.render).not.toHaveBeenCalled();
  });

  test('redirects to error when entry is not found', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = { query: { entryId: '99', year: '2024' }, session: { verifiedEntries: { '2024:99': true } }, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
  });

  test('renders myEditEntry when session is valid', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: 1, picks: [], groups: ['Family'] });
    const req = { query: { entryId: '1', year: '2024' }, session: { verifiedEntries: { '2024:1': true } }, method: 'GET', url: '/my-entry/edit' };
    const res = mockRes();
    await myEntryView(req, res);
    expect(res.render).toHaveBeenCalledWith('myEditEntry', expect.objectContaining({ regions: ['East'] }));
  });
});

// ---------------------------------------------------------------------------
// myEntryUpdate
// ---------------------------------------------------------------------------

// applyEntryUpdate requires exactly 10 unique picks, mirroring entryVerify.
const tenPickIds = Array.from({ length: 10 }, (_, i) => 101 + i);
const tenPickSelections = Object.fromEntries(
  tenPickIds.map((sID, i) => [`teamSelect${i + 1}`, `${sID}, Team ${sID}`])
);
const tenPickTeamData = tenPickIds.map((sID, i) => ({
  sID, nameNick: `Team ${sID}`, seed: i + 1, regionName: 'East',
}));

describe('myEntryUpdate', () => {
  const validBody = {
    entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
    ...tenPickSelections, groups: 'Family', maxPoints: '0',
  };

  beforeEach(() => {
    getGroupRegistrationData.mockResolvedValue({
      teamData: tenPickTeamData,
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 when registration is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { body: validBody, session: { verifiedEntries: { '2024:1': true } }, method: 'POST', url: '/my-entry/update' };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('redirects to /my-entry when session is missing', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = { body: validBody, session: {}, method: 'POST', url: '/my-entry/update' };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('calls updateEntry and renders confirm when session is valid', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'stored@b.com',
      groups: ['House'],
      hasPaid: true,
      paymentNote: 'stored note',
      payByCheck: true,
      emailSent: true,
    });
    gameRepository.updateEntry.mockResolvedValue();
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: '1',
      year: '2024',
      email: 'stored@b.com',
      groups: ['House'],
      hasPaid: true,
      paymentNote: 'stored note',
      payByCheck: true,
      emailSent: true,
      person: 'Alex',
      teamName: 'Dukes',
      picks: tenPickIds,
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({ name: 'Alex' }));
  });

  test('ignores client maxPoints and persists server-recomputed possPoints (#159)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1', email: 'stored@b.com', groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
    calculateMaxPossiblePoints.mockResolvedValue(142);
    const req = {
      body: { ...validBody, maxPoints: '99999' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(calculateMaxPossiblePoints).toHaveBeenCalledWith(tenPickIds, '2024');
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ possPoints: 142 })
    );
  });

  test('session for same entry in another year cannot update', async () => {
    isRegistrationOpen.mockReturnValue(true);
    const req = {
      body: { ...validBody, year: '2025' },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry');
    expect(gameRepository.getEntryById).not.toHaveBeenCalled();
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('ignores groups and email from request body and preserves stored values', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
      hasPaid: false,
      paymentNote: 'keep me',
      payByCheck: false,
      emailSent: false,
    });
    const req = {
      body: {
        ...validBody,
        email: 'attacker@example.com',
        groups: ['Family', 'Injected'],
      },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      email: 'original@example.com',
      groups: ['OriginalGroup'],
      paymentNote: 'keep me',
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({
      groupName: 'OriginalGroup',
      isPaymentCollectorGroup: false,
    }));
  });

  test('redirects to notfound when verified entry no longer exists', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-entry?error=notfound');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('returns 400 when invalid picks are submitted', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'original@example.com',
      groups: ['OriginalGroup'],
    });
    // We override the default getGroupRegistrationData mock here to not include 101, making it invalid.
    getGroupRegistrationData.mockResolvedValue({
      teamData: [{ sID: 202, nameNick: 'Kansas', seed: 1, regionName: 'East' }],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });

    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: expect.stringMatching(/Pick 1 is not a valid team/i)
    }));
  });

  test('returns 400 when duplicate picks are submitted', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1', email: 'original@example.com', groups: ['OriginalGroup'],
    });
    const req = {
      body: { ...validBody, teamSelect2: validBody.teamSelect1 },
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: expect.stringMatching(/Duplicate team picks/i)
    }));
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('returns 400 when fewer than 10 picks are submitted', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1', email: 'original@example.com', groups: ['OriginalGroup'],
    });
    const { teamSelect10, ...partialBody } = validBody;
    const req = {
      body: partialBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: expect.stringMatching(/Exactly 10 team picks/i)
    }));
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('First Four picks are normalized at write time — stored picks come from live game state', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1', email: 'stored@b.com', groups: ['House'],
    });
    gameRepository.updateEntry.mockResolvedValue();
    // Pick 101 is an FF team whose game resolved with winner 999 (a stale-form
    // submission). Normalization maps it; validation must accept the winner.
    normalizeFirstFourPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 101 ? 999 : p))
    );
    getGroupRegistrationData.mockResolvedValue({
      teamData: [
        ...tenPickTeamData.filter((t) => t.sID !== 101),
        { sID: 999, nameNick: 'FF Winner', seed: 16, regionName: 'East' },
      ],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });

    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(normalizeFirstFourPicks).toHaveBeenCalledWith(tenPickIds, '2024');
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      picks: [999, ...tenPickIds.slice(1)],
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.anything());
  });

  test('returns 400 when two FF teams of the same game normalize to one pick (duplicate)', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1', email: 'stored@b.com', groups: ['House'],
    });
    // Picks 101 and 102 are the two teams of one unresolved FF game: both
    // normalize to the combined value 101 → duplicate, must be rejected.
    normalizeFirstFourPicks.mockImplementation(async (picks) =>
      picks.map((p) => (p === 102 ? 101 : p))
    );
    const req = {
      body: validBody,
      session: { verifiedEntries: { '2024:1': true } },
      method: 'POST', url: '/my-entry/update',
    };
    const res = mockRes();
    await myEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: expect.stringMatching(/Duplicate team picks/i)
    }));
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getUnsentEmails
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// myBrackets (Google-authenticated dashboard)
// ---------------------------------------------------------------------------

describe('myBrackets', () => {
  test("renders the dashboard with the signed-in user's entries", async () => {
    isRegistrationOpen.mockReturnValue(true);
    getEntriesForUser.mockResolvedValue([{ id: 'a', year: 2024, editable: true }]);
    const req = { session: { userEmail: 'player@gmail.com' }, method: 'GET', url: '/my-brackets' };
    const res = mockRes();
    await myBrackets(req, res);
    expect(getEntriesForUser).toHaveBeenCalledWith('player@gmail.com');
    expect(res.render).toHaveBeenCalledWith('myBrackets', expect.objectContaining({
      userEmail: 'player@gmail.com',
      entries: [{ id: 'a', year: 2024, editable: true }],
    }));
  });
});

// ---------------------------------------------------------------------------
// userEntryView (authorized by session email ownership)
// ---------------------------------------------------------------------------

describe('userEntryView', () => {
  beforeEach(() => {
    isRegistrationOpen.mockReturnValue(true);
    getGroupRegistrationData.mockResolvedValue({ teamData: [], gameData: [], regions: [{ regionName: 'East' }] });
  });

  test('returns 403 when the edit window is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { query: { entryId: '1', year: '2024' }, session: { userEmail: 'u@g.com' }, method: 'GET', url: '/my-brackets/edit' };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('returns 403 for a past (non-current) year even while the window is open', async () => {
    const req = { query: { entryId: '1', year: '2023' }, session: { userEmail: 'u@g.com' }, method: 'GET', url: '/my-brackets/edit' };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when the entry is owned by a different email', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: 1, email: 'someone-else@g.com', picks: [], groups: [] });
    const req = { query: { entryId: '1', year: '2024' }, session: { userEmail: 'u@g.com' }, method: 'GET', url: '/my-brackets/edit' };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith('myEntryClosed');
  });

  test('redirects to /my-brackets when the entry does not exist', async () => {
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = { query: { entryId: '99', year: '2024' }, session: { userEmail: 'u@g.com' }, method: 'GET', url: '/my-brackets/edit' };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
  });

  test('renders the editor (posting to /my-brackets/update) for an owned entry, case-insensitively', async () => {
    gameRepository.getEntryById.mockResolvedValue({ id: 1, email: 'U@G.com', picks: [], groups: ['Fam'] });
    const req = { query: { entryId: '1', year: '2024' }, session: { userEmail: 'u@g.com' }, method: 'GET', url: '/my-brackets/edit' };
    const res = mockRes();
    await userEntryView(req, res);
    expect(res.render).toHaveBeenCalledWith('myEditEntry', expect.objectContaining({ updateAction: '/my-brackets/update' }));
  });
});

// ---------------------------------------------------------------------------
// userEntryUpdate (authorized by session email ownership)
// ---------------------------------------------------------------------------

describe('userEntryUpdate', () => {
  const validBody = {
    entryId: '1', year: '2024', team: 'Dukes', name: 'Alex',
    ...tenPickSelections, maxPoints: '0',
  };

  beforeEach(() => {
    getGroupRegistrationData.mockResolvedValue({
      teamData: tenPickTeamData,
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
  });

  test('returns 403 and does not write when the edit window is closed', async () => {
    isRegistrationOpen.mockReturnValue(false);
    const req = { body: validBody, session: { userEmail: 'u@g.com' }, method: 'POST', url: '/my-brackets/update' };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('returns 403 and does not write when the entry is owned by a different email', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'someone-else@g.com', groups: ['X'] });
    const req = { body: validBody, session: { userEmail: 'u@g.com' }, method: 'POST', url: '/my-brackets/update' };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('redirects to /my-brackets when the entry does not exist', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue(null);
    const req = { body: validBody, session: { userEmail: 'u@g.com' }, method: 'POST', url: '/my-brackets/update' };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
    expect(gameRepository.updateEntry).not.toHaveBeenCalled();
  });

  test('persists and renders confirm for an owned entry, preserving stored email/groups', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({ id: '1', email: 'u@g.com', groups: ['House'], hasPaid: true });
    gameRepository.updateEntry.mockResolvedValue();
    const req = { body: validBody, session: { userEmail: 'u@g.com' }, method: 'POST', url: '/my-brackets/update' };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(gameRepository.updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: '1', year: '2024', email: 'u@g.com', groups: ['House'], picks: tenPickIds,
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.anything());
  });

  test('returns 400 when invalid picks are submitted', async () => {
    isRegistrationOpen.mockReturnValue(true);
    gameRepository.getEntryById.mockResolvedValue({
      id: '1',
      email: 'u@g.com',
      groups: ['House'],
    });
    // Override getGroupRegistrationData mock to not include 101, making it invalid.
    getGroupRegistrationData.mockResolvedValue({
      teamData: [{ sID: 202, nameNick: 'Kansas', seed: 1, regionName: 'East' }],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });

    const req = {
      body: validBody,
      session: { userEmail: 'u@g.com' },
      method: 'POST', url: '/my-brackets/update',
    };
    const res = mockRes();
    await userEntryUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: expect.stringMatching(/Pick 1 is not a valid team/i)
    }));
  });
});

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

describe('toCSVRow formula injection neutralization', () => {
  test('cells beginning with a formula char are prefixed with a single quote', () => {
    expect(toCSVRow(['=HYPERLINK("http://evil")']))
      .toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(toCSVRow(['+1+1'])).toBe("'+1+1");
    expect(toCSVRow(['@SUM(A1)'])).toBe("'@SUM(A1)");
    expect(toCSVRow(['-2'])).toBe("'-2");
    expect(toCSVRow(['\t=cmd'])).toBe("'\t=cmd");
  });

  test('benign values are untouched', () => {
    expect(toCSVRow(['House Pool'])).toBe('House Pool');
    expect(toCSVRow([42, '', null])).toBe('42,,');
  });

  test('quoting still applies after neutralization', () => {
    expect(toCSVRow(['=A1,B1'])).toBe('"\'=A1,B1"');
  });

  test('a negative number is emitted as text — conscious tradeoff, fails loudly if a signed column is added', () => {
    // FORMULA_LEAD includes leading "-" (OWASP set), so a negative numeric
    // cell becomes '-2 (text) in the export. Harmless today because every
    // numeric export column (Rank, Points, counts, pick indexes) is
    // non-negative. If this test starts mattering — i.e. a signed column is
    // added to getFullGridCSV — exempt actual numbers from neutralization
    // (e.g. only neutralize string-typed cells) rather than dropping "-"
    // from FORMULA_LEAD.
    expect(toCSVRow([-2])).toBe("'-2");
    expect(toCSVRow(['-2'])).toBe("'-2");
  });
});

// ---------------------------------------------------------------------------
// getFullGridCSV — numeric integrity of the real export
// ---------------------------------------------------------------------------

describe('getFullGridCSV numeric integrity', () => {
  test('score columns come through as exact plain numbers while a hostile name is neutralized', async () => {
    buildFullGridData.mockResolvedValue({
      groupData: [
        {
          rank: 1,
          person: '=HYPERLINK("http://evil")',
          teamName: 'Legit Team',
          totalPoints: 87,
          teamsRemaining: 3,
          teamsAdvanced: 5,
          highestPlace: 1,
          possPoints: 120,
          pickNames: [{ sID: 10 }, { sID: 20 }],
        },
        {
          rank: 2,
          person: 'Jordan',
          teamName: 'Benign',
          totalPoints: 0,
          teamsRemaining: 0,
          teamsAdvanced: 0,
          highestPlace: 2,
          possPoints: 64,
          pickNames: [{ sID: 20 }],
        },
      ],
      allTeamsWithPickCounts: [
        { sID: 10, seed: 1, name: 'Duke', gameStatus: ['W'] },
        { sID: 20, seed: 2, name: 'Kansas', gameStatus: [] },
      ],
    });
    const req = { query: { gameName: 'House', gameYear: '2024' }, method: 'GET', url: '/getFullGridCSV' };
    const res = { ...mockRes(), setHeader: vi.fn() };

    await getFullGridCSV(req, res);

    const csv = res.send.mock.calls[0][0];
    const [, , row1, row2] = csv.split('\r\n');

    // Row 1: the hostile name is neutralized, but every numeric column is the
    // exact unprefixed number — a wrongly-applied neutralization here would
    // turn scores into text and corrupt the standings export.
    const cells1 = row1.split(',');
    expect(cells1[0]).toBe('1');                         // Rank
    expect(cells1[1]).toBe('"\'=HYPERLINK(""http://evil"")"'); // Entry (neutralized)
    expect(cells1[2]).toBe('Legit Team');                // Team
    expect(cells1[3]).toBe('87');                        // Points
    expect(cells1[4]).toBe('3');                         // Teams Remaining
    expect(cells1[5]).toBe('5');                         // Advanced
    expect(cells1[6]).toBe('1');                         // Best Rank
    expect(cells1[7]).toBe('120');                       // Max Score
    expect(cells1[8]).toBe('1');                         // pick index for Duke
    expect(cells1[9]).toBe('2');                         // pick index for Kansas

    // Row 2: zeros and benign strings pass through untouched.
    const cells2 = row2.split(',');
    expect(cells2.slice(0, 8)).toEqual(['2', 'Jordan', 'Benign', '0', '0', '0', '2', '64']);

    // No numeric cell anywhere in the data rows picked up a quote prefix.
    expect([...cells1.slice(3, 10), ...cells2.slice(3, 8)].every((c) => !c.startsWith("'"))).toBe(true);
  });
});
