import { requireSiteAdmin } from '../src/middleware/adminMiddleware.js';
import { errorMiddleware } from '../src/middleware/errorMiddleware.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import { ValidationError, DatabaseError, ServiceError } from '../src/utils/errors.js';

vi.mock('../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    performance: vi.fn(),
  },
}));

import Logger from '../src/utils/logger.js';

// ---------------------------------------------------------------------------
// adminMiddleware
// ---------------------------------------------------------------------------

describe('requireSiteAdmin', () => {
  function makeReqRes(sessionOverrides = {}) {
    const req = { session: sessionOverrides };
    const res = { redirect: vi.fn() };
    const next = vi.fn();
    return { req, res, next };
  }

  test('calls next() when siteAdmin is true', () => {
    const { req, res, next } = makeReqRes({ siteAdmin: true });
    requireSiteAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to /updates when siteAdmin is false', () => {
    const { req, res, next } = makeReqRes({ siteAdmin: false });
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects when session has no siteAdmin property', () => {
    const { req, res, next } = makeReqRes({});
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects when session is undefined', () => {
    const req = { session: undefined };
    const res = { redirect: vi.fn() };
    const next = vi.fn();
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rateLimit
// ---------------------------------------------------------------------------

describe('rateLimit', () => {
  function makeReq(ip = '127.0.0.1') {
    return {
      ip,
      headers: {},
      socket: {},
    };
  }

  function makeRes() {
    return {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  }

  test('allows requests under the configured max', () => {
    const limiter = rateLimit({ windowMs: 1000, max: 2, standardHeaders: true });
    const next = vi.fn();

    limiter(makeReq(), makeRes(), next);
    limiter(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  test('blocks requests over the configured max', () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1, message: 'slow down' });
    const next = vi.fn();

    limiter(makeReq(), makeRes(), next);
    const blockedRes = makeRes();
    limiter(makeReq(), blockedRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.send).toHaveBeenCalledWith('slow down');
  });

  test('tracks clients independently', () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    const next = vi.fn();

    limiter(makeReq('127.0.0.1'), makeRes(), next);
    limiter(makeReq('127.0.0.2'), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// errorMiddleware
// ---------------------------------------------------------------------------

function makeMockRes(acceptJson = true) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res;
}

function mockReq(acceptJson = true) {
  return {
    headers: { accept: acceptJson ? 'application/json' : 'text/html' },
    method: 'POST',
    originalUrl: '/test',
  };
}

describe('errorMiddleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('returns 400 JSON for ValidationError (JSON client)', () => {
    const err = new ValidationError('bad input', 'email');
    const req = mockReq(true);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation Error',
      message: 'bad input',
      field: 'email',
    }));
  });

  test('returns 400 plain text for ValidationError (HTML client)', () => {
    const err = new ValidationError('bad input', 'email');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('bad input');
  });

  test('returns 500 JSON for DatabaseError with verbose fields when DEBUG_ERRORS is set', () => {
    process.env.DEBUG_ERRORS = '1';
    try {
      const err = new DatabaseError('db fail', 'read');
      const req = mockReq(true);
      const res = makeMockRes();
      errorMiddleware(err, req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Database Error',
        message: 'db fail',
        operation: 'read',
      }));
    } finally {
      delete process.env.DEBUG_ERRORS;
    }
  });

  // E3 regression: previously `NODE_ENV !== 'production'` was enough to leak
  // internal fields (operation, raw message). Now those require an explicit
  // DEBUG_ERRORS opt-in, so staging/preview environments don't accidentally
  // expose them.
  test('returns generic JSON for DatabaseError by default (no DEBUG_ERRORS), regardless of NODE_ENV', () => {
    delete process.env.DEBUG_ERRORS;
    process.env.NODE_ENV = 'test';
    const err = new DatabaseError('db fail', 'read');
    const req = mockReq(true);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Database Error',
      message: 'A database error occurred.',
    });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('operation');
    expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Database error'), err);
  });

  test('returns 500 plain text for DatabaseError (HTML client)', () => {
    const err = new DatabaseError('db fail');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('A database error occurred.');
  });

  test('returns 500 JSON for ServiceError with verbose fields when DEBUG_ERRORS is set', () => {
    process.env.DEBUG_ERRORS = '1';
    try {
      const err = new ServiceError('svc fail', 'myService');
      const req = mockReq(true);
      const res = makeMockRes();
      errorMiddleware(err, req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Service Error',
        message: 'svc fail',
        service: 'myService',
      }));
    } finally {
      delete process.env.DEBUG_ERRORS;
    }
  });

  test('returns generic JSON for ServiceError by default (no DEBUG_ERRORS), regardless of NODE_ENV', () => {
    delete process.env.DEBUG_ERRORS;
    process.env.NODE_ENV = 'test';
    const err = new ServiceError('svc fail', 'myService');
    const req = mockReq(true);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Service Error',
      message: 'A service error occurred.',
    });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('service');
    expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Service error'), err);
  });

  test('returns 500 JSON for unknown error', () => {
    const err = new Error('totally unexpected');
    const req = mockReq(true);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Internal Server Error',
    }));
  });

  test('returns 500 plain text for unknown error (HTML client)', () => {
    const err = new Error('boom');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('An unexpected error occurred');
  });

  test('returns 500 when the inner response call crashes', () => {
    const err = new ValidationError('bad', 'f');
    // Cause json to throw on first call (simulating a broken response pipeline)
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementationOnce(() => { throw new Error('json crash'); }),
      send: vi.fn(),
    };
    const req = mockReq(true);
    errorMiddleware(err, req, res, vi.fn());
    expect(res.send).toHaveBeenCalledWith('Internal Server Error');
  });
});
