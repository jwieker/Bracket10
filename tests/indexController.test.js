import { index } from '../src/controllers/indexController.js';

function mockRes() {
  return {
    render: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
}

function mockReq(query = {}) {
  return { body: {}, query, method: 'GET', url: '/' };
}

describe('indexController - index', () => {
  test('renders index with state "test" in test environment', async () => {
    const req = mockReq();
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ state: 'test' }),
    );
  });

  test('sets error: true when query.error === "true"', async () => {
    const req = mockReq({ error: 'true' });
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ error: true }),
    );
  });

  test('sets error: false when query.error is absent', async () => {
    const req = mockReq();
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ error: false }),
    );
  });

  test('sets createError: true when query.createError === "true"', async () => {
    const req = mockReq({ createError: 'true' });
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ createError: true }),
    );
  });

  test('sets createError: false when query.createError is absent', async () => {
    const req = mockReq();
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ createError: false }),
    );
  });

  test('passes thisYear in render data', async () => {
    const req = mockReq();
    const res = mockRes();
    await index(req, res);
    const renderArgs = res.render.mock.calls[0][1];
    expect(renderArgs.thisYear).toBeDefined();
  });
});
