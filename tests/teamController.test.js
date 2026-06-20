import { viewTeam, updateTeam, findTeam, addTeamPage, addTeam, addTeamApi, deleteTeam } from '../src/controllers/teamController.js';

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

import { teamRepository, conferenceRepository } from '../src/repositories/index.js';

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

beforeEach(() => { vi.clearAllMocks(); });

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

