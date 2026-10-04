import viewRoutes, { createEntryLimiter } from '../src/routes/viewRoutes.js';
import { isRegistrationOpen } from '../src/config/app.js';

// Only isRegistrationOpen is stubbed — the rest of config/app.js stays real so the
// router under test is assembled the way production assembles it. The stub is
// unavoidable: isRegistrationOpen() hard-returns true under NODE_ENV=test
// (src/config/app.js:79), which is exactly why the closed-registration branch has
// never been exercised by the existing suite.
vi.mock('../src/config/app.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isRegistrationOpen: vi.fn(() => true),
}));

// runTransaction is the assertion target, not a convenience stub: the guard exists
// to keep a closed-registration POST from opening a Firestore transaction, and this
// spy is the only thing that can observe that. It resolves a canned window instead
// of running the callback, so no Firestore Timestamp mock is needed.
const { runTransaction } = vi.hoisted(() => ({ runTransaction: vi.fn() }));

vi.mock('../src/config/firestore.js', () => ({
  db: {
    collection: () => ({ doc: () => ({}) }),
    runTransaction,
  },
}));

function handlersFor(path) {
  const layer = viewRoutes.stack.find(
    (l) => l.route?.path === path && l.route?.methods?.post,
  );
  if (!layer) throw new Error(`POST ${path} is not registered`);
  return layer.route.stack.map((l) => l.handle);
}

function makeReq() {
  return { ip: '203.0.113.7', body: {} };
}

function makeRes() {
  return {
    statusCode: undefined,
    renderedView: undefined,
    status: vi.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    render: vi.fn(function (view) {
      this.renderedView = view;
      return this;
    }),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
}

/**
 * Walk a route's middleware chain the way Express would, but stop at the final
 * handler (the controller) instead of invoking it — "the request reached the
 * controller" is the outcome under test, and calling it for real would drag the
 * whole service/repository graph into a middleware test.
 */
async function runChain(handlers, req, res) {
  const terminal = handlers.length - 1;
  for (let index = 0; index < terminal; index += 1) {
    let advanced = false;
    await handlers[index](req, res, () => {
      advanced = true;
    });
    if (!advanced) return { reachedController: false, stoppedAt: index };
  }
  return { reachedController: true, stoppedAt: terminal };
}

const ENTRY_CREATION_ROUTES = ['/newEntry', '/entryVerify'];

describe('requireRegistrationOpen route guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRegistrationOpen.mockReturnValue(true);
    runTransaction.mockResolvedValue({
      count: 1,
      resetTime: Date.now() + 60_000,
    });
    delete process.env.RATE_LIMIT_FIRESTORE_DISABLED;
  });

  describe.each(ENTRY_CREATION_ROUTES)('POST %s', (path) => {
    test('registration closed: 403 + myEntryClosed, and Firestore is never touched', async () => {
      isRegistrationOpen.mockReturnValue(false);
      const res = makeRes();

      const result = await runChain(handlersFor(path), makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.renderedView).toBe('myEntryClosed');
      expect(result.reachedController).toBe(false);
      // The point of this whole file. Registration is closed ~361 days a year;
      // without this guard every scanner POST to these unauthenticated endpoints
      // would open a Firestore transaction — a billable read plus a write — before
      // the controller's own window check ran, against the $0 cost contract (#334).
      expect(runTransaction).not.toHaveBeenCalled();
    });

    test('registration open: the request passes the guard and reaches the controller', async () => {
      const res = makeRes();

      const result = await runChain(handlersFor(path), makeReq(), res);

      expect(res.status).not.toHaveBeenCalled();
      expect(result.reachedController).toBe(true);
      expect(runTransaction).toHaveBeenCalledTimes(1);
    });

    // A reorder putting createEntryLimiter first leaves every assertion above
    // passing — the visitor still sees myEntryClosed and no entry is created. Only
    // the Firestore bill changes, so the ordering has to be asserted on its own.
    test('the guard is registered before createEntryLimiter', () => {
      const handlers = handlersFor(path);
      expect(handlers.indexOf(createEntryLimiter)).toBe(1);

      // The guard is module-private in viewRoutes.js and can't be imported by
      // reference, so identify handler 0 by its behavior instead.
      isRegistrationOpen.mockReturnValue(false);
      const res = makeRes();
      const next = vi.fn();
      handlers[0](makeReq(), res, next);

      expect(res.renderedView).toBe('myEntryClosed');
      expect(next).not.toHaveBeenCalled();
    });
  });
});
