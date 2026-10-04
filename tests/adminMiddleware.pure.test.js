import {
  requireSiteAdmin,
  requireUser,
} from '../src/middleware/adminMiddleware.js';

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

  test('calls next() when siteAdmin is truthy', () => {
    const { req, res, next } = makeReqRes({ siteAdmin: 'yes' });
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

  test('returns 401 JSON when headers is missing and method is POST', () => {
    const { req, res, next } = makeReqRes({}, 'POST');
    delete req.headers;
    requireSiteAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized. Please log in.',
    });
  });

  test('redirects when headers is missing and method is GET', () => {
    const { req, res, next } = makeReqRes({}, 'GET');
    delete req.headers;
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
  });

  // A browser sends `Accept: text/html`, so this pins the redirect branch against
  // an accept header that is present but not JSON — the cases above only cover a
  // missing header or an explicit application/json one.
  test('redirects to /updates for an unauthenticated GET with text/html accept header', () => {
    const { req, res, next } = makeReqRes({}, 'GET', 'text/html');
    requireSiteAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // Exercises the `req.session?.` guard on the JSON branch specifically: the
  // undefined-session case above takes the GET/redirect path instead.
  test('returns 401 JSON for an unauthenticated POST with undefined session', () => {
    const { req, res, next } = makeReqRes(null, 'POST');
    req.session = undefined;
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

  test('redirects to / when userEmail is empty string', () => {
    const { req, res, next } = makeReqRes({
      session: { userEmail: '' },
    });
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

  test('redirects to / when headers is missing', () => {
    const { req, res, next } = makeReqRes({ method: 'GET' });
    delete req.headers;
    requireUser(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  // Every other case here passes a session object; this is the only one that
  // exercises the `req.session?.userEmail` guard with session itself undefined.
  test('returns 401 JSON for an unauthenticated request with undefined session and application/json accept header', () => {
    const { req, res, next } = makeReqRes({ accept: 'application/json' });
    req.session = undefined;
    requireUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Please sign in.' });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
