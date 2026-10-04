// Firestore test double. The spies live in this object, owned by the test file —
// the mocked `db` exposes only the shape the real module does, so no test-only
// handle is bolted onto the object under test.
const fire = vi.hoisted(() => {
  const state = { stored: null, setError: undefined, deleteError: undefined };
  const doc = {
    get: vi.fn(async () => ({
      exists: state.stored != null,
      data: () => state.stored,
    })),
    set: vi.fn(async (data) => {
      if (state.setError) throw state.setError;
      state.stored = data;
    }),
    delete: vi.fn(async () => {
      if (state.deleteError) throw state.deleteError;
      state.stored = null;
    }),
  };
  const docFn = vi.fn(() => doc);
  const collectionFn = vi.fn(() => ({ doc: docFn }));
  return { state, doc, docFn, collectionFn };
});

vi.mock('@google-cloud/firestore', () => ({
  Filter: {},
  FieldValue: {},
  Firestore: {
    Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) },
  },
}));

vi.mock('../src/config/firestore.js', () => ({
  db: { collection: fire.collectionFn },
}));

// `tournament` is read at hierarchicalRepository module load.
vi.mock('../src/config/app.js', () => ({
  APP_CONFIG: { tournament: { excludedGroups: [] } },
  thisYear: 2026,
  isRegistrationOpen: () => true,
}));

import { FirestoreStore } from '../src/middleware/firestoreSessionStore.js';
import { SessionRepository } from '../src/repositories/hierarchicalRepository.js';

// The store holds no Firestore handle of its own — it delegates every read and
// write to SessionRepository, which owns the `express-sessions` collection. So
// these tests inject a fake repository and assert the store's adapter contract
// (callback shape, expiry policy, JSON serialization); the collection name and
// the TTL `expireAt` mirror are asserted against the real repository below.
function mockRepository({ data = null, getError, setError, deleteErr } = {}) {
  return {
    getSession: vi.fn(() =>
      getError ? Promise.reject(getError) : Promise.resolve(data),
    ),
    setSession: vi.fn(() =>
      setError ? Promise.reject(setError) : Promise.resolve(),
    ),
    deleteSession: vi.fn(() =>
      deleteErr ? Promise.reject(deleteErr) : Promise.resolve(),
    ),
  };
}

// Promisifies the callback-based store API so tests can use async/await
// instead of the deprecated `done(err)` pattern.
const pget = (store, sid) =>
  new Promise((resolve) => store.get(sid, (err, val) => resolve([err, val])));
const pset = (store, sid, sess) =>
  new Promise((resolve) => store.set(sid, sess, (err) => resolve(err)));
const pdestroy = (store, sid) =>
  new Promise((resolve) => store.destroy(sid, (err) => resolve(err)));

beforeEach(() => {
  fire.state.stored = null;
  fire.state.setError = undefined;
  fire.state.deleteError = undefined;
  vi.clearAllMocks();
});

describe('FirestoreStore constructor', () => {
  test('defaults to the shared sessionRepository singleton', async () => {
    const { sessionRepository } = await import('../src/repositories/index.js');
    const store = new FirestoreStore();
    expect(store.repository).toBe(sessionRepository);
  });

  test('accepts an injected repository', () => {
    const repository = mockRepository();
    const store = new FirestoreStore({ repository });
    expect(store.repository).toBe(repository);
  });
});

describe('FirestoreStore.get', () => {
  test('returns the stored session when the doc exists and is not expired', async () => {
    const session = { cookie: {}, user: 'alex' };
    const repository = mockRepository({
      data: { session, expires: Date.now() + 60_000 },
    });
    const store = new FirestoreStore({ repository });

    const [err, result] = await pget(store, 'sid-1');
    expect(err).toBeNull();
    expect(result).toEqual(session);
    expect(repository.getSession).toHaveBeenCalledWith('sid-1');
  });

  test('returns null when the doc does not exist', async () => {
    const store = new FirestoreStore({ repository: mockRepository() });

    const [err, result] = await pget(store, 'missing');
    expect(err).toBeNull();
    expect(result).toBeNull();
  });

  test('returns null when the session is past its expires timestamp', async () => {
    const repository = mockRepository({
      data: { session: { user: 'old' }, expires: Date.now() - 1000 },
    });
    const store = new FirestoreStore({ repository });

    const [err, result] = await pget(store, 'expired-sid');
    expect(err).toBeNull();
    expect(result).toBeNull();
  });

  test('opportunistically deletes an expired session doc on read', async () => {
    const repository = mockRepository({
      data: { session: { user: 'old' }, expires: Date.now() - 1000 },
    });
    const store = new FirestoreStore({ repository });

    const [err, result] = await pget(store, 'expired-sid');
    expect(err).toBeNull();
    expect(result).toBeNull();
    expect(repository.deleteSession).toHaveBeenCalledWith('expired-sid');
  });

  test('a failing opportunistic delete does not surface as a get error', async () => {
    const repository = mockRepository({
      data: { session: { user: 'old' }, expires: Date.now() - 1000 },
      deleteErr: new Error('delete rejected'),
    });
    const store = new FirestoreStore({ repository });

    const [err, result] = await pget(store, 'expired-sid');
    expect(err).toBeNull();
    expect(result).toBeNull();
  });

  test('propagates read errors to the callback', async () => {
    const boom = new Error('firestore down');
    const store = new FirestoreStore({
      repository: mockRepository({ getError: boom }),
    });

    const [err] = await pget(store, 'sid');
    expect(err).toBe(boom);
  });
});

describe('FirestoreStore.set', () => {
  test('serializes the session via JSON round-trip and writes session + expires', async () => {
    const repository = mockRepository();
    const store = new FirestoreStore({ repository });
    const cookieExpires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const session = { cookie: { expires: cookieExpires }, user: 'alex' };

    const err = await pset(store, 'sid-2', session);
    expect(err).toBeNull();
    const [sid, payload] = repository.setSession.mock.calls[0];
    expect(sid).toBe('sid-2');
    expect(payload.session).toEqual(JSON.parse(JSON.stringify(session)));
    expect(payload.expires).toBe(cookieExpires.getTime());
  });

  test('defaults expires to ~24 hours from now when cookie.expires is absent', async () => {
    const repository = mockRepository();
    const store = new FirestoreStore({ repository });
    const before = Date.now();

    const err = await pset(store, 'sid-3', { cookie: {}, user: 'x' });
    expect(err).toBeNull();
    const payload = repository.setSession.mock.calls[0][1];
    // 86400000 ms = 24h; allow a small window for test execution time
    expect(payload.expires).toBeGreaterThanOrEqual(before + 86400000 - 100);
    expect(payload.expires).toBeLessThanOrEqual(Date.now() + 86400000);
  });

  test('strips non-serializable session fields via JSON round-trip', async () => {
    const repository = mockRepository();
    const store = new FirestoreStore({ repository });
    const sess = { cookie: {}, fn: () => 'noop', user: 'alex' };

    await pset(store, 'sid', sess);
    const payload = repository.setSession.mock.calls[0][1];
    expect(payload.session.fn).toBeUndefined();
    expect(payload.session.user).toBe('alex');
  });

  test('propagates write errors to the callback', async () => {
    const boom = new Error('write rejected');
    const store = new FirestoreStore({
      repository: mockRepository({ setError: boom }),
    });

    const err = await pset(store, 'sid', { cookie: {} });
    expect(err).toBe(boom);
  });
});

describe('FirestoreStore.destroy', () => {
  test('deletes the session doc and signals success with no error', async () => {
    const repository = mockRepository();
    const store = new FirestoreStore({ repository });

    const err = await pdestroy(store, 'sid-4');
    expect(err).toBeNull();
    expect(repository.deleteSession).toHaveBeenCalledWith('sid-4');
  });

  test('propagates delete errors to the callback', async () => {
    const boom = new Error('delete failed');
    const store = new FirestoreStore({
      repository: mockRepository({ deleteErr: boom }),
    });

    const err = await pdestroy(store, 'sid');
    expect(err).toBe(boom);
  });
});

describe('SessionRepository session-document access', () => {
  const repo = new SessionRepository();

  test('reads and writes the express-sessions collection', async () => {
    await repo.getSession('sid-a');
    expect(fire.collectionFn).toHaveBeenCalledWith('express-sessions');
    expect(fire.docFn).toHaveBeenCalledWith('sid-a');
  });

  test('getSession returns null when the document is absent', async () => {
    fire.state.stored = null;
    expect(await repo.getSession('nope')).toBeNull();
  });

  test('writes an expireAt Timestamp matching expires so a Firestore TTL policy can reap the doc', async () => {
    const expires = Date.now() + 8 * 3600 * 1000;
    await repo.setSession('sid-ttl', { session: { user: 'a' }, expires });

    const payload = fire.doc.set.mock.calls[0][0];
    expect(payload.expires).toBe(expires);
    expect(payload.expireAt.toMillis()).toBe(expires);
  });

  test('deleteSession removes the document', async () => {
    fire.state.stored = { session: {}, expires: Date.now() };
    await repo.deleteSession('sid-del');
    expect(fire.doc.delete).toHaveBeenCalled();
    expect(fire.state.stored).toBeNull();
  });
});
