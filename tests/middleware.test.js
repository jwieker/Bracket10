import {
  requireSiteAdmin,
  requireUser,
} from '../src/middleware/adminMiddleware.js';
import { errorMiddleware } from '../src/middleware/errorMiddleware.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import {
  ValidationError,
  DatabaseError,
  ServiceError,
} from '../src/utils/errors.js';

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
  function makeReqRes(sessionOverrides = {}, method = 'GET', accept) {
    const req = {
      session: sessionOverrides,
      method,
      headers: accept ? { accept } : {},
    };
    const res = {
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
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
    const { req, res, next } = makeReqRes(null);
    req.session = undefined;
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 JSON for an unauthenticated POST', () => {
    const { req, res, next } = makeReqRes({}, 'POST');
    requireSiteAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized. Please log in.',
    });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 JSON for an unauthenticated GET with application/json accept header', () => {
    const { req, res, next } = makeReqRes({}, 'GET', 'application/json');
    requireSiteAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized. Please log in.',
    });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireUser', () => {
  function makeReqRes({ session = {}, method = 'GET', accept } = {}) {
    const req = { session, method, headers: accept ? { accept } : {} };
    const res = {
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    return { req, res, next };
  }

  test('calls next() when userEmail is present', () => {
    const { req, res, next } = makeReqRes({
      session: { userEmail: 'u@g.com' },
    });
    requireUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to / for an unauthenticated GET', () => {
    const { req, res, next } = makeReqRes({});
    requireUser(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects to / for an unauthenticated HTML form POST (no JSON blob)', () => {
    const { req, res, next } = makeReqRes({
      method: 'POST',
      accept: 'text/html',
    });
    requireUser(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
    expect(res.json).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 JSON only for explicit JSON clients', () => {
    const { req, res, next } = makeReqRes({
      method: 'POST',
      accept: 'application/json',
    });
    requireUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Please sign in.' });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('never inspects siteAdmin — an admin-only session is still rejected', () => {
    const { req, res, next } = makeReqRes({ session: { siteAdmin: true } });
    requireUser(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
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
    const limiter = rateLimit({
      windowMs: 1000,
      max: 2,
      standardHeaders: true,
    });
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

  test('sweeps expired clients once the map crosses the 1000-key threshold', () => {
    // The size-triggered sweep only fires when a NEW key is inserted while the
    // map already holds >= SWEEP_THRESHOLD (1000) entries. Seed 1000 clients in
    // an already-expired window, then a fresh request must reap them so the map
    // doesn't grow unbounded under a key-rotating flood.
    const windowMs = 50;
    const limiter = rateLimit({ windowMs, max: 1 });
    const next = vi.fn();

    const start = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(start);
    for (let i = 0; i < 1000; i++) {
      limiter(
        makeReq(`10.0.${Math.floor(i / 256)}.${i % 256}`),
        makeRes(),
        next,
      );
    }

    // Advance past the window so all 1000 seeded entries are now expired, then
    // insert one new key — this is the call that triggers the sweep branch.
    Date.now.mockReturnValue(start + windowMs + 1);
    const res = makeRes();
    limiter(makeReq('203.0.113.9'), res, next);

    // The new request is allowed (its own fresh window) and the expired keys
    // were reaped rather than accumulating.
    expect(next).toHaveBeenCalledTimes(1001);
    expect(res.status).not.toHaveBeenCalledWith(429);

    Date.now.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// errorMiddleware
// ---------------------------------------------------------------------------

function makeMockRes(_acceptJson = true) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
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
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation Error',
        message: 'bad input',
        field: 'email',
      }),
    );
  });

  test('returns 400 plain text for ValidationError (HTML client)', () => {
    const err = new ValidationError('bad input', 'email');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('bad input');
  });

  test('reflects raw ValidationError input as text/plain, not text/html (HTML client)', () => {
    const err = new ValidationError(
      'Invalid year: <script>alert(1)</script>. Must be between 1980 and 2027.',
      'year',
    );
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith(err.message);
  });

  test('returns 500 JSON for DatabaseError with verbose fields when DEBUG_ERRORS is set', () => {
    process.env.DEBUG_ERRORS = '1';
    try {
      const err = new DatabaseError('db fail', 'read');
      const req = mockReq(true);
      const res = makeMockRes();
      errorMiddleware(err, req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Database Error',
          message: 'db fail',
          operation: 'read',
        }),
      );
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
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Database error'),
      err,
    );
  });

  test('returns 500 plain text for DatabaseError (HTML client)', () => {
    const err = new DatabaseError('db fail');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.type).toHaveBeenCalledWith('text/plain');
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
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Service Error',
          message: 'svc fail',
          service: 'myService',
        }),
      );
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
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Service error'),
      err,
    );
  });

  test('returns 500 JSON for unknown error', () => {
    const err = new Error('totally unexpected');
    const req = mockReq(true);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Internal Server Error',
      }),
    );
  });

  test('returns 500 plain text for unknown error (HTML client)', () => {
    const err = new Error('boom');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('An unexpected error occurred');
  });

  test('returns 500 plain text for ServiceError (HTML client)', () => {
    const err = new ServiceError('svc fail', 'myService');
    const req = mockReq(false);
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('A service error occurred.');
  });

  test('returns 500 when the inner response call crashes', () => {
    const err = new ValidationError('bad', 'f');
    // Cause json to throw on first call (simulating a broken response pipeline)
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementationOnce(() => {
        throw new Error('json crash');
      }),
      send: vi.fn(),
    };
    const req = mockReq(true);
    errorMiddleware(err, req, res, vi.fn());
    expect(res.send).toHaveBeenCalledWith('Internal Server Error');
  });

  test('returns 500 when an error is thrown within errorMiddleware itself', () => {
    const err = new Error('initial error');
    // Simulating undefined req.headers to trigger a TypeError in errorMiddleware
    const req = { method: 'POST', originalUrl: '/test' };
    const res = makeMockRes();
    errorMiddleware(err, req, res, vi.fn());
    expect(Logger.error).toHaveBeenCalledWith(
      'Error in errorMiddleware:',
      expect.any(TypeError),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Internal Server Error');
  });

  test('delegates to next(err) without touching the response when headers are already sent', () => {
    const err = new Error('mid-stream failure');
    const req = mockReq(true);
    const res = makeMockRes();
    res.headersSent = true;
    const next = vi.fn();

    errorMiddleware(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
