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
  getUnsentEmails,
  markEmailsSentController,
  deleteEntry,
} from '../src/controllers/viewController.js';


vi.mock('../src/services/index.js', () => ({
  getGroupTeamDetails: vi.fn(),
  addTeamProgressforGroup: vi.fn(),
  verifyGroupExists: vi.fn(),
  getGroupRegistrationData: vi.fn(),
  createNewEntry: vi.fn(),
  addPickCount: vi.fn(),
  calculateMaxPossiblePoints: vi.fn(),
  getAllYearsforGroup: vi.fn(),
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

import { calculateMaxPossiblePoints, findEntriesByName, verifyGroupExists, addNewGroup, getGroupRegistrationData, getUnsentEmailEntries, markEmailsSent } from '../src/services/index.js';
import { entryRepository, teamRepository, conferenceRepository, gameRepository, viewRepository } from '../src/repositories/index.js';
import { isRegistrationOpen, APP_CONFIG } from '../src/config/app.js';

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
      teamData: [],
      gameData: [],
      regions: [{ regionName: 'East' }],
    });
    teamRepository.getAllSchools.mockResolvedValue([]);
    conferenceRepository.getAllConferences.mockResolvedValue([]);
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

describe('myEntryUpdate', () => {
  const validBody = {
    entryId: '1', email: 'a@b.com', year: '2024', team: 'Dukes', name: 'Alex',
    teamSelect1: '101, Duke', groups: 'Family', maxPoints: '0',
  };

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
      picks: [101],
    }));
    expect(res.render).toHaveBeenCalledWith('confirm', expect.objectContaining({ name: 'Alex' }));
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
});

// ---------------------------------------------------------------------------
// getUnsentEmails
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
