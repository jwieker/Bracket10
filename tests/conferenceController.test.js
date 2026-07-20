import {
  listConferences,
  viewConference,
  updateConference,
  addConferencePage,
  addConference,
} from '../src/controllers/conferenceController.js';

vi.mock('../src/repositories/index.js', () => ({
  conferenceRepository: {
    getAllConferences: vi.fn(),
    getConferenceBySlug: vi.fn(),
    updateConference: vi.fn(),
    insertConference: vi.fn(),
  },
}));

import { conferenceRepository } from '../src/repositories/index.js';

function mockRes() {
  return {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    send: vi.fn(),
  };
}

function mockReq(overrides = {}) {
  return {
    body: {},
    query: {},
    method: 'GET',
    url: '/conferences',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listConferences', () => {
  test('renders manageConferences with conferences', async () => {
    const conferences = [{ slug: 'acc', name: 'ACC' }];
    conferenceRepository.getAllConferences.mockResolvedValue(conferences);

    const res = mockRes();
    await listConferences(mockReq(), res);
    expect(res.render).toHaveBeenCalledWith('manageConferences', {
      conferences,
    });
  });
});

describe('viewConference', () => {
  test('returns 400 when slug is missing', async () => {
    const res = mockRes();
    await viewConference(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 when conference not found', async () => {
    conferenceRepository.getConferenceBySlug.mockResolvedValue(null);
    const res = mockRes();
    await viewConference(mockReq({ query: { slug: 'unknown' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('renders editConference when found', async () => {
    const conf = { slug: 'acc', name: 'ACC' };
    conferenceRepository.getConferenceBySlug.mockResolvedValue(conf);
    const res = mockRes();
    await viewConference(mockReq({ query: { slug: 'acc' } }), res);
    expect(res.render).toHaveBeenCalledWith('editConference', {
      conference: conf,
      isNew: false,
    });
  });
});

describe('updateConference', () => {
  test('returns 400 when slug is missing', async () => {
    const res = mockRes();
    await updateConference(mockReq({ body: { name: 'ACC' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when name is missing', async () => {
    const res = mockRes();
    await updateConference(mockReq({ body: { slug: 'acc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('redirects to viewConference on success', async () => {
    conferenceRepository.updateConference.mockResolvedValue();
    const res = mockRes();
    await updateConference(
      mockReq({ body: { slug: 'acc', name: 'ACC' } }),
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith('/viewConference?slug=acc');
  });
});

describe('addConferencePage', () => {
  test('renders editConference with blank form', async () => {
    const res = mockRes();
    await addConferencePage(mockReq(), res);
    expect(res.render).toHaveBeenCalledWith(
      'editConference',
      expect.objectContaining({ isNew: true }),
    );
  });
});

describe('addConference', () => {
  test('returns 400 when slug is missing', async () => {
    const res = mockRes();
    await addConference(mockReq({ body: { name: 'ACC' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when name is missing', async () => {
    const res = mockRes();
    await addConference(mockReq({ body: { slug: 'acc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 409 when slug already exists', async () => {
    conferenceRepository.getConferenceBySlug.mockResolvedValue({
      slug: 'acc',
      name: 'ACC',
    });
    const res = mockRes();
    await addConference(mockReq({ body: { slug: 'acc', name: 'ACC' } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('redirects to viewConference on success', async () => {
    conferenceRepository.getConferenceBySlug.mockResolvedValue(null);
    conferenceRepository.insertConference.mockResolvedValue();
    const res = mockRes();
    await addConference(mockReq({ body: { slug: 'sec', name: 'SEC' } }), res);
    expect(res.redirect).toHaveBeenCalledWith('/viewConference?slug=sec');
  });
});
