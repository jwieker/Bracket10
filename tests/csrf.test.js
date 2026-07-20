import { attachCsrfToken, verifyCsrf } from '../src/middleware/csrf.js';

function makeRes() {
  const res = {
    locals: {},
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('token minting (via attachCsrfToken)', () => {
  test('mints a token once and reuses it for the session', () => {
    const req = { session: { siteAdmin: true } };
    const res1 = makeRes();
    const next = vi.fn();
    attachCsrfToken(req, res1, next);
    const first = res1.locals.csrfToken;
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/); // base64url — embeds safely in HTML/JS
    expect(first.length).toBeGreaterThanOrEqual(43); // 32 bytes

    const res2 = makeRes();
    attachCsrfToken(req, res2, next);
    expect(res2.locals.csrfToken).toBe(first);
  });

  test('tokens are unique per session', () => {
    const req1 = { session: { siteAdmin: true } };
    const res1 = makeRes();
    attachCsrfToken(req1, res1, vi.fn());

    const req2 = { session: { siteAdmin: true } };
    const res2 = makeRes();
    attachCsrfToken(req2, res2, vi.fn());

    expect(res1.locals.csrfToken).not.toBe(res2.locals.csrfToken);
  });
});

describe('attachCsrfToken', () => {
  test('exposes res.locals.csrfToken for admin sessions', () => {
    const req = { session: { siteAdmin: true } };
    const res = makeRes();
    const next = vi.fn();
    attachCsrfToken(req, res, next);
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('never touches absent sessions (no session write for anonymous traffic — $0 cost contract)', () => {
    for (const session of [undefined, {}]) {
      const req = { session };
      const res = makeRes();
      const next = vi.fn();
      attachCsrfToken(req, res, next);
      expect(res.locals.csrfToken).toBeUndefined();
      if (session) expect(session.csrfToken).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});

describe('verifyCsrf', () => {
  function adminReq(overrides = {}) {
    const session = { siteAdmin: true };
    const req = { session, headers: {}, body: {}, ...overrides };
    const res = makeRes();
    attachCsrfToken(req, res, vi.fn());
    const token = res.locals.csrfToken;
    return { req, token };
  }

  test('accepts a valid token from the x-csrf-token header (AJAX path)', () => {
    const { req, token } = adminReq();
    req.headers['x-csrf-token'] = token;
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('accepts a valid token from the _csrf body field (HTML form path)', () => {
    const { req, token } = adminReq();
    req.body._csrf = token;
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects a request with no token even when the session is siteAdmin (audit finding 4 regression)', () => {
    const { req } = adminReq();
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/CSRF/);
  });

  test('rejects a wrong token', () => {
    const { req, token } = adminReq();
    req.headers['x-csrf-token'] =
      token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('rejects a token of different length (timingSafeEqual guard)', () => {
    const { req, token } = adminReq();
    req.headers['x-csrf-token'] = token + 'x';
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('rejects when the session has no token yet (e.g. forged cross-site request before any admin page render)', () => {
    const req = {
      session: { siteAdmin: true },
      headers: { 'x-csrf-token': 'anything' },
      body: {},
    };
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('rejects non-string token shapes (arrays/objects from a crafted body)', () => {
    const { req } = adminReq();
    req.body._csrf = ['a', 'b'];
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
describe('attachCsrfToken user sessions', () => {
  test('exposes res.locals.csrfToken for user sessions', () => {
    const req = { session: { userEmail: 'p@example.com' } };
    const res = makeRes();
    const next = vi.fn();
    attachCsrfToken(req, res, next);
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('attachCsrfToken verifiedEntries sessions (#301)', () => {
  test('exposes res.locals.csrfToken once /my-entry/verify has granted access', () => {
    const req = { session: { verifiedEntries: { 'entry1:2026': true } } };
    const res = makeRes();
    const next = vi.fn();
    attachCsrfToken(req, res, next);
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('/my-entry/update POST without a matching token is rejected (cross-site forgery)', () => {
    const session = { verifiedEntries: { 'entry1:2026': true } };
    const mintRes = makeRes();
    attachCsrfToken({ session }, mintRes, vi.fn());

    const req = {
      session,
      headers: {},
      body: { entryId: 'entry1', year: '2026' },
    };
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('/my-entry/update POST with the rendered token succeeds', () => {
    const session = { verifiedEntries: { 'entry1:2026': true } };
    const mintRes = makeRes();
    attachCsrfToken({ session }, mintRes, vi.fn());
    const token = mintRes.locals.csrfToken;

    const req = {
      session,
      headers: {},
      body: { entryId: 'entry1', year: '2026', _csrf: token },
    };
    const res = makeRes();
    const next = vi.fn();
    verifyCsrf(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });
});
