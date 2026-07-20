const { clearAuthenticatedSessions } = vi.hoisted(() => ({
  clearAuthenticatedSessions: vi.fn(),
}));

vi.mock('../src/repositories/index.js', () => ({
  sessionRepository: {
    clearAuthenticatedSessions,
  },
}));

import {
  adminLogin,
  startGoogleAuth,
  startUserGoogleAuth,
  googleAuthCallback,
  userLogout,
  updateTotalPoints,
  clearCacheHandler,
  clearGoogleSessionsHandler,
} from '../src/controllers/pointsController.js';

vi.mock('../src/services/index.js', () => ({
  updatePossiblePoints: vi.fn(),
  possibleRanking: vi.fn(),
}));

vi.mock('../src/utils/cacheUtils.js', () => ({
  clearAllCache: vi.fn(),
}));

const mockOAuthClient = {
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
};

vi.mock('../src/config/auth.js', () => ({
  getAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?test'),
  getOAuthClient: vi.fn(() => mockOAuthClient),
  getGoogleClientId: vi.fn(
    () => 'test-google-client-id.apps.googleusercontent.com',
  ),
  isAdminEmail: vi.fn(),
}));

import { updatePossiblePoints } from '../src/services/index.js';
import { clearAllCache } from '../src/utils/cacheUtils.js';
import { getAuthUrl, isAdminEmail } from '../src/config/auth.js';
import Logger from '../src/utils/logger.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    render: vi.fn(),
    redirect: vi.fn(),
    is: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// adminLogin
// ---------------------------------------------------------------------------

describe('adminLogin', () => {
  test('renders adminLogin template', () => {
    const res = mockRes();
    adminLogin({}, res);
    expect(res.render).toHaveBeenCalledWith('adminLogin');
  });
});

// ---------------------------------------------------------------------------
// startGoogleAuth
// ---------------------------------------------------------------------------

describe('startGoogleAuth', () => {
  test('stores oauth state, saves session, and redirects with state', async () => {
    const session = {
      save: vi.fn((cb) => cb(null)),
    };
    const req = { query: {}, session };
    const res = mockRes();

    await startGoogleAuth(req, res);

    expect(session.oauthState).toMatch(/^[a-f0-9]{32}$/);
    expect(session.save).toHaveBeenCalled();
    expect(getAuthUrl).toHaveBeenCalledWith(session.oauthState);
    expect(res.redirect).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?test',
    );
  });

  test('preserves remember flag before OAuth redirect', async () => {
    const session = {
      save: vi.fn((cb) => cb(null)),
    };
    const req = { query: { remember: '1' }, session };
    const res = mockRes();

    await startGoogleAuth(req, res);

    expect(session.rememberMe).toBe(true);
    expect(session.oauthState).toMatch(/^[a-f0-9]{32}$/);
  });

  test('clears stale rememberMe when remember flag is absent', async () => {
    const session = {
      rememberMe: true,
      save: vi.fn((cb) => cb(null)),
    };
    const req = { query: {}, session };
    const res = mockRes();

    await startGoogleAuth(req, res);

    expect(session.rememberMe).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startUserGoogleAuth (participant "My Brackets" sign-in)
// ---------------------------------------------------------------------------

describe('startUserGoogleAuth', () => {
  test('tags the session role as "user", stores state, and redirects', async () => {
    const session = { save: vi.fn((cb) => cb(null)) };
    const req = { query: {}, session };
    const res = mockRes();

    await startUserGoogleAuth(req, res);

    expect(session.oauthRole).toBe('user');
    expect(session.oauthState).toMatch(/^[a-f0-9]{32}$/);
    expect(getAuthUrl).toHaveBeenCalledWith(session.oauthState);
    expect(res.redirect).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?test',
    );
  });
});

// ---------------------------------------------------------------------------
// googleAuthCallback
// ---------------------------------------------------------------------------

describe('googleAuthCallback', () => {
  test('redirects to /updates when code is missing', async () => {
    const req = { query: {}, session: { oauthState: 'expected' } };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/updates');
    expect(req.session.oauthState).toBeUndefined();
  });

  test('returns 403 when state is missing', async () => {
    const req = {
      query: { code: 'auth-code' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.oauthState).toBeUndefined();
    expect(mockOAuthClient.getToken).not.toHaveBeenCalled();
  });

  test('returns 403 when state does not match', async () => {
    const req = {
      query: { code: 'auth-code', state: 'wrong' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.oauthState).toBeUndefined();
    expect(mockOAuthClient.getToken).not.toHaveBeenCalled();
  });

  test('sets session and redirects when email is authorized', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: {},
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(mockOAuthClient.getToken).toHaveBeenCalledWith('auth-code');
    expect(req.session.oauthState).toBeUndefined();
    expect(req.session.regenerate).toHaveBeenCalled();
    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.adminEmail).toBe('admin@gmail.com');
    // CSRF token is minted eagerly during the login save so two tabs opened
    // before any page load can't race two different tokens (#164).
    expect(typeof req.session.csrfToken).toBe('string');
    expect(req.session.csrfToken.length).toBeGreaterThan(0);
    expect(req.session.save).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/admin/tournament');
  });

  test('preserves rememberMe across session regenerate', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        rememberMe: true,
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: {},
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(req.session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('returns 500 when session.save fails', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(new Error('save failed'))),
        cookie: {},
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Session save failed');
  });

  test('returns 403 when email is not an authorized admin', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'nobody@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(false);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.siteAdmin).toBeUndefined();
  });

  test('returns 401 when token exchange fails', async () => {
    mockOAuthClient.getToken.mockRejectedValue(new Error('Invalid code'));

    const req = {
      query: { code: 'bad-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
  });

  // C3 regression: verifyIdToken must be called with audience pinned to our
  // OAuth client ID so that a signature-valid token issued for a different
  // client cannot pass admin auth.
  test('passes audience (our Google client ID) to verifyIdToken', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: {},
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(mockOAuthClient.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'test-id-token',
      audience: 'test-google-client-id.apps.googleusercontent.com',
    });
  });

  test('returns 401 when verifyIdToken rejects (wrong audience, expired, etc.)', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'token-for-wrong-client' },
    });
    // google-auth-library throws "Wrong recipient" when the token's aud claim
    // does not match the configured audience. Simulate that behavior.
    mockOAuthClient.verifyIdToken.mockRejectedValue(
      new Error('Wrong recipient'),
    );

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(isAdminEmail).not.toHaveBeenCalled();
  });

  // #333: a Google account can carry an alternate address it never proved
  // control of, which arrives with email_verified:false. Since entry
  // ownership and the admin allowlist key on this email, an unverified claim
  // must never establish a session.
  test('admin role: returns 403 and sets no session when email_verified is false', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: false }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.siteAdmin).toBeUndefined();
    expect(req.session.adminEmail).toBeUndefined();
    // Rejected before the allowlist check — the claim is untrusted input.
    expect(isAdminEmail).not.toHaveBeenCalled();
  });

  test('user role: returns 403 and sets no userEmail when email_verified is false', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'victim@example.com',
        email_verified: false,
      }),
    });

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected', oauthRole: 'user' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.userEmail).toBeUndefined();
    expect(req.session.siteAdmin).toBeUndefined();
  });

  test('returns 403 when email_verified is absent from the payload (fails closed)', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com' }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed');
    expect(req.session.siteAdmin).toBeUndefined();
  });

  // Guards the strict `=== true` comparison: a future loosening to a truthy
  // check (e.g. `!payload.email_verified`) would start accepting these.
  test.each([1, 'true'])(
    'returns 403 when email_verified is truthy but not boolean true (%j)',
    async (emailVerified) => {
      mockOAuthClient.getToken.mockResolvedValue({
        tokens: { id_token: 'test-id-token' },
      });
      mockOAuthClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'admin@gmail.com',
          email_verified: emailVerified,
        }),
      });
      isAdminEmail.mockReturnValue(true);

      const req = {
        query: { code: 'auth-code', state: 'expected' },
        session: { oauthState: 'expected' },
      };
      const res = mockRes();
      await googleAuthCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Authentication failed');
      expect(req.session.siteAdmin).toBeUndefined();
    },
  );

  // #323: every failure branch (invalid state, token exchange, token
  // verification, unauthorized admin) must send the exact same body — a
  // distinct message per stage was an oracle for admin-allowlist enumeration
  // and auth-stage probing.
  test('every failure branch sends the identical generic body', async () => {
    const bodies = new Set();

    const stateReq = {
      query: { code: 'auth-code', state: 'wrong' },
      session: { oauthState: 'expected' },
    };
    const stateRes = mockRes();
    await googleAuthCallback(stateReq, stateRes);
    bodies.add(stateRes.send.mock.calls[0][0]);

    mockOAuthClient.getToken.mockRejectedValueOnce(new Error('Invalid code'));
    const exchangeReq = {
      query: { code: 'bad-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const exchangeRes = mockRes();
    await googleAuthCallback(exchangeReq, exchangeRes);
    bodies.add(exchangeRes.send.mock.calls[0][0]);

    mockOAuthClient.getToken.mockResolvedValueOnce({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockRejectedValueOnce(
      new Error('Wrong recipient'),
    );
    const verifyReq = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const verifyRes = mockRes();
    await googleAuthCallback(verifyReq, verifyRes);
    bodies.add(verifyRes.send.mock.calls[0][0]);

    mockOAuthClient.getToken.mockResolvedValueOnce({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ email: 'nobody@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValueOnce(false);
    const adminReq = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const adminRes = mockRes();
    await googleAuthCallback(adminReq, adminRes);
    bodies.add(adminRes.send.mock.calls[0][0]);

    mockOAuthClient.getToken.mockResolvedValueOnce({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({}),
    });
    const noEmailReq = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const noEmailRes = mockRes();
    await googleAuthCallback(noEmailReq, noEmailRes);
    bodies.add(noEmailRes.send.mock.calls[0][0]);

    mockOAuthClient.getToken.mockResolvedValueOnce({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: false }),
    });
    const unverifiedReq = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const unverifiedRes = mockRes();
    await googleAuthCallback(unverifiedReq, unverifiedRes);
    bodies.add(unverifiedRes.send.mock.calls[0][0]);

    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toBe('Authentication failed');
  });

  // ── Participant ("user") role branch ──────────────────────────────────────

  test('user role: accepts any verified email, sets userEmail (lowercased), never siteAdmin', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'Player@Gmail.com', email_verified: true }),
    });

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        oauthRole: 'user',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: {},
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    // No admin allowlist check on the participant path.
    expect(isAdminEmail).not.toHaveBeenCalled();
    expect(req.session.regenerate).toHaveBeenCalled();
    expect(req.session.userEmail).toBe('player@gmail.com');
    expect(req.session.cookie.maxAge).toBe(14 * 24 * 60 * 60 * 1000); // 2 weeks (14 days)
    expect(req.session.siteAdmin).toBeUndefined();
    expect(req.session.adminEmail).toBeUndefined();
    expect(req.session.oauthRole).toBeUndefined();
    expect(res.redirect).toHaveBeenCalledWith('/my-brackets');
  });

  test('user role: redirects to / (not /updates) when code is missing', async () => {
    const req = {
      query: {},
      session: { oauthState: 'expected', oauthRole: 'user' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('user login preserves existing admin session so both coexist', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'player@gmail.com', email_verified: true }),
    });

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        oauthRole: 'user',
        siteAdmin: true,
        adminEmail: 'admin@gmail.com',
        csrfToken: 'existing-csrf',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(req.session.userEmail).toBe('player@gmail.com');
    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.adminEmail).toBe('admin@gmail.com');
    expect(req.session.csrfToken).toBe('existing-csrf');
    // Participant coexistence keeps the admin's own (remember-me) 30-day cap,
    // rather than Math.max-ing it any higher (#426).
    expect(req.session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });

  // #426: participant coexistence must never LENGTHEN an admin session — a
  // non-remember-me 8h admin cap must survive a later participant login
  // rather than being extended to the participant's 14-day lifetime.
  test('user login onto a non-remember-me admin session keeps the 8-hour admin cap, not the 14-day user lifetime', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'player@gmail.com', email_verified: true }),
    });

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        oauthRole: 'user',
        siteAdmin: true,
        adminEmail: 'admin@gmail.com',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: { maxAge: 8 * 60 * 60 * 1000 },
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(req.session.userEmail).toBe('player@gmail.com');
    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.cookie.maxAge).toBe(8 * 60 * 60 * 1000);
  });

  test('admin login preserves existing user session so both coexist', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        userEmail: 'player@gmail.com',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 },
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.adminEmail).toBe('admin@gmail.com');
    expect(req.session.userEmail).toBe('player@gmail.com');
    // #426: a fresh (non-remember-me) admin login always sets the 8-hour
    // admin policy — a lingering 14-day participant maxAge from session
    // coexistence must not extend it.
    expect(req.session.cookie.maxAge).toBe(8 * 60 * 60 * 1000);
  });

  // #426: same as above, but with remember-me set — the 30-day admin policy
  // must win over the lingering 14-day participant maxAge too.
  test('admin login with remember-me applies the 30-day admin policy even over a longer-lived stale value', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com', email_verified: true }),
    });
    isAdminEmail.mockReturnValue(true);

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: {
        oauthState: 'expected',
        rememberMe: true,
        userEmail: 'player@gmail.com',
        regenerate: vi.fn((cb) => cb(null)),
        save: vi.fn((cb) => cb(null)),
        cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 },
      },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// userLogout
// ---------------------------------------------------------------------------

describe('userLogout', () => {
  test('destroys the session and redirects to / when no admin login present', async () => {
    const req = {
      session: { destroy: vi.fn((cb) => cb()), save: vi.fn((cb) => cb()) },
    };
    const res = mockRes();
    await userLogout(req, res);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('preserves admin login and saves session instead of destroying when admin is present', async () => {
    const req = {
      session: {
        userEmail: 'player@gmail.com',
        siteAdmin: true,
        adminEmail: 'admin@gmail.com',
        destroy: vi.fn((cb) => cb()),
        save: vi.fn((cb) => cb()),
      },
    };
    const res = mockRes();
    await userLogout(req, res);
    expect(req.session.userEmail).toBeUndefined();
    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.save).toHaveBeenCalled();
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('logs the error and responds 500 instead of redirecting when session.destroy fails (#368)', async () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const destroyError = new Error('Firestore write failed');
    const req = {
      session: {
        destroy: vi.fn((cb) => cb(destroyError)),
        save: vi.fn((cb) => cb()),
      },
    };
    const res = mockRes();
    await userLogout(req, res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Logout failed');
    // pr-debate review on #420: the test name claims Logger.error was called
    // but nothing asserted it — a dropped Logger.error call would still pass.
    expect(Logger.error).toHaveBeenCalledWith(
      '[userLogout] session save/destroy failed:',
      destroyError,
    );
  });

  test('logs the error and responds 500 instead of redirecting when session.save fails (#368)', async () => {
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const saveError = new Error('Firestore write failed');
    const req = {
      session: {
        siteAdmin: true,
        destroy: vi.fn((cb) => cb()),
        save: vi.fn((cb) => cb(saveError)),
      },
    };
    const res = mockRes();
    await userLogout(req, res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Logout failed');
    expect(Logger.error).toHaveBeenCalledWith(
      '[userLogout] session save/destroy failed:',
      saveError,
    );
  });
});

// ---------------------------------------------------------------------------
// updateTotalPoints
// ---------------------------------------------------------------------------

describe('updateTotalPoints', () => {
  test('clears cache, calls updatePossiblePoints, and returns 200', async () => {
    updatePossiblePoints.mockResolvedValue();
    const req = {
      body: { year: '2024' },
      method: 'POST',
      url: '/updateTotalPoints',
    };
    const res = mockRes();
    await updateTotalPoints(req, res);
    expect(clearAllCache).toHaveBeenCalled();
    expect(updatePossiblePoints).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// clearCacheHandler
// ---------------------------------------------------------------------------

describe('clearCacheHandler', () => {
  test('clears cache and returns 200', async () => {
    const req = { body: {}, method: 'POST', url: '/clearCache' };
    const res = mockRes();
    await clearCacheHandler(req, res);
    expect(clearAllCache).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// clearGoogleSessionsHandler
// ---------------------------------------------------------------------------

describe('clearGoogleSessionsHandler', () => {
  test('delegates to the repository with the default (participant-only) scope and returns the deleted count', async () => {
    clearAuthenticatedSessions.mockResolvedValue({
      deleted: 2,
      strippedAdminDocs: 0,
    });

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(clearAuthenticatedSessions).toHaveBeenCalledWith({
      includeAdmins: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.stringContaining(
        'Successfully cleared 2 Google sign-in session(s).',
      ),
    );
  });

  test('returns 200 with zero message when no sessions are cleared', async () => {
    clearAuthenticatedSessions.mockResolvedValue({
      deleted: 0,
      strippedAdminDocs: 0,
    });

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(clearAuthenticatedSessions).toHaveBeenCalledWith({
      includeAdmins: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.stringContaining(
        'Successfully cleared 0 Google sign-in session(s).',
      ),
    );
  });

  test('notes how many admin sessions were kept signed in when a merged doc was stripped', async () => {
    clearAuthenticatedSessions.mockResolvedValue({
      deleted: 1,
      strippedAdminDocs: 1,
    });

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.stringContaining('1 admin session(s) kept signed in'),
    );
  });

  test('renders the zero-deleted, admins-kept message when only merged docs existed', async () => {
    clearAuthenticatedSessions.mockResolvedValue({
      deleted: 0,
      strippedAdminDocs: 2,
    });

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      'Successfully cleared 0 Google sign-in session(s). (2 admin session(s) kept signed in; only the Google sign-in half was cleared)',
    );
  });

  test('passes includeAdmins: true through to the repository for full incident response', async () => {
    clearAuthenticatedSessions.mockResolvedValue({
      deleted: 3,
      strippedAdminDocs: 0,
    });

    const req = {
      body: { includeAdmins: true },
      method: 'POST',
      url: '/clearGoogleSessions',
    };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(clearAuthenticatedSessions).toHaveBeenCalledWith({
      includeAdmins: true,
    });
  });
});
