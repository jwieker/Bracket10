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
  updateTotalPointsJustYear,
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
  getGoogleClientId: vi.fn(() => 'test-google-client-id.apps.googleusercontent.com'),
  isAdminEmail: vi.fn(),
}));

import { updatePossiblePoints } from '../src/services/index.js';
import { clearAllCache } from '../src/utils/cacheUtils.js';
import { getAuthUrl, isAdminEmail } from '../src/config/auth.js';

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
    expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?test');
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
    expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?test');
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
    const req = { query: { code: 'auth-code' }, session: { oauthState: 'expected' } };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed: invalid state');
    expect(req.session.oauthState).toBeUndefined();
    expect(mockOAuthClient.getToken).not.toHaveBeenCalled();
  });

  test('returns 403 when state does not match', async () => {
    const req = { query: { code: 'auth-code', state: 'wrong' }, session: { oauthState: 'expected' } };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Authentication failed: invalid state');
    expect(req.session.oauthState).toBeUndefined();
    expect(mockOAuthClient.getToken).not.toHaveBeenCalled();
  });

  test('sets session and redirects when email is authorized', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com' }),
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
    expect(req.session.save).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/admin/tournament');
  });

  test('preserves rememberMe across session regenerate', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com' }),
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
      getPayload: () => ({ email: 'admin@gmail.com' }),
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
      getPayload: () => ({ email: 'nobody@gmail.com' }),
    });
    isAdminEmail.mockReturnValue(false);

    const req = { query: { code: 'auth-code', state: 'expected' }, session: { oauthState: 'expected' } };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Not an authorized admin');
    expect(req.session.siteAdmin).toBeUndefined();
  });

  test('returns 401 when token exchange fails', async () => {
    mockOAuthClient.getToken.mockRejectedValue(new Error('Invalid code'));

    const req = { query: { code: 'bad-code', state: 'expected' }, session: { oauthState: 'expected' } };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Authentication failed: token exchange');
  });

  // C3 regression: verifyIdToken must be called with audience pinned to our
  // OAuth client ID so that a signature-valid token issued for a different
  // client cannot pass admin auth.
  test('passes audience (our Google client ID) to verifyIdToken', async () => {
    mockOAuthClient.getToken.mockResolvedValue({
      tokens: { id_token: 'test-id-token' },
    });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com' }),
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
    mockOAuthClient.verifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    const req = {
      query: { code: 'auth-code', state: 'expected' },
      session: { oauthState: 'expected' },
    };
    const res = mockRes();
    await googleAuthCallback(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Authentication failed: token verification');
    expect(isAdminEmail).not.toHaveBeenCalled();
  });

  // ── Participant ("user") role branch ──────────────────────────────────────

  test('user role: accepts any verified email, sets userEmail (lowercased), never siteAdmin', async () => {
    mockOAuthClient.getToken.mockResolvedValue({ tokens: { id_token: 'test-id-token' } });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'Player@Gmail.com' }),
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
    const req = { query: {}, session: { oauthState: 'expected', oauthRole: 'user' } };
    const res = mockRes();
    await googleAuthCallback(req, res);
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('user login preserves existing admin session so both coexist', async () => {
    mockOAuthClient.getToken.mockResolvedValue({ tokens: { id_token: 'test-id-token' } });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'player@gmail.com' }),
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
    // 30-day admin maxAge trumps 14-day user maxAge
    expect(req.session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('admin login preserves existing user session so both coexist', async () => {
    mockOAuthClient.getToken.mockResolvedValue({ tokens: { id_token: 'test-id-token' } });
    mockOAuthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'admin@gmail.com' }),
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
    // 14-day user maxAge trumps default 8-hour admin maxAge
    expect(req.session.cookie.maxAge).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// userLogout
// ---------------------------------------------------------------------------

describe('userLogout', () => {
  test('destroys the session and redirects to / when no admin login present', () => {
    const req = { session: { destroy: vi.fn((cb) => cb()), save: vi.fn((cb) => cb()) } };
    const res = mockRes();
    userLogout(req, res);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });

  test('preserves admin login and saves session instead of destroying when admin is present', () => {
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
    userLogout(req, res);
    expect(req.session.userEmail).toBeUndefined();
    expect(req.session.siteAdmin).toBe(true);
    expect(req.session.save).toHaveBeenCalled();
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/');
  });
});

// ---------------------------------------------------------------------------
// updateTotalPoints
// ---------------------------------------------------------------------------

describe('updateTotalPoints', () => {
  test('clears cache, calls updatePossiblePoints, and returns 200', async () => {
    updatePossiblePoints.mockResolvedValue();
    const req = { body: { year: '2024' }, method: 'POST', url: '/updateTotalPoints' };
    const res = mockRes();
    await updateTotalPoints(req, res);
    expect(clearAllCache).toHaveBeenCalled();
    expect(updatePossiblePoints).toHaveBeenCalledWith(2024);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ---------------------------------------------------------------------------
// updateTotalPointsJustYear
// ---------------------------------------------------------------------------

describe('updateTotalPointsJustYear', () => {
  test('calls updatePossiblePoints with given year', async () => {
    updatePossiblePoints.mockResolvedValue();
    await updateTotalPointsJustYear(2022);
    expect(updatePossiblePoints).toHaveBeenCalledWith(2022);
  });

  test('swallows errors without throwing', async () => {
    updatePossiblePoints.mockRejectedValue(new Error('db error'));
    await expect(updateTotalPointsJustYear(2022)).resolves.toBeUndefined();
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
  test('delegates to the repository and returns the deleted count', async () => {
    clearAuthenticatedSessions.mockResolvedValue(2);

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(clearAuthenticatedSessions).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.stringContaining('Successfully cleared 2 Google sign-in session(s).'));
  });

  test('returns 200 with zero message when no sessions are cleared', async () => {
    clearAuthenticatedSessions.mockResolvedValue(0);

    const req = { body: {}, method: 'POST', url: '/clearGoogleSessions' };
    const res = mockRes();

    await clearGoogleSessionsHandler(req, res);

    expect(clearAuthenticatedSessions).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.stringContaining('Successfully cleared 0 Google sign-in session(s).'));
  });
});
