import {
  EntryRepository,
  ViewRepository,
  GameRepository,
  TourneyRepository,
  TeamRepository,
  ConferenceRepository,
  SessionRepository,
  _isExcludedOnlyGroupForTests,
} from '../src/repositories/hierarchicalRepository.js';
import { APP_CONFIG } from '../src/config/app.js';
import { ValidationError } from '../src/utils/errors.js';
import { FieldValue } from '@google-cloud/firestore';
import Logger from '../src/utils/logger.js';

// ── Mock harness ──────────────────────────────────────────────────────────
// One shared docRef / collectionRef pair links circularly so any chained
// db.collection().doc().collection().doc() resolves through the same mocks.
// Tests assert on the call-order arguments of collectionMock / docMock / whereMock /
// updateMock / setMock / etc. to verify the exact Firestore path and payload.
const {
  collectionMock,
  docMock,
  docGetMock,
  queryGetMock,
  updateMock,
  setMock,
  deleteMock,
  whereMock,
  orderByMock,
  limitMock,
  batchMock,
  batchUpdateMock,
  batchSetMock,
  batchCreateMock,
  batchDeleteMock,
  batchCommitMock,
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateCache,
  runTransactionMock,
  getAllMock,
} = vi.hoisted(() => {
  const docGetMock = vi.fn();
  const queryGetMock = vi.fn();
  const updateMock = vi.fn().mockResolvedValue({});
  const setMock = vi.fn().mockResolvedValue({});
  const deleteMock = vi.fn().mockResolvedValue({});

  const docRef = {
    get: docGetMock,
    update: updateMock,
    set: setMock,
    delete: deleteMock,
    collection: null, // assigned below for circular link
  };
  const docMock = vi.fn().mockReturnValue(docRef);

  const limitMock = vi.fn();
  const orderByMock = vi.fn();
  const whereMock = vi.fn();
  const queryRef = {
    get: queryGetMock,
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
  };
  whereMock.mockReturnValue(queryRef);
  orderByMock.mockReturnValue(queryRef);
  limitMock.mockReturnValue(queryRef);

  const collectionRef = {
    doc: docMock,
    get: queryGetMock,
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
  };
  const collectionMock = vi.fn().mockReturnValue(collectionRef);
  docRef.collection = collectionMock; // <— circular link

  const batchUpdateMock = vi.fn();
  const batchSetMock = vi.fn();
  const batchCreateMock = vi.fn();
  const batchDeleteMock = vi.fn();
  const batchCommitMock = vi.fn().mockResolvedValue({});
  const batchRef = {
    update: batchUpdateMock,
    set: batchSetMock,
    create: batchCreateMock,
    delete: batchDeleteMock,
    commit: batchCommitMock,
  };
  const batchMock = vi.fn().mockReturnValue(batchRef);

  const cacheGet = vi.fn().mockReturnValue(undefined);
  const cacheSet = vi.fn();
  const cacheDel = vi.fn();
  const invalidateCache = vi.fn();

  // Tests verify atomicity by counting runTransaction invocations and inspecting
  // the per-call transaction.get/update/set/delete arguments. The fake tx
  // delegates back to the underlying mocks so existing assertions on
  // updateMock/setMock/deleteMock continue to work for transactional methods.
  const runTransactionMock = vi.fn().mockImplementation(async (cb) => {
    const tx = {
      get: vi.fn().mockImplementation((queryOrRef) => queryOrRef.get()),
      getAll: vi
        .fn()
        .mockImplementation((...refs) => Promise.all(refs.map((r) => r.get()))),
      update: vi.fn().mockImplementation((_ref, data) => updateMock(data)),
      set: vi.fn().mockImplementation((_ref, data) => setMock(data)),
      delete: vi.fn().mockImplementation((_ref) => deleteMock()),
    };
    return await cb(tx);
  });

  const getAllMock = vi.fn();

  return {
    collectionMock,
    docMock,
    docGetMock,
    queryGetMock,
    updateMock,
    setMock,
    deleteMock,
    whereMock,
    orderByMock,
    limitMock,
    batchMock,
    batchUpdateMock,
    batchSetMock,
    batchCreateMock,
    batchDeleteMock,
    batchCommitMock,
    cacheGet,
    cacheSet,
    cacheDel,
    invalidateCache,
    runTransactionMock,
    getAllMock,
  };
});

vi.mock('../src/config/firestore.js', () => ({
  db: {
    collection: collectionMock,
    batch: batchMock,
    runTransaction: runTransactionMock,
    getAll: getAllMock,
  },
}));

vi.mock('../src/utils/cacheUtils.js', () => ({
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateCache,
}));

// Helper — build a fake doc snapshot for query results.
const makeDoc = (id, data) => ({
  id,
  ref: { id },
  exists: true,
  data: () => data,
});

beforeEach(() => {
  vi.clearAllMocks();
  // mockResolvedValueOnce queues drain between tests with clearAllMocks; reset defaults:
  cacheGet.mockReturnValue(undefined);
});

// ─── Path helpers ─────────────────────────────────────────────────────────
// #477: String(NaN) is the valid path segment "NaN", so an unvalidated year
// silently produced a real, always-empty tournaments/NaN/{sub} ref.
// #598: testing only Number.isNaN caught 'abc' but missed the shapes a
// forgetful caller actually produces — '' coerces to 0, and undefined/null
// pass toNum unchanged — each building tournaments/0, tournaments/undefined,
// or tournaments/null. The guard now requires a positive integer, so an empty
// result can only mean actually empty.
describe('year path guard', () => {
  const repo = new EntryRepository();
  const tourneyRepo = new TourneyRepository();
  const gameRepo = new GameRepository();

  test.each([
    ['abc', 'non-numeric string'],
    ['NaN', 'the literal string NaN'],
    [{}, 'an object'],
    ['', 'empty string, which Number() coerces to 0 (#598)'],
    [0, 'zero (#598)'],
    [null, 'null, which toNum passes through unchanged (#598)'],
    [-2024, 'a negative year'],
    [2024.5, 'a non-integer year'],
  ])('rejects %s (%s) instead of building a real path', async (year) => {
    await expect(repo.getDeletedEntries(year)).rejects.toThrow(ValidationError);
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(docMock).not.toHaveBeenCalled();
  });

  test('undefined still falls back to thisYear where the method declares a default', async () => {
    // Deliberate, not an oversight: a JS default parameter fires on undefined,
    // so `year = thisYear` absorbs it before the guard ever sees it. Pinned so
    // nobody "fixes" the guard into rejecting a documented default.
    queryGetMock.mockResolvedValue({ docs: [] });

    await repo.getDeletedEntries(undefined);

    expect(docMock).toHaveBeenCalledWith(
      String(APP_CONFIG.tournament.currentYear),
    );
  });

  test('undefined is rejected where the method has no default', async () => {
    // deleteGamesByYear takes a bare `year`, so undefined used to address
    // tournaments/undefined and "succeed" against an empty collection — the
    // caller believing it had cleared a year it never touched.
    await expect(tourneyRepo.deleteGamesByYear(undefined)).rejects.toThrow(
      ValidationError,
    );
    expect(queryGetMock).not.toHaveBeenCalled();
  });

  test('the doc-level writers are guarded too, not just the subcollection helper', async () => {
    // upsertTournamentDoc addresses tournaments/{year} directly rather than
    // through yearCol, so before #598 it *created* a real tournaments/undefined
    // document holding { year: NaN } — a write, not merely an empty read.
    await expect(tourneyRepo.upsertTournamentDoc(undefined)).rejects.toThrow(
      ValidationError,
    );
    await expect(tourneyRepo.deleteTournamentDoc('')).rejects.toThrow(
      ValidationError,
    );
    expect(setMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test('reserved live-E2E years are still addressable', async () => {
    // The guard is deliberately narrower than parseYear, which bounds years to
    // 1980..currentYear+1. The live suites address these reserved years through
    // this layer, so mirroring parseYear's range here would break them.
    queryGetMock.mockResolvedValue({ docs: [] });

    for (const year of [9996, 9997, 9999]) {
      await repo.getDeletedEntries(year);
    }

    expect(docMock.mock.calls.map((c) => c[0])).toEqual([
      '9996',
      '9997',
      '9999',
    ]);
  });

  test('numeric and numeric-string years still resolve to the same path', async () => {
    queryGetMock.mockResolvedValue({ docs: [] });

    await repo.getDeletedEntries(2024);
    await repo.getDeletedEntries('2024');

    expect(docMock.mock.calls.map((c) => c[0])).toEqual(['2024', '2024']);
  });

  // The reserved block cuts both ways: the deployed app must not be able to
  // reach the sentinel years, and a live-E2E run must not be able to bulk-delete
  // a real season. testing.md stated the second rule; nothing enforced it.
  describe('reserved test-year block', () => {
    const ORIGINAL_ENV = { ...process.env };
    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
      process.env.LIVE_E2E = ORIGINAL_ENV.LIVE_E2E;
    });

    test('production cannot address a reserved year', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LIVE_E2E;

      await expect(repo.getDeletedEntries(9999)).rejects.toThrow(
        ValidationError,
      );
      expect(docMock).not.toHaveBeenCalled();
    });

    test('production can still address a real season', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LIVE_E2E;
      queryGetMock.mockResolvedValue({ docs: [] });

      await repo.getDeletedEntries(2026);

      expect(docMock).toHaveBeenCalledWith('2026');
    });

    test('a live-E2E run refuses a year-scoped delete of a real season', async () => {
      process.env.LIVE_E2E = 'true';

      // The exact shape that made targeted-updates.live.test.js unsafe: a live
      // suite seeded into a real-looking year, whose teardown wipes every
      // document for it rather than only the ones it created.
      //
      // All six bulkDeleteYearSegment call sites are asserted here, and adding
      // a seventh belongs in this loop: the guard is inert under plain
      // `npm test` (LIVE_E2E unset), so an unpinned destructive call site can
      // be swapped back to a raw String(year) with the suite staying green.
      // GameRepository carries its own deleteGamesByYear /
      // deleteSchoolRecordsByYear, distinct from TourneyRepository's twins.
      for (const year of [2019, 2022, 2026]) {
        await expect(tourneyRepo.deleteGamesByYear(year)).rejects.toThrow(
          ValidationError,
        );
        await expect(
          tourneyRepo.deleteSchoolRecordsByYear(year),
        ).rejects.toThrow(ValidationError);
        await expect(tourneyRepo.deleteRegionsByYear(year)).rejects.toThrow(
          ValidationError,
        );
        await expect(tourneyRepo.deleteTournamentDoc(year)).rejects.toThrow(
          ValidationError,
        );
        await expect(gameRepo.deleteGamesByYear(year)).rejects.toThrow(
          ValidationError,
        );
        await expect(gameRepo.deleteSchoolRecordsByYear(year)).rejects.toThrow(
          ValidationError,
        );
      }
      expect(queryGetMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    test('a live-E2E run may still delete the reserved years', async () => {
      process.env.LIVE_E2E = 'true';
      queryGetMock.mockResolvedValue({ docs: [] });

      await tourneyRepo.deleteGamesByYear(9995);
      await tourneyRepo.deleteRegionsByYear(9999);

      expect(docMock.mock.calls.map((c) => c[0])).toEqual(['9995', '9999']);
    });

    test('production may still delete a real season — the admin flow depends on it', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LIVE_E2E;
      queryGetMock.mockResolvedValue({ docs: [] });

      await tourneyRepo.deleteGamesByYear(2022);

      expect(docMock).toHaveBeenCalledWith('2022');
    });
  });

  // Wiring tests. The guard itself is covered above via getDeletedEntries and
  // the delete methods; these pin that each remaining call site is actually
  // routed through it, so swapping one back to a raw String(year) fails here
  // rather than silently reopening the hole at that one path builder.
  describe('every tournaments path builder is wired to the guard', () => {
    test.each([0, '', null, -2024, 2024.5])(
      'the pendingRecalcSIDs trio rejects an invalid year (%s)',
      async (year) => {
        await expect(gameRepo.addPendingRecalcSIDs(year, [1])).rejects.toThrow(
          ValidationError,
        );
        await expect(gameRepo.getPendingRecalcSIDs(year)).rejects.toThrow(
          ValidationError,
        );
        await expect(
          gameRepo.clearPendingRecalcSIDs(year, [1]),
        ).rejects.toThrow(ValidationError);

        expect(setMock).not.toHaveBeenCalled();
        expect(docGetMock).not.toHaveBeenCalled();
      },
    );

    // The one shape the guard suite above can't reach: the year is pulled out
    // of row position [2] rather than passed as an argument, so a malformed row
    // is the failure mode rather than a malformed call.
    test.each([undefined, 0, '', null])(
      'the batch inserts reject a bad year embedded in the row (%s)',
      async (year) => {
        const row = [1, 1, year, 67, 307, null, 1, 9, 1, 1, 16];

        await expect(
          tourneyRepo.insertMultipleGamesWithoutTeams([row]),
        ).rejects.toThrow(ValidationError);
        await expect(
          tourneyRepo.insertMultipleGamesWithTeams([row]),
        ).rejects.toThrow(ValidationError);

        expect(batchSetMock).not.toHaveBeenCalled();
        expect(batchCommitMock).not.toHaveBeenCalled();
      },
    );
  });
});

// ─── EntryRepository ──────────────────────────────────────────────────────
describe('EntryRepository', () => {
  const repo = new EntryRepository();

  test('updateMultipleEntryPoints writes one batch.update per entry with totalPoints+possPoints', async () => {
    await repo.updateMultipleEntryPoints(
      [
        { entryID: 1, points: 10, possPoints: 100 },
        { entryID: 2, points: 20, possPoints: 200 },
      ],
      2024,
    );

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      totalPoints: 10,
      possPoints: 100,
    });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(2, expect.anything(), {
      totalPoints: 20,
      possPoints: 200,
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);

    // Path: tournaments/{year}/entries/{id} — walked once per entry, in order
    expect(collectionMock.mock.calls.map((c) => c[0])).toEqual([
      'tournaments',
      'entries',
      'tournaments',
      'entries',
    ]);
    expect(docMock.mock.calls.map((c) => c[0])).toEqual([
      '2024',
      '1',
      '2024',
      '2',
    ]);
  });

  test('writes extreme point values through unchanged, without clamping', async () => {
    // The points engine owns the arithmetic; this method is a pass-through
    // writer. Pinned so a "sanitize the payload" change here has to be
    // deliberate — silently clamping a negative (possible mid-correction) or a
    // large value would corrupt standings with no error anywhere.
    await repo.updateMultipleEntryPoints(
      [
        { entryID: 1, points: -10, possPoints: -5 },
        {
          entryID: 2,
          points: Number.MAX_SAFE_INTEGER,
          possPoints: Number.MAX_SAFE_INTEGER,
        },
      ],
      2024,
    );

    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      totalPoints: -10,
      possPoints: -5,
    });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(2, expect.anything(), {
      totalPoints: Number.MAX_SAFE_INTEGER,
      possPoints: Number.MAX_SAFE_INTEGER,
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  test('createEntry writes full entry doc and busts per-group + allEntries caches', async () => {
    await repo.createEntry(
      7,
      'x@y.com',
      'Team X',
      [1, 2],
      ['A', 'B'],
      'Alice',
      '2024-03-01',
      2024,
      150,
    );

    expect(setMock).toHaveBeenCalledWith({
      id: 7,
      email: 'x@y.com',
      teamName: 'Team X',
      picks: [1, 2],
      groups: ['A', 'B'],
      person: 'Alice',
      created_at: '2024-03-01',
      possPoints: 150,
      totalPoints: 0,
    });

    // Cache busts (per-group keys + global key)
    expect(cacheDel).toHaveBeenCalledWith('groupTeams_A_2024');
    expect(cacheDel).toHaveBeenCalledWith('groupTeams_B_2024');
    expect(cacheDel).toHaveBeenCalledWith('entriesForGroup_A_2024');
    expect(cacheDel).toHaveBeenCalledWith('entriesForGroup_B_2024');
    expect(cacheDel).toHaveBeenCalledWith('gameViewData_2024_A');
    expect(cacheDel).toHaveBeenCalledWith('fullGridData_2024_A');
    expect(cacheDel).toHaveBeenCalledWith('gameViewData_2024_B');
    expect(cacheDel).toHaveBeenCalledWith('fullGridData_2024_B');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
  });

  test('createEntry wraps a single groupName string into a groups array', async () => {
    await repo.createEntry(
      8,
      'a@b.com',
      'T',
      [],
      'OnlyGroup',
      'P',
      '2024-03-01',
      2024,
      0,
    );

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ groups: ['OnlyGroup'] }),
    );
    expect(cacheDel).toHaveBeenCalledWith('groupTeams_OnlyGroup_2024');
  });

  test('findEntriesByName filters case-insensitively against person OR teamName and returns slim shape', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          person: 'Alice',
          teamName: 'Wildcats',
          groups: ['A'],
          hasPaid: true,
          paymentNote: 'PAID',
          payByCheck: false,
        }),
        makeDoc('2', {
          id: 2,
          person: 'Alex',
          teamName: "alice's",
          groups: ['B'],
        }), // matches via teamName
        makeDoc('3', {
          id: 3,
          person: 'Charlie',
          teamName: 'Other',
          groups: ['C'],
        }), // no match
        makeDoc('4', {
          id: 4,
          person: 'Alice Deleted',
          teamName: 'Ghost',
          groups: ['A'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }), // soft-deleted — excluded
      ],
    });

    const results = await repo.findEntriesByName('ALICE', 2024);

    expect(results).toHaveLength(2);
    expect(results.map((e) => e.id)).not.toContain(4);
    expect(results[0]).toEqual({
      id: 1,
      teamName: 'Wildcats',
      person: 'Alice',
      year: 2024,
      groups: ['A'],
      hasPaid: true,
      paymentNote: 'PAID',
      payByCheck: false,
    });
    // Defaults for missing fields on doc 2
    expect(results[1]).toEqual({
      id: 2,
      teamName: "alice's",
      person: 'Alex',
      year: 2024,
      groups: ['B'],
      hasPaid: false,
      paymentNote: '',
      payByCheck: false,
    });
    // Populates the entriesByNameRaw cache so repeated typeahead keystrokes
    // skip the DB read.
    expect(cacheSet).toHaveBeenCalledWith(
      'entriesByNameRaw_2024',
      expect.any(Array),
      300,
    );
  });

  test('findEntriesByName cache hit filters the cached list without a DB read', async () => {
    cacheGet.mockReturnValue([
      {
        id: 1,
        person: 'Alice',
        teamName: 'Wildcats',
        year: 2024,
        groups: ['A'],
        hasPaid: true,
        paymentNote: '',
        payByCheck: false,
      },
      {
        id: 2,
        person: 'Alex',
        teamName: 'Other',
        year: 2024,
        groups: ['B'],
        hasPaid: false,
        paymentNote: '',
        payByCheck: false,
      },
    ]);

    const results = await repo.findEntriesByName('alice', 2024);

    expect(cacheGet).toHaveBeenCalledWith('entriesByNameRaw_2024');
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  test('entry-write methods invalidate entriesByNameRaw_{year} alongside allEntries_{year}', async () => {
    // createEntry
    await repo.createEntry(
      7,
      'x@y.com',
      'Team X',
      [1, 2],
      ['A'],
      'Alice',
      '2024-03-01',
      2024,
      0,
    );
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');

    cacheDel.mockClear();
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await repo.deleteEntry('42', 2024);
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');

    cacheDel.mockClear();
    await repo.updateEntryPicks('5', [10], 2024);
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');

    cacheDel.mockClear();
    await repo.updateMultipleEntryPicks([{ entryId: '1', picks: [9] }], 2024);
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');
  });

  // #370 — every one of the writes above also has to clear entriesByEmail_ (the
  // /my-brackets cache added in this change), since none of them know in advance
  // which cached email(s) they affect.
  test('entry-write methods also invalidate entriesByEmail_', async () => {
    await repo.createEntry(
      7,
      'x@y.com',
      'Team X',
      [1, 2],
      ['A'],
      'Alice',
      '2024-03-01',
      2024,
      0,
    );
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');

    invalidateCache.mockClear();
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await repo.deleteEntry('42', 2024);
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');

    invalidateCache.mockClear();
    await repo.updateEntryPicks('5', [10], 2024);
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');

    invalidateCache.mockClear();
    await repo.updateMultipleEntryPicks([{ entryId: '1', picks: [9] }], 2024);
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');

    invalidateCache.mockClear();
    await repo.updateMultipleEntryPoints(
      [{ entryID: 1, points: 10, possPoints: 100 }],
      2024,
    );
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');
  });

  test('getUnpaidEntriesForGroup queries by array-contains and filters out paid + payByCheck + soft-deleted', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          person: 'Alice',
          teamName: 'A',
          groups: ['G'],
          hasPaid: false,
          payByCheck: false,
        }),
        makeDoc('2', {
          id: 2,
          person: 'Alex',
          teamName: 'B',
          groups: ['G'],
          hasPaid: true,
          payByCheck: false,
        }),
        makeDoc('3', {
          id: 3,
          person: 'Carol',
          teamName: 'C',
          groups: ['G'],
          hasPaid: false,
          payByCheck: true,
        }),
        makeDoc('4', {
          id: 4,
          person: 'Dave',
          teamName: 'D',
          groups: ['G'],
          hasPaid: false,
          payByCheck: false,
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const results = await repo.getUnpaidEntriesForGroup('G', 2024);

    expect(whereMock).toHaveBeenCalledWith('groups', 'array-contains', 'G');
    expect(results).toEqual([
      {
        id: 1,
        teamName: 'A',
        person: 'Alice',
        year: 2024,
        groups: ['G'],
        hasPaid: false,
        paymentNote: '',
      },
    ]);
  });

  describe('deleteEntry', () => {
    test('soft-deletes by stamping deletedAt (does not remove the doc) and invalidates group + allEntries + gameViewData caches', async () => {
      docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });

      await repo.deleteEntry('42', 2024);

      expect(deleteMock).not.toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledWith({
        deletedAt: expect.any(String),
      });
      expect(docMock).toHaveBeenCalledWith('42');
      expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
      expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');
      expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    });

    test("raises a ValidationError (not a generic 500) when the entry doc doesn't exist", async () => {
      docGetMock.mockResolvedValueOnce({ exists: false });

      await expect(repo.deleteEntry('42', 2024)).rejects.toThrow(
        new ValidationError('Entry not found.', 'entryId'),
      );
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('double-delete is a no-op — preserves the original deletedAt instead of restamping it', async () => {
      docGetMock.mockResolvedValueOnce({
        exists: true,
        data: () => ({ deletedAt: '2024-03-01T00:00:00.000Z' }),
      });

      await repo.deleteEntry('42', 2024);

      expect(updateMock).not.toHaveBeenCalled();
      expect(invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('restoreEntry', () => {
    test('clears deletedAt via FieldValue.delete() and invalidates the same caches', async () => {
      docGetMock.mockResolvedValueOnce({
        exists: true,
        data: () => ({ deletedAt: '2024-03-01T00:00:00.000Z' }),
      });

      const result = await repo.restoreEntry('42', 2024);

      expect(result).toBe(true);
      expect(updateMock).toHaveBeenCalledWith({
        deletedAt: FieldValue.delete(),
      });
      expect(docMock).toHaveBeenCalledWith('42');
      expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
      expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');
      expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    });

    test("raises a ValidationError (not a generic 500) when the entry doc doesn't exist", async () => {
      docGetMock.mockResolvedValueOnce({ exists: false });

      await expect(repo.restoreEntry('42', 2024)).rejects.toThrow(
        new ValidationError('Entry not found.', 'entryId'),
      );
      expect(updateMock).not.toHaveBeenCalled();
    });

    test('no-ops when the entry is already live (no deletedAt)', async () => {
      docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });

      const result = await repo.restoreEntry('42', 2024);

      expect(result).toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
      expect(invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('purgeEntry', () => {
    test('hard-deletes an entry that was already soft-deleted, inside a transaction', async () => {
      docGetMock.mockResolvedValueOnce({
        exists: true,
        data: () => ({ deletedAt: '2024-03-01T00:00:00.000Z' }),
      });

      await repo.purgeEntry('42', 2024);

      // The guard's read and the delete happen inside one runTransaction call
      // (not a plain read-then-delete), so a restoreEntry racing between the
      // two can't leave a freshly-restored, live entry hard-deleted.
      expect(runTransactionMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(docMock).toHaveBeenCalledWith('42');
      expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');
      expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    });

    test("refuses to hard-delete an entry that hasn't been soft-deleted first", async () => {
      docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });

      await expect(repo.purgeEntry('42', 2024)).rejects.toThrow(
        ValidationError,
      );
      expect(deleteMock).not.toHaveBeenCalled();
    });

    test('no-ops when the entry doc no longer exists', async () => {
      docGetMock.mockResolvedValueOnce({ exists: false });

      await repo.purgeEntry('42', 2024);
      expect(deleteMock).not.toHaveBeenCalled();
    });
  });

  test('getDeletedEntries returns only soft-deleted entries, newest-deleted first', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          person: 'Alice',
          teamName: 'T1',
          email: 'a@x',
          groups: ['G'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
        makeDoc('2', {
          id: 2,
          person: 'Alex',
          teamName: 'T2',
          email: 'b@x',
          groups: ['G'],
        }), // not deleted
        makeDoc('3', {
          id: 3,
          person: 'Carol',
          teamName: 'T3',
          email: 'c@x',
          groups: ['G'],
          deletedAt: '2024-03-05T00:00:00.000Z',
        }),
      ],
    });

    const results = await repo.getDeletedEntries(2024);

    expect(results.map((e) => e.id)).toEqual([3, 1]);
    expect(results[0]).toEqual({
      id: 3,
      teamName: 'T3',
      person: 'Carol',
      email: 'c@x',
      year: 2024,
      groups: ['G'],
      deletedAt: '2024-03-05T00:00:00.000Z',
    });
  });

  test('getDeletedEntries normalizes a legacy singular `group` field into groups[]', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('4', {
          id: 4,
          person: 'Dave',
          teamName: 'T4',
          email: 'd@x',
          group: 'Legacy',
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const results = await repo.getDeletedEntries(2024);
    expect(results).toEqual([
      {
        id: 4,
        teamName: 'T4',
        person: 'Dave',
        email: 'd@x',
        year: 2024,
        groups: ['Legacy'],
        deletedAt: '2024-03-01T00:00:00.000Z',
      },
    ]);
  });

  // #478: the Recently Deleted modal used to pay a full scan of the year's
  // entries on every open/refresh, unlike every sibling full-collection read.
  test('getDeletedEntries caches its result under deletedEntries_{year} with a 300s TTL', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          person: 'Alice',
          teamName: 'T1',
          email: 'a@x',
          groups: ['G'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const results = await repo.getDeletedEntries(2024);

    expect(cacheSet).toHaveBeenCalledWith('deletedEntries_2024', results, 300);
  });

  test('getDeletedEntries serves a warm cache hit without touching Firestore', async () => {
    const cached = [
      {
        id: 9,
        teamName: 'T9',
        person: 'Zoe',
        email: 'z@x',
        year: 2024,
        groups: ['G'],
        deletedAt: '2024-03-09T00:00:00.000Z',
      },
    ];
    cacheGet.mockReturnValue(cached);

    const results = await repo.getDeletedEntries(2024);

    expect(cacheGet).toHaveBeenCalledWith('deletedEntries_2024');
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(results).toBe(cached);
  });

  test('delete/restore/purge bust deletedEntries_{year}', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await repo.deleteEntry('42', 2024);
    expect(cacheDel).toHaveBeenCalledWith('deletedEntries_2024');

    cacheDel.mockClear();
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ deletedAt: '2024-03-01T00:00:00.000Z' }),
    });
    await repo.restoreEntry('42', 2024);
    expect(cacheDel).toHaveBeenCalledWith('deletedEntries_2024');

    cacheDel.mockClear();
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ deletedAt: '2024-03-01T00:00:00.000Z' }),
    });
    await repo.purgeEntry('42', 2024);
    expect(cacheDel).toHaveBeenCalledWith('deletedEntries_2024');
  });

  test('updateEntryPicks writes picks-only update and invalidates relevant caches', async () => {
    await repo.updateEntryPicks('5', [10, 20], 2024);

    expect(updateMock).toHaveBeenCalledWith({ picks: [10, 20] });
    expect(docMock).toHaveBeenCalledWith('5');
    expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
  });

  test('updateMultipleEntryPicks no-ops on empty array (no batch.commit)', async () => {
    await repo.updateMultipleEntryPicks([], 2024);
    expect(batchMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  test('updateMultipleEntryPicks chunks at 500 (601 updates → 2 batches)', async () => {
    const updates = Array.from({ length: 601 }, (_, i) => ({
      entryId: String(i + 1),
      picks: [i],
    }));
    await repo.updateMultipleEntryPicks(updates, 2024);

    expect(batchMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenCalledTimes(601);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      picks: [0],
    });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(601, expect.anything(), {
      picks: [600],
    });
    // The whole point of the batched path: caches are swept ONCE per call
    // (one invalidateCache per prefix), not once per chunk or per entry.
    expect(invalidateCache).toHaveBeenCalledTimes(5);
    expect(cacheDel).toHaveBeenCalledTimes(2);
  });

  test('updateMultipleEntryPicks invalidates caches even if a batch commit rejects', async () => {
    const updates = [{ entryId: '1', picks: [9] }];
    batchCommitMock.mockRejectedValueOnce(new Error('Batch failed'));

    await expect(repo.updateMultipleEntryPicks(updates, 2024)).rejects.toThrow(
      'Batch failed',
    );

    expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');
  });

  // #324 — batched-transactional swap application. Each ≤500-entry chunk is
  // ONE db.runTransaction that re-reads every entry via getAll (so concurrent
  // writes trigger a Firestore retry instead of being clobbered from the
  // caller's stale query snapshot), and the caches are swept once per call.
  describe('updateEntryPicksWithSwaps', () => {
    const entryDoc = (id, data) => ({
      id,
      ref: { id },
      exists: true,
      data: () => data,
    });

    test('applies swaps to freshly-read picks in one transaction, coerces to Number, busts caches once', async () => {
      docGetMock.mockResolvedValueOnce(entryDoc('7', { picks: [1, 2, 3] }));

      await repo.updateEntryPicksWithSwaps(['7'], [[99, 2]], 2024);

      expect(runTransactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({ picks: [1, 99, 3] });
      expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
      expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
      expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
      expect(invalidateCache).toHaveBeenCalledTimes(5);
      expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
      expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');
      expect(cacheDel).toHaveBeenCalledTimes(2);
    });

    test('applies multiple swaps to multiple entries in a single transaction', async () => {
      docGetMock
        .mockResolvedValueOnce(entryDoc('1', { picks: [1, 5] }))
        .mockResolvedValueOnce(entryDoc('2', { picks: [2, 6] }))
        .mockResolvedValueOnce(entryDoc('3', { picks: [1, 2] }));

      await repo.updateEntryPicksWithSwaps(
        ['1', '2', '3'],
        [
          [101, 1],
          [202, 2],
        ],
        2024,
      );

      expect(runTransactionMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledTimes(3);
      expect(updateMock).toHaveBeenNthCalledWith(1, { picks: [101, 5] });
      expect(updateMock).toHaveBeenNthCalledWith(2, { picks: [202, 6] });
      expect(updateMock).toHaveBeenNthCalledWith(3, { picks: [101, 202] });
      expect(invalidateCache).toHaveBeenCalledTimes(5);
    });

    test("skips entries deleted since the caller's query without failing the rest of the chunk", async () => {
      docGetMock
        .mockResolvedValueOnce({ exists: false, ref: { id: 'ghost' } })
        .mockResolvedValueOnce(entryDoc('2', { picks: [2] }));

      await repo.updateEntryPicksWithSwaps(['ghost', '2'], [[99, 2]], 2024);

      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith({ picks: [99] });
    });

    test('does not write entries whose picks are unaffected', async () => {
      docGetMock.mockResolvedValueOnce(entryDoc('7', { picks: [1, 2, 3] }));

      await repo.updateEntryPicksWithSwaps(['7'], [[99, 42]], 2024);

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('skips falsy removeSIDs', async () => {
      docGetMock.mockResolvedValueOnce(entryDoc('7', { picks: [1, 2, 3] }));

      await repo.updateEntryPicksWithSwaps(['7'], [[99, null]], 2024);

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('coerces legacy string picks to numbers via .map(Number) on write', async () => {
      docGetMock.mockResolvedValueOnce(
        entryDoc('7', { picks: ['1', '2', '3'] }),
      );

      await repo.updateEntryPicksWithSwaps(['7'], [[99, '2']], 2024);

      expect(updateMock).toHaveBeenCalledWith({ picks: [1, 99, 3] });
    });

    test('tolerates entries missing a picks field', async () => {
      docGetMock.mockResolvedValueOnce(entryDoc('8', {}));

      await repo.updateEntryPicksWithSwaps(['8'], [[99, 2]], 2024);

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('chunks at 500 (501 entries → 2 transactions) with a single cache sweep', async () => {
      docGetMock.mockResolvedValue({ exists: false, ref: {} });
      const entryIds = Array.from({ length: 501 }, (_, i) => String(i + 1));

      await repo.updateEntryPicksWithSwaps(entryIds, [[99, 2]], 2024);

      expect(runTransactionMock).toHaveBeenCalledTimes(2);
      expect(invalidateCache).toHaveBeenCalledTimes(5);
      expect(cacheDel).toHaveBeenCalledTimes(2);
    });

    test('no-ops on empty entryIds (no transaction, no cache invalidation)', async () => {
      await repo.updateEntryPicksWithSwaps([], [[99, 2]], 2024);

      expect(runTransactionMock).not.toHaveBeenCalled();
      expect(invalidateCache).not.toHaveBeenCalled();
      expect(cacheDel).not.toHaveBeenCalled();
    });

    test('invalidates caches even if a transaction rejects', async () => {
      runTransactionMock.mockRejectedValueOnce(new Error('Transaction failed'));

      await expect(
        repo.updateEntryPicksWithSwaps(['7'], [[99, 2]], 2024),
      ).rejects.toThrow('Transaction failed');

      expect(invalidateCache).toHaveBeenCalledTimes(5);
      expect(cacheDel).toHaveBeenCalledTimes(2);
    });
  });

  test('getUnsentEmailEntries filters out emailSent=true and soft-deleted entries, returns email shape', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          email: 'a@x',
          person: 'A',
          teamName: 'T1',
          picks: [1],
          groups: ['G'],
          emailSent: false,
        }),
        makeDoc('2', {
          id: 2,
          email: 'b@x',
          person: 'B',
          teamName: 'T2',
          picks: [2],
          groups: ['G'],
          emailSent: true,
        }),
        makeDoc('3', {
          id: 3,
          email: 'c@x',
          person: 'C',
          teamName: 'T3',
          picks: [3],
          groups: ['G'],
          emailSent: false,
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const results = await repo.getUnsentEmailEntries('G', 2024);

    expect(whereMock).toHaveBeenCalledWith('groups', 'array-contains', 'G');
    expect(results).toEqual([
      {
        id: 1,
        email: 'a@x',
        person: 'A',
        teamName: 'T1',
        picks: [1],
        groups: ['G'],
        year: 2024,
      },
    ]);
  });

  test('markEmailsSent batches one update per id with { emailSent: true }', async () => {
    await repo.markEmailsSent(['10', '11'], 2024);

    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      emailSent: true,
    });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(2, expect.anything(), {
      emailSent: true,
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith('10');
    expect(docMock).toHaveBeenCalledWith('11');
  });

  test('markEmailsSent chunks into ≤500-op batches instead of one oversized batch (#374)', async () => {
    const entryIds = Array.from({ length: 501 }, (_, i) => String(i));

    await repo.markEmailsSent(entryIds, 2024);

    // 501 ids -> two batch.commit() calls (500 + 1), not one that Firestore would reject.
    expect(batchMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenCalledTimes(501);
  });
});

// ─── ViewRepository ───────────────────────────────────────────────────────
describe('ViewRepository', () => {
  const repo = new ViewRepository();

  test('findGroupByName cache hit short-circuits the DB (no get() calls)', async () => {
    cacheGet.mockReturnValue('CachedGroup');

    const res = await repo.findGroupByName('CachedGroup');

    expect(res).toBe('CachedGroup');
    expect(cacheGet).toHaveBeenCalledWith('groupByName_cachedgroup');
    expect(docGetMock).not.toHaveBeenCalled();
    expect(queryGetMock).not.toHaveBeenCalled();
  });

  test('findGroupByName uses exact-name doc lookup first and caches the hit for 24h', async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Alex' }),
    });

    const res = await repo.findGroupByName('Alex');

    expect(collectionMock).toHaveBeenCalledWith('groups');
    expect(docMock).toHaveBeenCalledWith('Alex');
    expect(res).toBe('Alex');
    expect(cacheSet).toHaveBeenCalledWith('groupByName_alex', 'Alex', 86400);
  });

  test('findGroupByName falls back to case-insensitive scan if doc missing', async () => {
    docGetMock.mockResolvedValue({ exists: false });
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('Alice', { name: 'Alice' }),
        makeDoc('Alex', { name: 'Alex' }),
      ],
    });

    const res = await repo.findGroupByName('alex');

    expect(res).toBe('Alex'); // returns DB casing
    expect(cacheSet).toHaveBeenCalledWith('groupByName_alex', 'Alex', 86400);
  });

  test("findGroupByName caches a null result so missing groups don't re-query", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    queryGetMock.mockResolvedValue({ docs: [] });

    const res = await repo.findGroupByName('Nope');
    expect(res).toBeNull();
    expect(cacheSet).toHaveBeenCalledWith('groupByName_nope', null, 86400);
  });

  // #589: the four public routes that reach this method pass a raw request
  // param, so a repeated form key arrives as an array and an omitted one as
  // undefined. Both used to throw out of the `name.toLowerCase()` cache-key
  // line and surface as an unhandled 500.
  test.each([
    ['an array (repeated form key)', ['a', 'b']],
    ['undefined (field omitted)', undefined],
    ['null', null],
    ['a number', 42],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])(
    'findGroupByName returns null without touching the DB when name is %s',
    async (_label, name) => {
      const res = await repo.findGroupByName(name);

      expect(res).toBeNull();
      expect(docGetMock).not.toHaveBeenCalled();
      expect(queryGetMock).not.toHaveBeenCalled();
      // Nothing is cached either: the key itself is what could not be built.
      expect(cacheSet).not.toHaveBeenCalled();
    },
  );

  test('getGroupTeams maps to slim shape, excludes soft-deleted entries, and caches for 5 minutes', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          teamName: 'T',
          picks: [9],
          totalPoints: 5,
          person: 'Alice',
          possPoints: 100,
          junk: 'drop',
        }),
        makeDoc('2', {
          id: 2,
          teamName: 'Ghost',
          picks: [9],
          totalPoints: 0,
          person: 'Alex',
          possPoints: 0,
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const res = await repo.getGroupTeams('G', 2024);

    expect(whereMock).toHaveBeenCalledWith('groups', 'array-contains', 'G');
    expect(res).toEqual([
      {
        id: 1,
        teamName: 'T',
        picks: [9],
        totalPoints: 5,
        person: 'Alice',
        possPoints: 100,
      },
    ]);
    expect(cacheSet).toHaveBeenCalledWith('groupTeams_G_2024', res, 300);
  });

  test('getMaxGroupId queries groups orderBy id desc limit 1', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('x', { id: 42 })],
    });

    const max = await repo.getMaxGroupId();

    expect(collectionMock).toHaveBeenCalledWith('groups');
    expect(orderByMock).toHaveBeenCalledWith('id', 'desc');
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(max).toBe(42);
  });

  test('getMaxGroupId returns 0 when no groups exist', async () => {
    queryGetMock.mockResolvedValue({ empty: true });
    expect(await repo.getMaxGroupId()).toBe(0);
  });

  test('addGroup writes {id,name} and busts allGroups + lookup caches', async () => {
    await repo.addGroup(5, 'MyGroup');
    expect(setMock).toHaveBeenCalledWith({ id: 5, name: 'MyGroup' });
    expect(docMock).toHaveBeenCalledWith('MyGroup');
    expect(cacheDel).toHaveBeenCalledWith('allGroups');
    expect(cacheDel).toHaveBeenCalledWith('groupByName_mygroup');
  });

  test('getAllGroups returns sorted names and caches for 24h', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('A', { name: 'Group A' }),
        makeDoc('B', { name: 'Group B' }),
      ],
    });
    const res = await repo.getAllGroups();

    expect(orderByMock).toHaveBeenCalledWith('name', 'asc');
    expect(res).toEqual(['Group A', 'Group B']);
    expect(cacheSet).toHaveBeenCalledWith('allGroups', res, 86400);
  });

  test('getAllGroups returns cached value without querying', async () => {
    cacheGet.mockReturnValue(['Cached A', 'Cached B']);
    const res = await repo.getAllGroups();
    expect(res).toEqual(['Cached A', 'Cached B']);
    expect(queryGetMock).not.toHaveBeenCalled();
  });
});

// ─── GameRepository ───────────────────────────────────────────────────────
describe('GameRepository', () => {
  const repo = new GameRepository();

  describe('getEntriesByEmail', () => {
    test('returns [] for an empty email without touching Firestore', async () => {
      const result = await repo.getEntriesByEmail('');
      expect(result).toEqual([]);
      expect(collectionMock).not.toHaveBeenCalledWith('tournaments');
    });

    test("queries each year's entries by email, tags year, and sorts newest-year first", async () => {
      queryGetMock
        .mockResolvedValueOnce({
          docs: [makeDoc('2025', {}), makeDoc('2026', {})],
        }) // tournaments.get()
        .mockResolvedValueOnce({
          docs: [makeDoc('a', { id: 'a', email: 'u@g.com', teamName: 'T25' })],
        }) // 2025 entries
        .mockResolvedValueOnce({
          docs: [makeDoc('b', { id: 'b', email: 'u@g.com', teamName: 'T26' })],
        }); // 2026 entries

      const result = await repo.getEntriesByEmail('u@g.com');

      // Filtered the entries subcollection by the email field, and read the
      // small top-level tournaments collection first (getAllYearsForGroup pattern).
      expect(whereMock).toHaveBeenCalledWith('email', 'in', ['u@g.com']);
      expect(collectionMock).toHaveBeenCalledWith('tournaments');
      // Tagged with year + sorted newest-year first.
      expect(result.map((e) => e.year)).toEqual([2026, 2025]);
      expect(result.map((e) => e.id)).toEqual(['b', 'a']);
    });

    // #634 — a live run that crashed mid-teardown leaves a real
    // tournaments/9999 parent doc in the same Firestore the deployed app
    // reads. Enumerating it fed '9999' back into yearSegment, whose reserved
    // block rejects it outside a test context; Promise.all turned that one bad
    // id into a rejected call and a 400 on /my-brackets for every signed-in
    // user. A legacy tournaments/0 does the same.
    describe('unusable stored year ids (#634)', () => {
      const ORIGINAL_ENV = { ...process.env };
      afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
        process.env.LIVE_E2E = ORIGINAL_ENV.LIVE_E2E;
      });

      test('production skips them instead of failing the whole read', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.LIVE_E2E;
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => {});

        queryGetMock
          .mockResolvedValueOnce({
            docs: ['2024', '2025', '9999', '0', 'metadata'].map((y) =>
              makeDoc(y, {}),
            ),
          })
          .mockResolvedValueOnce({
            docs: [makeDoc('a', { id: 'a', email: 'u@g.com' })],
          })
          .mockResolvedValueOnce({
            docs: [makeDoc('b', { id: 'b', email: 'u@g.com' })],
          });

        const result = await repo.getEntriesByEmail('u@g.com');

        // Only the two real years were fanned out on: 1 tournaments read + 2.
        expect(queryGetMock).toHaveBeenCalledTimes(3);
        expect(result.map((e) => e.year)).toEqual([2025, 2024]);
        // Both the numeric-invalid and non-numeric garbage ids were logged and skipped.
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('9999'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('0'));
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('metadata'),
        );
      });

      test('a live-E2E run still enumerates the reserved years', async () => {
        process.env.LIVE_E2E = 'true';

        queryGetMock
          .mockResolvedValueOnce({
            docs: ['2025', '9999'].map((y) => makeDoc(y, {})),
          })
          .mockResolvedValueOnce({ docs: [] })
          .mockResolvedValueOnce({
            docs: [makeDoc('r', { id: 'r', email: 'u@g.com' })],
          });

        const result = await repo.getEntriesByEmail('u@g.com');

        expect(queryGetMock).toHaveBeenCalledTimes(3);
        expect(result.map((e) => e.year)).toEqual([9999]);
      });
    });

    test('drops entries whose stored email does not match (defense-in-depth)', async () => {
      queryGetMock
        .mockResolvedValueOnce({ docs: [makeDoc('2026', {})] })
        .mockResolvedValueOnce({
          docs: [
            makeDoc('a', { id: 'a', email: 'u@g.com' }),
            makeDoc('x', { id: 'x', email: 'someone-else@g.com' }),
          ],
        });

      const result = await repo.getEntriesByEmail('u@g.com');
      expect(result.map((e) => e.id)).toEqual(['a']);
    });

    // #327 — every earlier test passes an already-lowercase email, collapsing
    // `variants` to one element, so the single-query 'in' array matching
    // (the legacy un-normalized-row safety net) was never exercised.
    test('mixed-case input queries both the raw and lowercased variants', async () => {
      queryGetMock.mockResolvedValue({ docs: [] });

      await repo.getEntriesByEmail('User@G.com', 2026);

      expect(whereMock).toHaveBeenCalledWith('email', 'in', [
        'User@G.com',
        'user@g.com',
      ]);
      expect(queryGetMock).toHaveBeenCalledTimes(1); // one 'in' query
    });

    test('drops soft-deleted entries even when the email matches', async () => {
      queryGetMock
        .mockResolvedValueOnce({ docs: [makeDoc('2026', {})] }) // tournaments
        .mockResolvedValueOnce({
          docs: [
            makeDoc('a', { id: 'a', email: 'u@g.com' }),
            makeDoc('x', {
              id: 'x',
              email: 'u@g.com',
              deletedAt: '2024-03-01T00:00:00.000Z',
            }),
          ],
        }); // 2026 entries

      const result = await repo.getEntriesByEmail('u@g.com');
      expect(result.map((e) => e.id)).toEqual(['a']);
    });

    test('drops docs whose stored email lowercases to a different address', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [
          makeDoc('a', { id: 'a', email: 'USER@g.com' }),
          makeDoc('x', { id: 'x', email: 'OTHER@g.com' }),
        ],
      }); // 2026 entries (single year query)

      const result = await repo.getEntriesByEmail('User@G.com', 2026);

      // "USER@g.com" lowercases to the requested address → kept; "OTHER@g.com"
      // does not → dropped by the final in-memory ownership filter.
      expect(result.map((e) => e.id)).toEqual(['a']);
    });

    test('scopes to a single year (skips the tournaments read) when year is passed', async () => {
      // Exactly one get() — the year's entries query — and no separate
      // tournaments.get() collection scan (which the all-years path needs first).
      queryGetMock.mockResolvedValueOnce({
        docs: [makeDoc('a', { id: 'a', email: 'u@g.com', teamName: 'T26' })],
      });

      const result = await repo.getEntriesByEmail('u@g.com', 2026);

      expect(queryGetMock).toHaveBeenCalledTimes(1);
      expect(whereMock).toHaveBeenCalledWith('email', 'in', ['u@g.com']);
      expect(result.map((e) => e.year)).toEqual([2026]);
      expect(result.map((e) => e.id)).toEqual(['a']);
    });

    // #370 — this backs /my-brackets, which participants refresh repeatedly during
    // tournament weekend; a cache hit must skip every Firestore call, not just the
    // tournaments-collection scan.
    test('a cache hit returns the cached value without touching Firestore', async () => {
      const cachedEntries = [{ id: 'a', year: 2026 }];
      cacheGet.mockReturnValue(cachedEntries);

      const result = await repo.getEntriesByEmail('u@g.com', 2026);

      expect(result).toBe(cachedEntries);
      expect(queryGetMock).not.toHaveBeenCalled();
      expect(collectionMock).not.toHaveBeenCalledWith('tournaments');
    });

    test('caches the result per (email, year) for 300s on a miss', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [makeDoc('a', { id: 'a', email: 'u@g.com' })],
      });

      const result = await repo.getEntriesByEmail('U@G.com', 2026);

      expect(cacheGet).toHaveBeenCalledWith('entriesByEmail_u@g.com_2026');
      expect(cacheSet).toHaveBeenCalledWith(
        'entriesByEmail_u@g.com_2026',
        result,
        300,
      );
    });

    test("caches the all-years query under a distinct '_all' key from a year-scoped one", async () => {
      queryGetMock
        .mockResolvedValueOnce({ docs: [makeDoc('2026', {})] }) // tournaments.get()
        .mockResolvedValueOnce({ docs: [] });

      await repo.getEntriesByEmail('u@g.com');

      expect(cacheGet).toHaveBeenCalledWith('entriesByEmail_u@g.com_all');
      expect(cacheSet).toHaveBeenCalledWith(
        'entriesByEmail_u@g.com_all',
        [],
        300,
      );
    });
  });

  describe('getAllYearsForGroup', () => {
    test('reads tournaments once, then a single Filter.or query per year, returns matched years newest-first', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          docs: [makeDoc('2024', {}), makeDoc('2025', {}), makeDoc('2026', {})],
        }) // tournaments.get()
        .mockResolvedValueOnce({ empty: false }) // 2024 entries — match
        .mockResolvedValueOnce({ empty: true }) // 2025 entries — no match
        .mockResolvedValueOnce({ empty: false }); // 2026 entries — match

      const result = await repo.getAllYearsForGroup('G');

      // Reads the small top-level tournaments collection first.
      expect(collectionMock).toHaveBeenCalledWith('tournaments');

      // One get() for tournaments + exactly one get() per year (3) = 4 total.
      // The pre-optimization code ran two queries per year (1 + 2*3 = 7); this
      // asserts the N→N/2 read reduction holds.
      expect(queryGetMock).toHaveBeenCalledTimes(4);

      // Each year issues a single disjunctive Filter.or(...) query — one `where`
      // call taking one composite filter arg — not the old pair of single-field
      // .where('groups', 'array-contains', …) / .where('group', '==', …) queries.
      expect(whereMock).toHaveBeenCalledTimes(3);
      for (const call of whereMock.mock.calls) {
        expect(call).toHaveLength(1);
      }
      expect(whereMock).not.toHaveBeenCalledWith(
        'groups',
        'array-contains',
        'G',
      );
      expect(whereMock).not.toHaveBeenCalledWith('group', '==', 'G');
      expect(limitMock).toHaveBeenCalledWith(1);

      // Only matched years, sorted newest-first, shaped as { year }.
      expect(result).toEqual([{ year: 2026 }, { year: 2024 }]);

      // Cached for a year under the group-scoped key.
      expect(cacheSet).toHaveBeenCalledWith('yearsForGroup_G', result, 3600);
    });

    test('returns cached value without querying Firestore', async () => {
      cacheGet.mockReturnValue([{ year: 2026 }]);
      const result = await repo.getAllYearsForGroup('G');
      expect(result).toEqual([{ year: 2026 }]);
      expect(queryGetMock).not.toHaveBeenCalled();
    });

    test('returns [] when no year has an entry in the group', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          docs: [makeDoc('2025', {}), makeDoc('2026', {})],
        })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true });

      const result = await repo.getAllYearsForGroup('Ghost');
      expect(result).toEqual([]);
    });

    // #634 — same leftover-parent-doc failure as getEntriesByEmail above; this
    // is the group year list rather than /my-brackets.
    describe('unusable stored year ids (#634)', () => {
      const ORIGINAL_ENV = { ...process.env };
      afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
        process.env.LIVE_E2E = ORIGINAL_ENV.LIVE_E2E;
      });

      test('production skips them instead of failing the whole read', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.LIVE_E2E;

        queryGetMock
          .mockResolvedValueOnce({
            docs: ['2024', '2025', '9999', '0'].map((y) => makeDoc(y, {})),
          })
          .mockResolvedValueOnce({ empty: false })
          .mockResolvedValueOnce({ empty: false });

        const result = await repo.getAllYearsForGroup('G');

        expect(queryGetMock).toHaveBeenCalledTimes(3);
        expect(result).toEqual([{ year: 2025 }, { year: 2024 }]);
      });

      // Pins the context-awareness the live suite depends on: e2e-v4 seeds
      // 9988/9989 and asserts getAllYearsForGroup returns them, so a filter
      // that unconditionally dropped the reserved block would land green in CI
      // and only break on the next live run.
      test('a live-E2E run still enumerates the reserved years', async () => {
        process.env.LIVE_E2E = 'true';

        queryGetMock
          .mockResolvedValueOnce({
            docs: ['9988', '9989'].map((y) => makeDoc(y, {})),
          })
          .mockResolvedValueOnce({ empty: false })
          .mockResolvedValueOnce({ empty: false });

        const result = await repo.getAllYearsForGroup('G');

        expect(result).toEqual([{ year: 9989 }, { year: 9988 }]);
      });
    });
  });

  // #340 — the read path the admin game-management flow (and pointsService.
  // getTournamentData) is built on. Distinct from the tested siblings: a 3-way
  // parallel read, a schoolMap fallback join for games missing denormalized
  // name/seed fields, exclusion of games with an unfilled team slot, and a
  // winner-null-first sort.
  describe('getActiveGames', () => {
    // Promise.all reads in this order: games, regions, schoolRecords.
    const mockReads = ({ games = [], regions = [], records = [] }) => {
      queryGetMock
        .mockResolvedValueOnce({
          docs: games.map((g, i) => makeDoc(`g${i}`, g)),
        })
        .mockResolvedValueOnce({
          docs: regions.map((r, i) => makeDoc(`r${i}`, r)),
        })
        .mockResolvedValueOnce({
          docs: records.map((s, i) => makeDoc(`s${i}`, s)),
        });
    };

    test('falls back to schoolRecords for missing team name/seed but never overwrites denormalized values', async () => {
      mockReads({
        games: [
          // Legacy game — no denormalized team fields at all.
          { gameID: 1, team1ID: 5, team2ID: 6, winner: null, regionID: 1 },
          // Modern game — carries its own names; ?? must not overwrite them.
          {
            gameID: 2,
            team1ID: 7,
            team2ID: 8,
            winner: null,
            regionID: 1,
            team1Name: 'Duke',
            team1Seed: 1,
            team2Name: 'UNC',
            team2Seed: 2,
          },
        ],
        regions: [{ regionID: 1, regionName: 'East' }],
        records: [
          { sID: 5, nameNick: 'FDU', seed: 16 },
          { sID: 6, nameNick: 'TxSo', seed: 16 },
        ],
      });

      const games = await repo.getActiveGames(2024);

      expect(games.find((g) => g.gameID === 1)).toMatchObject({
        team1Name: 'FDU',
        team1Seed: 16,
        team2Name: 'TxSo',
        team2Seed: 16,
      });
      expect(games.find((g) => g.gameID === 2)).toMatchObject({
        team1Name: 'Duke',
        team1Seed: 1,
        team2Name: 'UNC',
        team2Seed: 2,
      });
    });

    test('attaches team logo URLs from schoolRecords, null when a school has none', async () => {
      mockReads({
        games: [
          { gameID: 1, team1ID: 5, team2ID: 6, winner: null, regionID: 1 },
        ],
        records: [
          { sID: 5, nameNick: 'FDU', seed: 16, logoUrl: 'https://x/fdu.png' },
          { sID: 6, nameNick: 'TxSo', seed: 16 },
        ],
      });

      const [game] = await repo.getActiveGames(2024);

      expect(game.team1LogoUrl).toBe('https://x/fdu.png');
      expect(game.team2LogoUrl).toBeNull();
    });

    test('excludes games with a null team slot (FF-fed R1 games before their slot fills)', async () => {
      mockReads({
        games: [
          { gameID: 1, team1ID: null, team2ID: 9, winner: null, regionID: 1 },
          { gameID: 2, team1ID: 9, team2ID: null, winner: null, regionID: 1 },
          { gameID: 3, team1ID: 9, team2ID: 10, winner: null, regionID: 1 },
        ],
      });

      const games = await repo.getActiveGames(2024);
      expect(games.map((g) => g.gameID)).toEqual([3]);
    });

    test('sorts unresolved games first, then by gameID', async () => {
      mockReads({
        games: [
          { gameID: 2, team1ID: 7, team2ID: 8, winner: 7, regionID: 1 },
          { gameID: 3, team1ID: 5, team2ID: 6, winner: null, regionID: 1 },
          { gameID: 1, team1ID: 9, team2ID: 10, winner: null, regionID: 1 },
        ],
      });

      const games = await repo.getActiveGames(2024);
      expect(games.map((g) => g.gameID)).toEqual([1, 3, 2]);
    });

    test('merges region data onto matching games and caches the result for 300s', async () => {
      mockReads({
        games: [
          { gameID: 1, team1ID: 5, team2ID: 6, winner: null, regionID: 1 },
        ],
        regions: [{ regionID: 1, regionName: 'East' }],
      });

      const games = await repo.getActiveGames(2024);

      expect(games[0]).toMatchObject({
        gameID: 1,
        regionName: 'East',
        year: 2024,
      });
      expect(cacheSet).toHaveBeenCalledWith('activeGames_2024', games, 300);
    });

    test('returns the cached value without any Firestore reads on a cache hit', async () => {
      cacheGet.mockReturnValue([{ gameID: 1, year: 2024 }]);

      const games = await repo.getActiveGames(2024);

      expect(cacheGet).toHaveBeenCalledWith('activeGames_2024');
      expect(games).toEqual([{ gameID: 1, year: 2024 }]);
      expect(queryGetMock).not.toHaveBeenCalled();
    });
  });

  test('updateWinner writes winner, releases any manual hold, and busts all dependent caches', async () => {
    await repo.updateWinner('23', 101, 2024);

    expect(updateMock).toHaveBeenCalledWith({ winner: 101, manualHold: false });
    expect(docMock).toHaveBeenCalledWith('23');
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
  });

  test('clearWinnerWithHold clears winner and sets the hold in one update, busting caches', async () => {
    await repo.clearWinnerWithHold('23', 2024);

    expect(updateMock).toHaveBeenCalledWith({ winner: null, manualHold: true });
    expect(docMock).toHaveBeenCalledWith('23');
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
  });

  test('setGameManualHold coerces the flag and busts caches', async () => {
    await repo.setGameManualHold('23', 0, 2024);
    expect(updateMock).toHaveBeenCalledWith({ manualHold: false });
    expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
  });

  test('updateNextGameTeam denormalizes team name+seed from schoolRecords for slot 1 inside a transaction', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec', { sID: 101, nameNick: 'Blue Devils', seed: 2 })],
    });

    await repo.updateNextGameTeam('33', 1, 101, 2024);

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledWith('sID', '==', 101);
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: 101,
      team1Name: 'Blue Devils',
      team1Seed: 2,
    });
  });

  test('updateNextGameTeam writes to slot 2 with team2* keys', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec', { sID: 7, nameNick: 'Cats', seed: 5 })],
    });
    await repo.updateNextGameTeam('33', 2, 7, 2024);
    expect(updateMock).toHaveBeenCalledWith({
      team2ID: 7,
      team2Name: 'Cats',
      team2Seed: 5,
    });
  });

  test('updateNextGameTeam with no winner (undo) writes nulls and skips schoolRecord read', async () => {
    await repo.updateNextGameTeam('33', 1, null, 2024);

    expect(queryGetMock).not.toHaveBeenCalled(); // no schoolRecord lookup when winner is falsy
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: null,
      team1Name: null,
      team1Seed: null,
    });
  });

  test('updateNextGameTeam falls back to schoolName when nameNick is missing', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec', { sID: 101, schoolName: 'Duke', seed: 2 })],
    });
    await repo.updateNextGameTeam('33', 1, 101, 2024);
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: 101,
      team1Name: 'Duke',
      team1Seed: 2,
    });
  });

  test('getActiveAndFutureGames queries winner==null and returns sorted with year stamped', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('g2', { gameID: 6, winner: null }),
        makeDoc('g1', { gameID: 5, winner: null }),
      ],
    });

    const games = await repo.getActiveAndFutureGames(2024);

    expect(whereMock).toHaveBeenCalledWith('winner', '==', null);
    expect(games).toEqual([
      { gameID: 5, winner: null, year: 2024 },
      { gameID: 6, winner: null, year: 2024 },
    ]);
    expect(cacheSet).toHaveBeenCalledWith('activeFutureGames_2024', games, 300);
  });

  test('getActiveAndFutureGames returns cached value without DB hit', async () => {
    cacheGet.mockReturnValue([{ gameID: 1, year: 2024 }]);
    const res = await repo.getActiveAndFutureGames(2024);
    expect(res).toEqual([{ gameID: 1, year: 2024 }]);
    expect(queryGetMock).not.toHaveBeenCalled();
  });

  test('deleteGamesByYear batches one delete per game, commits, and busts game-related caches', async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc('g1', {}), makeDoc('g2', {}), makeDoc('g3', {})],
    });
    await repo.deleteGamesByYear(2024);
    expect(batchDeleteMock).toHaveBeenCalledTimes(3);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    // #432: matches TourneyRepository.deleteGamesByYear's cache busts, so a
    // deleted year can't keep serving stale cached games.
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
  });

  test('deleteSchoolRecordsByYear batches one delete per record, commits, and busts tournament/team-name caches', async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc('s1', {}), makeDoc('s2', {})],
    });
    await repo.deleteSchoolRecordsByYear(2024);
    expect(batchDeleteMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
  });

  test("getEntriesContainingTeams uses array-contains-any with numeric SIDs and drops EXCLUDED 'Bad' group-only entries and soft-deleted entries", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          teamName: 'Keep',
          picks: [101],
          totalPoints: 5,
          person: 'A',
          groups: ['Good'],
        }),
        makeDoc('2', {
          id: 2,
          teamName: 'Skip',
          picks: [101],
          totalPoints: 0,
          person: 'B',
          groups: ['Bad'],
        }),
        makeDoc('3', {
          id: 3,
          teamName: 'Keep2',
          picks: [101],
          totalPoints: 1,
          person: 'C',
          group: 'Legacy',
        }), // legacy single-group string
        makeDoc('4', {
          id: 4,
          teamName: 'Ghost',
          picks: [101],
          totalPoints: 0,
          person: 'D',
          groups: ['Good'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const entries = await repo.getEntriesContainingTeams(2024, ['101']);

    expect(whereMock).toHaveBeenCalledWith(
      'picks',
      'array-contains-any',
      [101],
    ); // coerced to Number
    expect(entries.map((e) => e.id)).toEqual([1, 3]);
    // Legacy single-group string is normalized into groups[]
    expect(entries.find((e) => e.id === 3).groups).toEqual(['Legacy']);
  });

  test('getEntriesContainingTeams({ includeDeleted: true }) keeps soft-deleted entries but still drops excluded-only-group entries (#388)', async () => {
    // The pick-swap normalization path (updateEntrywithNewSchools) is a
    // data-integrity write: it must reach a soft-deleted entry's picks, or a
    // delete → FF-resolve → restore sequence strands the entry on the
    // eliminated FF loser forever. Deliberately scoped to soft-deletes only —
    // updatePointsForAffectedEntries has no equivalent option and always
    // excludes excluded-only-group entries, so lifting that filter here too
    // would normalize picks without ever recomputing points for them.
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          id: 1,
          teamName: 'Keep',
          picks: [101],
          totalPoints: 5,
          person: 'A',
          groups: ['Good'],
        }),
        makeDoc('2', {
          id: 2,
          teamName: 'Skip',
          picks: [101],
          totalPoints: 0,
          person: 'B',
          groups: ['Bad'],
        }),
        makeDoc('4', {
          id: 4,
          teamName: 'Ghost',
          picks: [101],
          totalPoints: 0,
          person: 'D',
          groups: ['Good'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });

    const entries = await repo.getEntriesContainingTeams(2024, ['101'], {
      includeDeleted: true,
    });

    expect(entries.map((e) => e.id)).toEqual([1, 4]);
  });

  test('getEntriesContainingTeams empty input short-circuits with zero queries', async () => {
    const entries = await repo.getEntriesContainingTeams(2024, []);
    expect(entries).toEqual([]);
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(whereMock).not.toHaveBeenCalled();
  });

  test('getEntriesContainingTeams chunks sID lists >30 into batches of 30 and dedupes by entry id', async () => {
    // 65 sIDs → 3 chunks: 30 + 30 + 5
    const sIDs = Array.from({ length: 65 }, (_, i) => 1000 + i);

    // Same entry id "shared" returned in all three chunks must collapse to one
    // result. Each chunk also returns a chunk-unique entry to verify merge.
    const shared = makeDoc('shared', {
      id: 7777,
      teamName: 'Shared',
      picks: [1000],
      totalPoints: 0,
      person: 'S',
      groups: ['Good'],
    });
    queryGetMock
      .mockResolvedValueOnce({
        docs: [
          shared,
          makeDoc('a', {
            id: 1,
            teamName: 'A',
            picks: [1000],
            totalPoints: 0,
            person: 'Pa',
            groups: ['Good'],
          }),
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          shared,
          makeDoc('b', {
            id: 2,
            teamName: 'B',
            picks: [1030],
            totalPoints: 0,
            person: 'Pb',
            groups: ['Good'],
          }),
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          shared,
          makeDoc('c', {
            id: 3,
            teamName: 'C',
            picks: [1060],
            totalPoints: 0,
            person: 'Pc',
            groups: ['Good'],
          }),
        ],
      });

    const entries = await repo.getEntriesContainingTeams(2024, sIDs);

    // One Firestore query per chunk
    expect(queryGetMock).toHaveBeenCalledTimes(3);

    // Each chunk used array-contains-any with ≤30 disjuncts
    const arrayContainsAnyCalls = whereMock.mock.calls.filter(
      (c) => c[0] === 'picks' && c[1] === 'array-contains-any',
    );
    expect(arrayContainsAnyCalls).toHaveLength(3);
    expect(arrayContainsAnyCalls[0][2]).toHaveLength(30);
    expect(arrayContainsAnyCalls[1][2]).toHaveLength(30);
    expect(arrayContainsAnyCalls[2][2]).toHaveLength(5);

    // Shared entry collapses to a single result; chunk-unique entries all kept
    expect(entries.map((e) => e.id).sort()).toEqual([1, 2, 3, 7777]);
  });

  test('getEntriesContainingTeams dedupes duplicate sIDs in the input before chunking', async () => {
    queryGetMock.mockResolvedValue({ docs: [] });
    // 60 entries but only 5 distinct → 1 chunk of 5
    const sIDs = Array.from({ length: 60 }, () => 101);
    sIDs[10] = 102;
    sIDs[20] = 103;
    sIDs[30] = 104;
    sIDs[40] = 105;
    await repo.getEntriesContainingTeams(2024, sIDs);
    expect(queryGetMock).toHaveBeenCalledTimes(1);
    const arrayContainsAnyCalls = whereMock.mock.calls.filter(
      (c) => c[1] === 'array-contains-any',
    );
    expect(arrayContainsAnyCalls[0][2].sort()).toEqual([
      101, 102, 103, 104, 105,
    ]);
  });

  test('getEntriesForGroup sorts by entry id ascending and excludes soft-deleted entries', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('b', {
          id: 2,
          teamName: 'Alex',
          picks: [],
          totalPoints: 0,
          person: 'Alex',
          groups: ['G'],
        }),
        makeDoc('a', {
          id: 1,
          teamName: 'Alice',
          picks: [],
          totalPoints: 0,
          person: 'Alice',
          groups: ['G'],
        }),
        makeDoc('d', {
          id: 4,
          teamName: 'Ghost',
          picks: [],
          totalPoints: 0,
          person: 'Ghost',
          groups: ['G'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });
    const res = await repo.getEntriesForGroup(2024, 'G');
    expect(whereMock).toHaveBeenCalledWith('groups', 'array-contains', 'G');
    expect(res.map((e) => e.id)).toEqual([1, 2]);
    expect(cacheSet).toHaveBeenCalledWith('entriesForGroup_G_2024', res, 300);
  });

  test("getAllEntries filters EXCLUDED 'Bad'-only entries and soft-deleted entries, sorts by id, returns slim shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('c', {
          id: 3,
          teamName: 'Drop',
          picks: [],
          totalPoints: 0,
          person: 'C',
          groups: ['Bad'],
        }),
        makeDoc('a', {
          id: 1,
          teamName: 'T1',
          picks: [],
          totalPoints: 0,
          person: 'A',
          groups: ['G'],
        }),
        makeDoc('b', {
          id: 2,
          teamName: 'T2',
          picks: [],
          totalPoints: 0,
          person: 'B',
          groups: ['G', 'Bad'],
        }),
        makeDoc('e', {
          id: 5,
          teamName: 'Ghost',
          picks: [],
          totalPoints: 0,
          person: 'E',
          groups: ['G'],
          deletedAt: '2024-03-01T00:00:00.000Z',
        }),
      ],
    });
    const entries = await repo.getAllEntries(2024);

    // EXCLUDED only filters when "Bad" is the ONLY group → id=3 dropped; id=2 has both Good + Bad so kept
    // id=5 is soft-deleted → dropped regardless of group
    expect(entries.map((e) => e.id)).toEqual([1, 2]);
    expect(cacheSet).toHaveBeenCalledWith('allEntries_2024', entries, 300);
  });

  test('getTournamentTeams sorts by seed asc, then regionName asc', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('s1', {
          sID: 101,
          seed: 2,
          regionName: 'South',
          schoolName: 'Duke',
          nameNick: 'Blue Devils',
          mascot: 'BD',
          points: 0,
          gameStatus: [],
        }),
        makeDoc('s2', {
          sID: 102,
          seed: 1,
          regionName: 'Midwest',
          schoolName: 'Kansas',
          nameNick: 'Jayhawks',
          mascot: 'JH',
          points: 0,
          gameStatus: [],
        }),
        makeDoc('s3', {
          sID: 103,
          seed: 1,
          regionName: 'East',
          schoolName: 'Yale',
          nameNick: 'Bulldogs',
          mascot: 'BD2',
          points: 0,
          gameStatus: [],
        }),
      ],
    });
    const teams = await repo.getTournamentTeams(2024);
    expect(teams.map((t) => t.sID)).toEqual([103, 102, 101]); // seed=1 East, seed=1 Midwest, seed=2 South
    expect(cacheSet).toHaveBeenCalledWith('allTeamNames_2024', teams, 300);
  });

  test('getAllTournamentDetails reads games+records+regions in parallel, builds maps, caches 300s', async () => {
    queryGetMock
      .mockResolvedValueOnce({
        // games
        docs: [
          makeDoc('g1', {
            gameID: 1,
            team1ID: 1,
            team2ID: 2,
            regionID: 1,
            winner: null,
          }),
        ],
      })
      .mockResolvedValueOnce({
        // schoolRecords
        docs: [
          makeDoc('r1', {
            sID: 1,
            seed: 5,
            schoolName: 'Duke',
            nameNick: 'BD',
            mascot: 'M',
            regionName: 'E',
            gameStatus: [],
            canonicalDocId: null,
          }),
        ],
      })
      .mockResolvedValueOnce({
        // regions
        docs: [makeDoc('rg1', { regionID: 1, regionName: 'East' })],
      });

    const details = await repo.getAllTournamentDetails(2024);

    expect(details.allGames).toEqual([
      {
        gameID: 1,
        team1ID: 1,
        team2ID: 2,
        regionID: 1,
        winner: null,
        year: 2024,
      },
    ]);
    expect(details.activeGames[0]).toMatchObject({
      gameID: 1,
      regionName: 'East',
    });
    expect(details.teams[0]).toMatchObject({
      sID: 1,
      name: 'Duke',
      regionName: 'E',
      isFFDoc: false,
    });
    expect(details.regions).toEqual([{ regionID: 1, regionName: 'East' }]);
    expect(cacheSet).toHaveBeenCalledWith(
      'tournamentDetails_2024',
      details,
      300,
    );
  });

  test('getAllTournamentDetails marks FF schoolRecords (with canonicalDocId set) as isFFDoc', async () => {
    queryGetMock
      .mockResolvedValueOnce({ docs: [] }) // games
      .mockResolvedValueOnce({
        // schoolRecords
        docs: [
          makeDoc('ff_x', { sID: 9999, seed: 16, canonicalDocId: '1_16' }),
        ],
      })
      .mockResolvedValueOnce({ docs: [] }); // regions

    const details = await repo.getAllTournamentDetails(2024);
    expect(details.teams[0].isFFDoc).toBe(true);
  });

  test('getAllTournamentDetails filters regions to only bracket quadrants (1-4), excluding pseudo-regions (5, 6)', async () => {
    queryGetMock
      .mockResolvedValueOnce({ docs: [] }) // games
      .mockResolvedValueOnce({ docs: [] }) // schoolRecords
      .mockResolvedValueOnce({
        // regions — includes all 6
        docs: [
          makeDoc('rg1', { regionID: 1, regionName: 'East' }),
          makeDoc('rg2', { regionID: 2, regionName: 'West' }),
          makeDoc('rg3', { regionID: 3, regionName: 'South' }),
          makeDoc('rg4', { regionID: 4, regionName: 'Midwest' }),
          makeDoc('rg5', { regionID: 5, regionName: 'Final Four' }),
          makeDoc('rg6', { regionID: 6, regionName: 'Championship' }),
        ],
      });

    const details = await repo.getAllTournamentDetails(2024);
    // Only regions 1-4 should be returned, 5-6 filtered out
    expect(details.regions).toEqual([
      { regionID: 1, regionName: 'East' },
      { regionID: 2, regionName: 'West' },
      { regionID: 3, regionName: 'South' },
      { regionID: 4, regionName: 'Midwest' },
    ]);
  });

  test('getAllTournamentDetails filters out all out-of-range regionIDs (below 1 and above 4)', async () => {
    queryGetMock
      .mockResolvedValueOnce({ docs: [] }) // games
      .mockResolvedValueOnce({ docs: [] }) // schoolRecords
      .mockResolvedValueOnce({
        // regions — includes invalid IDs
        docs: [
          makeDoc('rg0', { regionID: 0, regionName: 'Invalid Zero' }),
          makeDoc('rg-1', { regionID: -1, regionName: 'Negative' }),
          makeDoc('rg1', { regionID: 1, regionName: 'East' }),
          makeDoc('rg4', { regionID: 4, regionName: 'Midwest' }),
          makeDoc('rg7', { regionID: 7, regionName: 'Invalid High' }),
        ],
      });

    const details = await repo.getAllTournamentDetails(2024);
    // Only regions in 1-4 range should survive, all others filtered
    expect(details.regions).toEqual([
      { regionID: 1, regionName: 'East' },
      { regionID: 4, regionName: 'Midwest' },
    ]);
  });

  test('getEntryById returns enriched entry when found, null when missing', async () => {
    docGetMock
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ id: 1, person: 'Alex' }),
      })
      .mockResolvedValueOnce({ exists: false });

    expect(await repo.getEntryById(1, 2024)).toEqual({
      id: 1,
      person: 'Alex',
      year: 2024,
    });
    expect(await repo.getEntryById(99, 2024)).toBeNull();
  });

  test('updateEntry writes full payload + edited_at timestamp, normalizes groups, includes optional fields', async () => {
    await repo.updateEntry({
      year: 2024,
      id: 1,
      email: 'x@y',
      teamName: 'T',
      picks: [10],
      person: 'P',
      possPoints: 50,
      groups: 'G', // string → array
      hasPaid: true,
      paymentNote: 'ok',
      payByCheck: true,
      emailSent: true,
    });

    const payload = updateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      email: 'x@y',
      teamName: 'T',
      picks: [10],
      person: 'P',
      possPoints: 50,
      groups: ['G'],
      hasPaid: true,
      paymentNote: 'ok',
      payByCheck: true,
      emailSent: true,
    });
    expect(payload.edited_at).toBeInstanceOf(Date);
    expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    // updateEntry can change `email` itself, so a per-email bust isn't safe here —
    // the whole entriesByEmail_ cache is cleared instead (#370).
    expect(invalidateCache).toHaveBeenCalledWith('entriesByEmail_');
    // An admin can edit an entry while it sits soft-deleted, and the Recently
    // Deleted list renders person/teamName/email/groups — all written here (#478).
    expect(cacheDel).toHaveBeenCalledWith('deletedEntries_2024');
  });

  test('updateEntry omits hasPaid/emailSent when not provided (no accidental clobbering)', async () => {
    await repo.updateEntry({
      year: 2024,
      id: 1,
      email: 'x@y',
      teamName: 'T',
      picks: [],
      person: 'P',
      groups: ['G'],
    });
    const payload = updateMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('hasPaid');
    expect(payload).not.toHaveProperty('emailSent');
  });
});

// ─── TourneyRepository ────────────────────────────────────────────────────
describe('TourneyRepository', () => {
  const repo = new TourneyRepository();

  test('getAllRegions queries year/regions ordered by __name__ and caches 24h', async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc('1', { regionID: 1, regionName: 'East' })],
    });

    const regions = await repo.getAllRegions(2024);

    expect(collectionMock).toHaveBeenCalledWith('regions');
    expect(orderByMock).toHaveBeenCalledWith('__name__', 'asc');
    expect(regions).toEqual([{ regionID: 1, regionName: 'East' }]);
    expect(cacheSet).toHaveBeenCalledWith('allRegions_2024', regions, 86400);
  });

  test('getAllRegionTypes reads top-level regionID collection orderBy regionID asc', async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc('1', { regionID: 1, regionName: 'East' })],
    });
    await repo.getAllRegionTypes();
    expect(collectionMock).toHaveBeenCalledWith('regionID');
    expect(orderByMock).toHaveBeenCalledWith('regionID', 'asc');
  });

  test('insertRegionsForYear writes one batch.set per matched master region keyed 1..N', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('a', { regionID: 1, regionName: 'East' }),
        makeDoc('b', { regionID: 2, regionName: 'West' }),
      ],
    });

    await repo.insertRegionsForYear(2024, [1, 2]);

    expect(batchSetMock).toHaveBeenCalledTimes(2);
    // Doc IDs should be "1" and "2" (1-based position)
    expect(docMock).toHaveBeenCalledWith('1');
    expect(docMock).toHaveBeenCalledWith('2');
    // Payload preserves master region data
    expect(batchSetMock.mock.calls[0][1]).toEqual({
      regionID: 1,
      regionName: 'East',
    });
    expect(batchSetMock.mock.calls[1][1]).toEqual({
      regionID: 2,
      regionName: 'West',
    });
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    // #377: must also bust the getAllRegions/_getCachedRegions 24h cache, not just tournamentDetails.
    expect(cacheDel).toHaveBeenCalledWith('allRegions_2024');
  });

  describe('getYearOccupancy', () => {
    test('reports unoccupied when the parent doc and every subcollection are empty', async () => {
      docGetMock.mockResolvedValueOnce({ exists: false }); // parent
      queryGetMock
        .mockResolvedValueOnce({ empty: true }) // games
        .mockResolvedValueOnce({ empty: true }) // regions
        .mockResolvedValueOnce({ empty: true }) // schoolRecords
        .mockResolvedValueOnce({ empty: true }); // entries

      const result = await repo.getYearOccupancy(2027);

      expect(result).toEqual({
        occupied: false,
        hasParent: false,
        hasGames: false,
        hasRegions: false,
        hasSchoolRecords: false,
        hasEntries: false,
      });
    });

    test('reports occupied when the parent doc exists', async () => {
      docGetMock.mockResolvedValueOnce({ exists: true });
      queryGetMock
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true });

      const result = await repo.getYearOccupancy(2027);

      expect(result.occupied).toBe(true);
      expect(result.hasParent).toBe(true);
    });

    test('reports occupied from an orphaned games subcollection even with no parent doc', async () => {
      docGetMock.mockResolvedValueOnce({ exists: false });
      queryGetMock
        .mockResolvedValueOnce({ empty: false }) // games — orphaned data
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true });

      const result = await repo.getYearOccupancy(2027);

      expect(result.occupied).toBe(true);
      expect(result.hasParent).toBe(false);
      expect(result.hasGames).toBe(true);
    });

    test('reports occupied from existing entries even with no other bracket data', async () => {
      docGetMock.mockResolvedValueOnce({ exists: false });
      queryGetMock
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: true })
        .mockResolvedValueOnce({ empty: false }); // entries

      const result = await repo.getYearOccupancy(2027);

      expect(result.occupied).toBe(true);
      expect(result.hasEntries).toBe(true);
    });
  });

  describe('createBracketAtomic', () => {
    function mockReferenceData() {
      cacheGet.mockImplementation(
        (k) =>
          ({
            allSchools: [
              { sid: 101, name: 'Alpha', nameNick: 'Alpha', espn: {} },
              { sid: 102, name: 'Beta', nameNick: 'Beta', espn: {} },
              { sid: 201, name: 'Gamma', nameNick: 'Gamma', espn: {} },
              { sid: 202, name: 'Delta', nameNick: 'Delta', espn: {} },
            ],
            allConferences: [],
            allRegionTypes: [
              { regionID: 1, regionName: 'East' },
              { regionID: 2, regionName: 'West' },
              { regionID: 3, regionName: 'South' },
              { regionID: 4, regionName: 'Midwest' },
              { regionID: 5, regionName: 'Final Four' },
              { regionID: 6, regionName: 'Championship' },
            ],
          })[k],
      );
    }

    test('writes every document with batch.create, never batch.set, in one commit', async () => {
      mockReferenceData();

      const result = await repo.createBracketAtomic({
        year: 2027,
        regionIDs: [1, 2, 5, 6],
        gamesWithoutTeams: [[9, 1, 2027, null, null, null, 2, 13, 1]],
        gamesWithTeams: [[1, 1, 2027, 101, 102, null, 1, 9, 1, 1, 16]],
        schoolRecords: [
          { sID: 101, year: 2027, seed: 1, regionID: 1 },
          { sID: 102, year: 2027, seed: 16, regionID: 1 },
        ],
      });

      // parent + 4 regions + 1 gameWithoutTeams + 1 gameWithTeams + 2 schoolRecords = 9
      expect(batchCreateMock).toHaveBeenCalledTimes(9);
      expect(batchSetMock).not.toHaveBeenCalled();
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ writeCount: 9 });

      // Parent doc payload
      expect(batchCreateMock.mock.calls[0][1]).toEqual({ year: 2027 });
    });

    test('includes First Four games/records in the same atomic batch', async () => {
      mockReferenceData();

      await repo.createBracketAtomic({
        year: 2027,
        regionIDs: [1, 2, 5, 6],
        gamesWithoutTeams: [],
        gamesWithTeams: [],
        schoolRecords: [],
        firstFourGames: [
          {
            gameID: 64,
            team1ID: 201,
            team2ID: 202,
            seed: 16,
            nextGameID: 1,
            nextGameSpot: 2,
          },
        ],
        firstFourSchoolRecords: [
          { sID: 201, seed: 16, gameID: 64, slot: 1, r1RegionID: 1 },
          { sID: 202, seed: 16, gameID: 64, slot: 2, r1RegionID: 1 },
        ],
        tournamentDocExtra: { hasFirstFour: true, firstFourGameCount: 1 },
      });

      // parent + 4 regions + 1 FF game + 2 FF school records = 8
      expect(batchCreateMock).toHaveBeenCalledTimes(8);
      expect(batchCreateMock.mock.calls[0][1]).toEqual({
        year: 2027,
        hasFirstFour: true,
        firstFourGameCount: 1,
      });
      expect(docMock).toHaveBeenCalledWith('ff_64_1');
      expect(docMock).toHaveBeenCalledWith('ff_64_2');
    });

    test('builds regionName from the in-memory regionIDs list, never by reading back the year regions subcollection', async () => {
      mockReferenceData();

      await repo.createBracketAtomic({
        year: 2027,
        regionIDs: [1, 2, 5, 6],
        gamesWithoutTeams: [],
        gamesWithTeams: [],
        schoolRecords: [{ sID: 101, year: 2027, seed: 1, regionID: 1 }],
      });

      // The one non-parent, non-region create is the school record; its
      // regionName must come from the regionIDs param, not a read-back —
      // queryGetMock/docGetMock are never called by this method at all.
      const schoolRecordCall = batchCreateMock.mock.calls.find(
        (call) => call[1]?.sID === 101,
      );
      expect(schoolRecordCall[1].regionName).toBe('East');
      expect(queryGetMock).not.toHaveBeenCalled();
      expect(docGetMock).not.toHaveBeenCalled();
    });

    test('invalidates every affected cache key only after a successful commit', async () => {
      mockReferenceData();

      await repo.createBracketAtomic({
        year: 2027,
        regionIDs: [1, 2, 5, 6],
        gamesWithoutTeams: [],
        gamesWithTeams: [],
        schoolRecords: [],
      });

      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2027');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2027');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2027');
      expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2027');
      expect(cacheDel).toHaveBeenCalledWith('allRegions_2027');
    });

    test('invalidates no cache and leaves the error to propagate when the commit fails', async () => {
      mockReferenceData();
      const boom = new Error('commit failed');
      batchCommitMock.mockRejectedValueOnce(boom);

      await expect(
        repo.createBracketAtomic({
          year: 2027,
          regionIDs: [1, 2, 5, 6],
          gamesWithoutTeams: [],
          gamesWithTeams: [],
          schoolRecords: [],
        }),
      ).rejects.toBe(boom);

      expect(cacheDel).not.toHaveBeenCalled();
    });

    test('refuses to build a batch over the 500-write Firestore cap', async () => {
      mockReferenceData();
      const tooManySchoolRecords = Array.from({ length: 500 }, (_, i) => ({
        sID: 101,
        year: 2027,
        seed: 1,
        regionID: 1,
        _i: i,
      }));

      await expect(
        repo.createBracketAtomic({
          year: 2027,
          regionIDs: [1, 2, 5, 6],
          gamesWithoutTeams: [],
          gamesWithTeams: [],
          schoolRecords: tooManySchoolRecords,
        }),
      ).rejects.toThrow(/500-operation batch limit/);
      expect(batchCommitMock).not.toHaveBeenCalled();
    });

    // Plan's own count: 63+N games, (64-N)+2N school records, 6 regions, 1
    // parent = 134+2N (142 at N=4, 150 at N=8). Build realistically-sized
    // input (63 total games, 64-N canonical school records) rather than
    // hand-typing every row.
    test.each([
      [4, 142],
      [8, 150],
    ])('writeCount is 134+2N for N=%i play-ins (%i)', async (n, expected) => {
      mockReferenceData();
      const gamesWithoutTeams = Array.from({ length: 31 }, (_, i) => [9 + i]);
      const gamesWithTeams = Array.from({ length: 32 }, (_, i) => [i + 1]);
      const schoolRecords = Array.from({ length: 64 - n }, (_, i) => ({
        sID: 101,
        year: 2027,
        seed: (i % 16) + 1,
        regionID: 1,
      }));
      const firstFourGames = Array.from({ length: n }, (_, i) => ({
        gameID: 64 + i,
        team1ID: 201,
        team2ID: 202,
        seed: 16,
        nextGameID: 1,
        nextGameSpot: 2,
      }));
      const firstFourSchoolRecords = Array.from({ length: n * 2 }, (_, i) => ({
        sID: 201,
        seed: 16,
        gameID: 64 + Math.floor(i / 2),
        slot: (i % 2) + 1,
        r1RegionID: 1,
      }));

      const result = await repo.createBracketAtomic({
        year: 2027,
        regionIDs: [1, 2, 3, 4, 5, 6], // the 4 bracket regions + Final Four + Championship
        gamesWithoutTeams,
        gamesWithTeams,
        schoolRecords,
        firstFourGames,
        firstFourSchoolRecords,
      });

      expect(result.writeCount).toBe(expected);
    });
  });

  test('getSchoolRecordsForYear sorts by seed then regionID and returns docId/canonicalDocId', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('5_2', { sID: 1, seed: 2, regionID: 5 }),
        makeDoc('8_1', { sID: 2, seed: 1, regionID: 8 }),
        makeDoc('3_1', { sID: 3, seed: 1, regionID: 3 }),
      ],
    });
    const records = await repo.getSchoolRecordsForYear(2024);
    expect(records).toEqual([
      {
        sID: 3,
        year: 2024,
        seed: 1,
        regionID: 3,
        docId: '3_1',
        canonicalDocId: null,
      },
      {
        sID: 2,
        year: 2024,
        seed: 1,
        regionID: 8,
        docId: '8_1',
        canonicalDocId: null,
      },
      {
        sID: 1,
        year: 2024,
        seed: 2,
        regionID: 5,
        docId: '5_2',
        canonicalDocId: null,
      },
    ]);
  });

  test('getSchoolRecordsForYear passes through canonicalDocId for a First Four record', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('ff_64_1', {
          sID: 100,
          seed: 16,
          regionID: 1,
          canonicalDocId: '1_16',
        }),
      ],
    });
    const records = await repo.getSchoolRecordsForYear(2024);
    expect(records[0]).toMatchObject({
      docId: 'ff_64_1',
      canonicalDocId: '1_16',
    });
  });

  test('deleteTournamentDoc deletes tournaments/{year}', async () => {
    await repo.deleteTournamentDoc(2024);
    expect(collectionMock).toHaveBeenCalledWith('tournaments');
    expect(docMock).toHaveBeenCalledWith('2024');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test('upsertTournamentDoc merges only the supplied options', async () => {
    await repo.upsertTournamentDoc(2024, { hasFirstFour: true });
    expect(setMock).toHaveBeenCalledWith(
      { year: 2024, hasFirstFour: true },
      { merge: true },
    );

    setMock.mockClear();
    await repo.upsertTournamentDoc(2024, { firstFourGameCount: 4 });
    expect(setMock).toHaveBeenCalledWith(
      { year: 2024, firstFourGameCount: 4 },
      { merge: true },
    );

    setMock.mockClear();
    await repo.upsertTournamentDoc(2024, {});
    expect(setMock).toHaveBeenCalledWith({ year: 2024 }, { merge: true });
  });

  test('insertFirstFourGames denormalizes school names from a single schools fetch', async () => {
    queryGetMock.mockResolvedValueOnce({
      docs: [
        makeDoc('s1', {
          sid: 101,
          name: 'Alpha University',
          nameNick: 'Alpha',
        }),
        makeDoc('s2', { sid: 102, name: 'Beta College', nameNick: null }),
      ],
    });

    await repo.insertFirstFourGames(
      [
        {
          gameID: 64,
          team1ID: 101,
          team2ID: 102,
          seed: 16,
          nextGameID: 5,
          nextGameSpot: 1,
        },
      ],
      2024,
    );

    expect(batchSetMock).toHaveBeenCalledTimes(1);
    expect(batchSetMock.mock.calls[0][1]).toEqual({
      gameID: 64,
      regionID: 7,
      round: 0,
      team1ID: 101,
      team1Name: 'Alpha',
      team1Seed: 16,
      team2ID: 102,
      team2Name: 'Beta College',
      team2Seed: 16, // falls back to name when nameNick null
      winner: null,
      nextGameID: 5,
      nextGameSpot: 1,
    });
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
  });

  test('insertFirstFourGames no-ops on empty input', async () => {
    await repo.insertFirstFourGames([], 2024);
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(batchMock).not.toHaveBeenCalled();
  });

  describe('deleteGamesByYear / deleteSchoolRecordsByYear / deleteRegionsByYear', () => {
    test('deleteGamesByYear batches one delete per game, commits once, and busts game-related caches', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [makeDoc('1', {}), makeDoc('2', {}), makeDoc('3', {})],
      });

      await repo.deleteGamesByYear(2024);

      expect(batchDeleteMock).toHaveBeenCalledTimes(3);
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      // #432: GameRepository.deleteGamesByYear busts the same caches (see the
      // GameRepository describe block above).
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    });

    test('deleteSchoolRecordsByYear batches one delete per record and busts allTeamNames_{year}', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [makeDoc('1_1', {}), makeDoc('1_2', {})],
      });

      await repo.deleteSchoolRecordsByYear(2024);

      expect(batchDeleteMock).toHaveBeenCalledTimes(2);
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      // #432: GameRepository.deleteSchoolRecordsByYear busts the same caches
      // (see the GameRepository describe block above).
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    });

    test('deleteRegionsByYear batches one delete per region and busts tournamentDetails_{year} and allRegions_{year}', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [
          makeDoc('1', {}),
          makeDoc('2', {}),
          makeDoc('3', {}),
          makeDoc('4', {}),
        ],
      });

      await repo.deleteRegionsByYear(2024);

      expect(batchDeleteMock).toHaveBeenCalledTimes(4);
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      // #377: must also bust the getAllRegions/_getCachedRegions 24h cache.
      expect(cacheDel).toHaveBeenCalledWith('allRegions_2024');
    });
  });

  describe('insertFirstFourSchoolRecords / deleteFirstFourGames (rollback pair)', () => {
    test('insertFirstFourSchoolRecords writes a ff_{gameID}_{slot} doc with canonicalDocId and denormalized fields', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          // schools
          docs: [
            makeDoc('s1', {
              sid: 301,
              name: 'Alpha University',
              nameNick: 'Alpha',
              mascot: 'Aces',
              confID: 'acc',
              espn: {
                espnID: 999,
                logoURL: 'http://logo',
                primaryColor: '#fff',
              },
            }),
          ],
        })
        .mockResolvedValueOnce({
          docs: [makeDoc('1', { regionID: 1, regionName: 'East' })],
        }) // regions
        .mockResolvedValueOnce({
          docs: [makeDoc('acc', { name: 'Atlantic Coast', shortName: 'ACC' })],
        }); // conferences

      await repo.insertFirstFourSchoolRecords(
        [{ sID: 301, seed: 16, r1RegionID: 1, gameID: 64, slot: 1 }],
        2024,
      );

      expect(batchSetMock).toHaveBeenCalledTimes(1);
      expect(docMock).toHaveBeenCalledWith('ff_64_1');
      expect(batchSetMock.mock.calls[0][1]).toEqual({
        sID: 301,
        seed: 16,
        regionID: 1,
        canonicalDocId: '1_16',
        points: null,
        gameStatus: [],
        schoolName: 'Alpha University',
        nameNick: 'Alpha',
        mascot: 'Aces',
        regionName: 'East',
        espnID: 999,
        logoUrl: 'http://logo',
        primaryColor: '#fff',
        conferenceName: 'ACC',
      });
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    });

    test('insertFirstFourSchoolRecords no-ops on empty input', async () => {
      await repo.insertFirstFourSchoolRecords([], 2024);
      expect(queryGetMock).not.toHaveBeenCalled();
      expect(batchMock).not.toHaveBeenCalled();
    });

    test('deleteFirstFourGames deletes one game doc per entry, commits once, and busts game caches', async () => {
      await repo.deleteFirstFourGames([{ gameID: 64 }, { gameID: 65 }], 2024);

      expect(batchDeleteMock).toHaveBeenCalledTimes(2);
      expect(docMock).toHaveBeenCalledWith('64');
      expect(docMock).toHaveBeenCalledWith('65');
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    });

    test('deleteFirstFourGames no-ops on empty input', async () => {
      await repo.deleteFirstFourGames([], 2024);
      expect(batchMock).not.toHaveBeenCalled();
      expect(batchCommitMock).not.toHaveBeenCalled();
    });
  });

  describe('insertMultipleGamesWithoutTeams / insertMultipleGamesWithTeams', () => {
    test('insertMultipleGamesWithoutTeams writes a bare game doc plus the tournament parent-doc merge', async () => {
      await repo.insertMultipleGamesWithoutTeams([
        [1, 1, 2024, null, null, null, 1, 9, 1],
      ]);

      // Parent-doc merge write (tournaments/2024) + the game doc — 2 batch.set calls.
      expect(batchSetMock).toHaveBeenCalledTimes(2);
      expect(collectionMock).toHaveBeenCalledWith('tournaments');
      expect(docMock).toHaveBeenCalledWith('2024');
      expect(batchSetMock).toHaveBeenCalledWith(
        expect.anything(),
        { year: 2024 },
        { merge: true },
      );
      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 1,
        regionID: 1,
        round: 1,
        team1ID: null,
        team2ID: null,
        winner: null,
        nextGameID: 9,
        nextGameSpot: 1,
      });
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    });

    test('insertMultipleGamesWithoutTeams no-ops on empty input', async () => {
      await repo.insertMultipleGamesWithoutTeams([]);
      expect(batchMock).not.toHaveBeenCalled();
    });

    test('insertMultipleGamesWithoutTeams writes one game doc per entry for a multi-element batch', async () => {
      await repo.insertMultipleGamesWithoutTeams([
        [1, 1, 2024, null, null, null, 1, 9, 1],
        [2, 1, 2024, null, null, null, 1, 9, 2],
        [3, 2, 2024, null, null, null, 1, 10, 1],
      ]);

      // Parent-doc merge write (tournaments/2024) + one set per game — 4 batch.set calls.
      expect(batchSetMock).toHaveBeenCalledTimes(4);
      expect(batchSetMock).toHaveBeenCalledWith(
        expect.anything(),
        { year: 2024 },
        { merge: true },
      );
      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 1,
        regionID: 1,
        round: 1,
        team1ID: null,
        team2ID: null,
        winner: null,
        nextGameID: 9,
        nextGameSpot: 1,
      });
      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 2,
        regionID: 1,
        round: 1,
        team1ID: null,
        team2ID: null,
        winner: null,
        nextGameID: 9,
        nextGameSpot: 2,
      });
      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 3,
        regionID: 2,
        round: 1,
        team1ID: null,
        team2ID: null,
        winner: null,
        nextGameID: 10,
        nextGameSpot: 1,
      });
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
    });

    test('insertMultipleGamesWithTeams denormalizes team names/seeds from the schools map', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [
          makeDoc('s1', {
            sid: 101,
            name: 'Duke University',
            nameNick: 'Duke',
          }),
          makeDoc('s2', { sid: 102, name: 'Kansas Jayhawks', nameNick: null }),
        ],
      });

      await repo.insertMultipleGamesWithTeams([
        [5, 1, 2024, 101, 102, null, 1, 9, 1, 3, 14],
      ]);

      expect(batchSetMock).toHaveBeenCalledTimes(2); // tournaments/2024 parent-doc merge + the game doc
      expect(batchSetMock).toHaveBeenCalledWith(
        expect.anything(),
        { year: 2024 },
        { merge: true },
      );
      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 5,
        regionID: 1,
        team1ID: 101,
        team2ID: 102,
        round: 1,
        team1Name: 'Duke',
        team1Seed: 3,
        team2Name: 'Kansas Jayhawks',
        team2Seed: 14, // falls back to name when nameNick null
        winner: null,
        nextGameID: 9,
        nextGameSpot: 1,
      });
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    });

    test("insertMultipleGamesWithTeams leaves team name/seed null when the sID isn't in the schools map", async () => {
      queryGetMock.mockResolvedValueOnce({ docs: [] });

      await repo.insertMultipleGamesWithTeams([
        [5, 1, 2024, 101, null, null, 1, 9, 1, 3, null],
      ]);

      expect(batchSetMock).toHaveBeenCalledWith(expect.anything(), {
        gameID: 5,
        regionID: 1,
        team1ID: 101,
        team2ID: null,
        round: 1,
        team1Name: null,
        team1Seed: 3,
        team2Name: null,
        team2Seed: null,
        winner: null,
        nextGameID: 9,
        nextGameSpot: 1,
      });
    });

    test('insertMultipleGamesWithTeams no-ops on empty input', async () => {
      await repo.insertMultipleGamesWithTeams([]);
      expect(batchMock).not.toHaveBeenCalled();
      expect(queryGetMock).not.toHaveBeenCalled();
    });
  });

  describe('updateMultipleGamesWithTeams / updateMultipleSchoolRecords', () => {
    test('updateMultipleGamesWithTeams merge-writes only team identity fields, not winner/nextGameID', async () => {
      queryGetMock.mockResolvedValueOnce({
        docs: [
          makeDoc('s1', { sid: 201, name: 'Villanova', nameNick: 'Nova' }),
        ],
      });

      await repo.updateMultipleGamesWithTeams([
        [9, 1, 2024, 201, null, null, 2, 13, 1, 4, null],
      ]);

      expect(docMock).toHaveBeenCalledWith('9');
      const payload = batchSetMock.mock.calls[0][1];
      expect(payload).toEqual({
        team1ID: 201,
        team2ID: null,
        team1Name: 'Nova',
        team1Seed: 4,
        team2Name: null,
        team2Seed: null,
      });
      expect(payload).not.toHaveProperty('winner');
      expect(payload).not.toHaveProperty('nextGameID');
      expect(batchSetMock.mock.calls[0][2]).toEqual({ merge: true });
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
      expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    });

    test('updateMultipleGamesWithTeams no-ops on empty input', async () => {
      await repo.updateMultipleGamesWithTeams([]);
      expect(batchMock).not.toHaveBeenCalled();
    });

    test('updateMultipleSchoolRecords merge-writes identity doc at {regionID}_{seed} and never touches points/gameStatus', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          // schools
          docs: [
            makeDoc('s1', {
              sid: 201,
              name: 'Villanova University',
              nameNick: 'Nova',
              mascot: 'Wildcats',
              confID: 'big-east',
              espn: {
                espnID: 555,
                logoURL: 'http://logo2',
                primaryColor: '#000',
              },
            }),
          ],
        })
        .mockResolvedValueOnce({
          docs: [
            makeDoc('big-east', { name: 'Big East', shortName: 'Big East' }),
          ],
        }); // conferences

      await repo.updateMultipleSchoolRecords([
        { sID: 201, seed: 4, regionID: 1, year: 2024 },
      ]);

      expect(docMock).toHaveBeenCalledWith('1_4');
      const payload = batchSetMock.mock.calls[0][1];
      expect(payload).toEqual({
        sID: 201,
        schoolName: 'Villanova University',
        nameNick: 'Nova',
        mascot: 'Wildcats',
        espnID: 555,
        logoUrl: 'http://logo2',
        primaryColor: '#000',
        conferenceName: 'Big East',
      });
      expect(payload).not.toHaveProperty('points');
      expect(payload).not.toHaveProperty('gameStatus');
      expect(batchSetMock.mock.calls[0][2]).toEqual({ merge: true });
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    });

    test('updateMultipleSchoolRecords no-ops on empty/undefined input', async () => {
      await repo.updateMultipleSchoolRecords([]);
      expect(batchMock).not.toHaveBeenCalled();

      await repo.updateMultipleSchoolRecords(undefined);
      expect(batchMock).not.toHaveBeenCalled();
    });
  });

  describe('insertMultipleSchoolRecords', () => {
    test('writes a schoolRecords doc keyed {regionID}_{seed} with denormalized fields', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          // schools
          docs: [
            makeDoc('s1', {
              sid: 101,
              name: 'Duke University',
              nameNick: 'Duke',
              mascot: 'Blue Devils',
              confID: 'acc',
              espn: {
                espnID: 150,
                logoURL: 'http://logo3',
                primaryColor: '#001',
              },
            }),
          ],
        })
        .mockResolvedValueOnce({
          docs: [makeDoc('1', { regionID: 1, regionName: 'East' })],
        }) // regions
        .mockResolvedValueOnce({
          docs: [makeDoc('acc', { name: 'Atlantic Coast', shortName: 'ACC' })],
        }); // conferences

      await repo.insertMultipleSchoolRecords([
        { sID: 101, seed: 1, regionID: 1, year: 2024 },
      ]);

      expect(docMock).toHaveBeenCalledWith('1_1');
      expect(batchSetMock.mock.calls[0][1]).toEqual({
        sID: 101,
        seed: 1,
        regionID: 1,
        points: null,
        gameStatus: [],
        schoolName: 'Duke University',
        nameNick: 'Duke',
        mascot: 'Blue Devils',
        regionName: 'East',
        espnID: 150,
        logoUrl: 'http://logo3',
        primaryColor: '#001',
        conferenceName: 'ACC',
      });
      expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
      expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    });

    test('a second record sharing the same {regionID}_{seed} key overwrites the first (documents the collision)', async () => {
      queryGetMock
        .mockResolvedValueOnce({
          docs: [
            makeDoc('s1', {
              sid: 101,
              name: 'Team One',
              nameNick: 'One',
              confID: 'acc',
            }),
            makeDoc('s2', {
              sid: 102,
              name: 'Team Two',
              nameNick: 'Two',
              confID: 'acc',
            }),
          ],
        })
        .mockResolvedValueOnce({ docs: [] }) // regions
        .mockResolvedValueOnce({ docs: [] }); // conferences

      await repo.insertMultipleSchoolRecords([
        { sID: 101, seed: 1, regionID: 1, year: 2024 },
        { sID: 102, seed: 1, regionID: 1, year: 2024 },
      ]);

      expect(batchSetMock).toHaveBeenCalledTimes(2);
      // Both writes target the same doc id — the second silently clobbers the first.
      // Note: the fake batch mock only records calls, it doesn't simulate real
      // Firestore last-write-wins commit semantics, so this asserts call order/
      // targeting only — the actual overwrite outcome isn't (and can't be)
      // verified by a mock-based unit test. Firestore's per-batch last-write-wins
      // behavior for repeated .set() on the same ref is well-established.
      expect(docMock).toHaveBeenCalledWith('1_1');
      expect(docMock.mock.calls.filter((c) => c[0] === '1_1')).toHaveLength(2);
      expect(batchSetMock.mock.calls[0][1].sID).toBe(101);
      expect(batchSetMock.mock.calls[1][1].sID).toBe(102);
    });

    test('a record whose sID has no match in the schools map writes null identity fields, never throws', async () => {
      queryGetMock
        .mockResolvedValueOnce({ docs: [] }) // schools — empty, no match for sID 999
        .mockResolvedValueOnce({ docs: [] }) // regions
        .mockResolvedValueOnce({ docs: [] }); // conferences

      await expect(
        repo.insertMultipleSchoolRecords([
          { sID: 999, seed: 1, regionID: 1, year: 2024 },
        ]),
      ).resolves.not.toThrow();

      expect(batchSetMock.mock.calls[0][1]).toMatchObject({
        schoolName: null,
        nameNick: null,
        mascot: null,
        conferenceName: null,
      });
    });

    test('no-ops on empty input', async () => {
      await repo.insertMultipleSchoolRecords([]);
      expect(queryGetMock).not.toHaveBeenCalled();
      expect(batchMock).not.toHaveBeenCalled();
    });
  });
});

// ─── TeamRepository ───────────────────────────────────────────────────────
describe('TeamRepository', () => {
  const repo = new TeamRepository();

  test('updateTeamRecordWithNulls finds record by sID and updates points=null+gameStatus=[] inside a transaction', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec', { sID: 101 })],
    });
    await repo.updateTeamRecordWithNulls(101, 2024);

    expect(whereMock).toHaveBeenCalledWith('sID', '==', 101);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ points: null, gameStatus: [] });
    expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
  });

  test('updateTeamRecordWithNulls no-ops + skips cache bust when no records match', async () => {
    queryGetMock.mockResolvedValue({ empty: true, docs: [] });
    await repo.updateTeamRecordWithNulls(999, 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cacheDel).not.toHaveBeenCalled();
  });

  test('updateTeamRecord writes provided points + gameStatus to all matched records inside a transaction', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec1', { sID: 101 }), makeDoc('rec2', { sID: 101 })], // canonical + ff_ pair
    });
    await repo.updateTeamRecord(101, 4, ['W', 'W'], 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(1, {
      points: 4,
      gameStatus: ['W', 'W'],
    });
  });

  test('updateTeamRecord no-ops + skips cache bust when no records match', async () => {
    queryGetMock.mockResolvedValue({ empty: true, docs: [] });
    await repo.updateTeamRecord(999, 0, [], 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cacheDel).not.toHaveBeenCalled();
  });

  test('createCanonicalSchoolRecord clones the ff_ doc into canonicalDocId inside a transaction, strips canonicalDocId field', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [
        makeDoc('ff_64_t1', {
          sID: 101,
          canonicalDocId: '1_16',
          schoolName: 'Duke',
          nameNick: 'Blue Devils',
          seed: 16,
          regionID: 1,
          points: null,
          gameStatus: ['W'],
        }),
      ],
    });

    await repo.createCanonicalSchoolRecord(101, 2024);

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith('1_16');
    const payload = setMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('canonicalDocId');
    expect(payload).toMatchObject({
      sID: 101,
      schoolName: 'Duke',
      nameNick: 'Blue Devils',
      seed: 16,
      regionID: 1,
      gameStatus: ['W'],
    });
  });

  test('createCanonicalSchoolRecord no-ops if no ff_ record has canonicalDocId', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('rec', { sID: 101 /* no canonicalDocId */ })],
    });
    await repo.createCanonicalSchoolRecord(101, 2024);
    expect(setMock).not.toHaveBeenCalled();
  });

  test('deleteCanonicalSchoolRecord deletes the canonical doc inside a transaction when ff_ pair exists', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('ff_64_t1', { sID: 101, canonicalDocId: '1_16' })],
    });
    await repo.deleteCanonicalSchoolRecord(101, 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith('1_16');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  // #373 regression: after a FF resolution the canonical clone shares the
  // winner's sID and its doc id ("1_16") sorts BEFORE the ff_ doc id
  // ("ff_64_t1") in Firestore's default __name__ order. The old unordered
  // .limit(1) query therefore picked the canonical doc, hit the missing
  // canonicalDocId guard, and silently no-opped — the undone winner kept its
  // canonical record. The method must select the ff_ doc regardless of order.
  test('deleteCanonicalSchoolRecord deletes the canonical doc even when the canonical clone sorts first (#373)', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [
        makeDoc('1_16', { sID: 101 /* canonical clone — no canonicalDocId */ }),
        makeDoc('ff_64_t1', { sID: 101, canonicalDocId: '1_16' }),
      ],
    });
    await repo.deleteCanonicalSchoolRecord(101, 2024);
    expect(limitMock).not.toHaveBeenCalled();
    expect(docMock).toHaveBeenCalledWith('1_16');
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
  });

  test('deleteCanonicalSchoolRecord no-ops when no doc carries canonicalDocId', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('1_16', { sID: 101 /* canonical only, ff_ doc gone */ })],
    });
    await repo.deleteCanonicalSchoolRecord(101, 2024);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  test('createCanonicalSchoolRecord no-ops when no doc carries canonicalDocId', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc('1_16', { sID: 101 /* canonical only, ff_ doc gone */ })],
    });
    await repo.createCanonicalSchoolRecord(101, 2024);
    expect(setMock).not.toHaveBeenCalled();
  });

  test('createCanonicalSchoolRecord clones from the ff_ doc even when the canonical clone sorts first (#373)', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [
        makeDoc('1_16', {
          sID: 101,
          schoolName: 'Duke',
          seed: 16,
          regionID: 1,
        }),
        makeDoc('ff_64_t1', {
          sID: 101,
          canonicalDocId: '1_16',
          schoolName: 'Duke',
          nameNick: 'Blue Devils',
          seed: 16,
          regionID: 1,
          points: null,
          gameStatus: ['W'],
        }),
      ],
    });
    await repo.createCanonicalSchoolRecord(101, 2024);
    expect(limitMock).not.toHaveBeenCalled();
    expect(docMock).toHaveBeenCalledWith('1_16');
    const payload = setMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('canonicalDocId');
    expect(payload).toMatchObject({ sID: 101, nameNick: 'Blue Devils' });
  });

  test('getSchoolById returns null when doc does not exist', async () => {
    docGetMock.mockResolvedValue({ exists: false });
    expect(await repo.getSchoolById(99)).toBeNull();
  });

  test('getSchoolById returns data on hit', async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Duke' }),
    });
    const school = await repo.getSchoolById(101);
    expect(school).toEqual({ name: 'Duke' });
    expect(collectionMock).toHaveBeenCalledWith('school');
    expect(docMock).toHaveBeenCalledWith('101');
  });

  test('updateSchool writes exactly { name, mascot, nameNick, confID }', async () => {
    await repo.updateSchool({
      sid: 101,
      name: 'Duke',
      mascot: 'Blue Devils',
      nameNick: 'Duke',
      confID: 'acc',
    });
    expect(updateMock).toHaveBeenCalledWith({
      name: 'Duke',
      mascot: 'Blue Devils',
      nameNick: 'Duke',
      confID: 'acc',
    });
    expect(cacheDel).toHaveBeenCalledWith('allSchools');
  });

  test('updateSchoolEspn writes exactly { espn } and busts allSchools', async () => {
    await repo.updateSchoolEspn(101, { id: 'duke', slug: 'duke-blue-devils' });
    expect(docMock).toHaveBeenCalledWith('101');
    expect(updateMock).toHaveBeenCalledWith({
      espn: { id: 'duke', slug: 'duke-blue-devils' },
    });
    expect(cacheDel).toHaveBeenCalledWith('allSchools');
  });

  // #483: unlike updateSchoolEspn/updateSchool, this one does NOT bust
  // allSchools — conferenceHistory isn't part of the allSchools shape, so
  // busting it would be a wasted cache invalidation. Documented here so a
  // future refactor that "fixes" the asymmetry does so on purpose.
  test('updateSchoolConferenceHistory writes exactly { conferenceHistory } and does not bust allSchools', async () => {
    await repo.updateSchoolConferenceHistory(101, { acc: [2020, 2021] });
    expect(docMock).toHaveBeenCalledWith('101');
    expect(updateMock).toHaveBeenCalledWith({
      conferenceHistory: { acc: [2020, 2021] },
    });
    expect(cacheDel).not.toHaveBeenCalled();
  });

  test('getAllSchools orders by name asc so the cached list is alphabetical for admin <select> dropdowns', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('z', { sid: 9, name: 'Zaga' }),
        makeDoc('a', { sid: 1, name: 'Alpha' }),
      ],
    });
    await repo.getAllSchools();
    expect(orderByMock).toHaveBeenCalledWith('name', 'asc');
    expect(cacheSet).toHaveBeenCalledWith(
      'allSchools',
      expect.any(Array),
      86400,
    );
  });

  test('findSchoolsByName reuses the allSchools cache without a DB read', async () => {
    // Simulate a warm allSchools cache (populated earlier by e.g. getAllSchools
    // or a TourneyRepository batch method).
    cacheGet.mockImplementation((k) =>
      k === 'allSchools'
        ? [
            {
              sid: 1,
              name: 'Duke',
              mascot: 'Blue Devils',
              nameNick: 'Duke',
              confID: 'acc',
            },
            {
              sid: 2,
              name: 'Kansas',
              mascot: 'Jayhawks',
              nameNick: 'Kansas',
              confID: 'b12',
            },
          ]
        : undefined,
    );

    const results = await repo.findSchoolsByName('blue');

    expect(cacheGet).toHaveBeenCalledWith('allSchools');
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        sid: 1,
        name: 'Duke',
        mascot: 'Blue Devils',
        nameNick: 'Duke',
        confID: 'acc',
      },
    ]);
  });

  test('findSchoolsByName matches on name/mascot/nameNick case-insensitively', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('1', {
          sid: 1,
          name: 'Duke',
          mascot: 'Blue Devils',
          nameNick: 'Duke',
          confID: 'acc',
        }),
        makeDoc('2', {
          sid: 2,
          name: 'Kansas',
          mascot: 'Jayhawks',
          nameNick: 'Kansas',
          confID: 'b12',
        }),
        makeDoc('3', {
          sid: 3,
          name: 'Stanford',
          mascot: 'Cardinal',
          nameNick: 'Stanford',
          confID: 'p12',
        }),
      ],
    });
    const results = await repo.findSchoolsByName('BLUE');
    expect(results).toEqual([
      {
        sid: 1,
        name: 'Duke',
        mascot: 'Blue Devils',
        nameNick: 'Duke',
        confID: 'acc',
      },
    ]);
  });

  test('getMaxSchoolId queries school orderBy sid desc limit 1, returns 0 when empty', async () => {
    queryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [makeDoc('x', { sid: 42 })],
    });
    expect(await repo.getMaxSchoolId()).toBe(42);
    expect(orderByMock).toHaveBeenCalledWith('sid', 'desc');
    expect(limitMock).toHaveBeenCalledWith(1);

    queryGetMock.mockResolvedValueOnce({ empty: true });
    expect(await repo.getMaxSchoolId()).toBe(0);
  });

  test('getMaxSchoolId excludes the reserved live-E2E sid block (#502)', async () => {
    queryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [makeDoc('x', { sid: 400 })],
    });
    expect(await repo.getMaxSchoolId()).toBe(400);
    // A leaked test school (999990–999999) must not become the max and push the
    // next real allocation to 1000000.
    expect(whereMock).toHaveBeenCalledWith('sid', '<', 999990);
  });

  test('insertSchool bootstraps conferenceHistory from confID when not provided', async () => {
    await repo.insertSchool({
      sid: 101,
      name: 'Duke',
      mascot: 'Blue Devils',
      nameNick: 'Duke',
      confID: 'acc',
    });
    expect(setMock).toHaveBeenCalledWith({
      sid: 101,
      name: 'Duke',
      mascot: 'Blue Devils',
      nameNick: 'Duke',
      confID: 'acc',
      conferenceHistory: [{ confID: 'acc', startYear: null, endYear: null }],
    });
  });

  test('insertSchool uses provided conferenceHistory verbatim if given', async () => {
    const history = [{ confID: 'ind', startYear: 1900, endYear: 1950 }];
    await repo.insertSchool({
      sid: 7,
      name: 'X',
      mascot: 'Y',
      nameNick: 'Z',
      confID: 'ind',
      conferenceHistory: history,
    });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ conferenceHistory: history }),
    );
  });

  test('deleteSchool removes the school doc by string sid', async () => {
    await repo.deleteSchool(101);
    expect(docMock).toHaveBeenCalledWith('101');
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(cacheDel).toHaveBeenCalledWith('allSchools');
  });
});

// ─── ConferenceRepository ─────────────────────────────────────────────────
describe('ConferenceRepository', () => {
  const repo = new ConferenceRepository();

  test('getAllConferences orders by name asc and returns { slug, ...data } shape', async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc('acc', { name: 'Atlantic Coast Conference', shortName: 'ACC' }),
      ],
    });
    const confs = await repo.getAllConferences();

    expect(orderByMock).toHaveBeenCalledWith('name', 'asc');
    expect(confs).toEqual([
      { slug: 'acc', name: 'Atlantic Coast Conference', shortName: 'ACC' },
    ]);
    expect(cacheSet).toHaveBeenCalledWith('allConferences', confs, 86400);
  });

  test('getConferenceBySlug returns null when doc missing', async () => {
    docGetMock.mockResolvedValue({ exists: false });
    expect(await repo.getConferenceBySlug('nope')).toBeNull();
  });

  test('getConferenceBySlug returns merged { slug: id, ...data }', async () => {
    docGetMock.mockResolvedValue({
      exists: true,
      id: 'acc',
      data: () => ({ name: 'Atlantic Coast Conference' }),
    });
    const conf = await repo.getConferenceBySlug('acc');
    expect(conf).toEqual({ slug: 'acc', name: 'Atlantic Coast Conference' });
  });

  test("insertConference sets defaults for division ('I') and active (true)", async () => {
    await repo.insertConference({
      slug: 'acc',
      name: 'Atlantic Coast Conference',
      shortName: 'ACC',
    });
    expect(setMock).toHaveBeenCalledWith({
      name: 'Atlantic Coast Conference',
      shortName: 'ACC',
      division: 'I',
      active: true,
    });
    expect(cacheDel).toHaveBeenCalledWith('allConferences');
  });

  test('updateConference passes through all provided fields', async () => {
    await repo.updateConference('acc', {
      name: 'ACC updated',
      shortName: 'ACC',
      division: 'I',
      active: false,
    });
    expect(updateMock).toHaveBeenCalledWith({
      name: 'ACC updated',
      shortName: 'ACC',
      division: 'I',
      active: false,
    });
  });
});

// ─── SessionRepository ────────────────────────────────────────────────────
describe('SessionRepository', () => {
  const repo = new SessionRepository();

  test('default scope: deletes participant-only docs, strips userEmail from a merged doc, leaves admin-only docs untouched', async () => {
    const docs = [
      makeDoc('sess1', { session: { userEmail: 'user@gmail.com' } }), // participant-only → deleted
      makeDoc('sess2', { session: { adminEmail: 'admin@gmail.com' } }), // admin-only → untouched
      makeDoc('sess3', {
        session: { userEmail: 'both@gmail.com', adminEmail: 'admin@gmail.com' },
      }), // merged → userEmail stripped, doc survives
      makeDoc('sess4', { session: { anonymous: true } }),
      makeDoc('sess5', {}), // missing session field — must not throw
    ];
    queryGetMock.mockResolvedValue({ docs });
    batchCommitMock.mockResolvedValue();

    const result = await repo.clearAuthenticatedSessions();

    expect(collectionMock).toHaveBeenCalledWith('express-sessions');
    expect(batchDeleteMock).toHaveBeenCalledTimes(1);
    expect(batchDeleteMock).toHaveBeenCalledWith(docs[0].ref);
    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock).toHaveBeenCalledWith(expect.anything(), {
      'session.userEmail': FieldValue.delete(),
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ deleted: 1, strippedAdminDocs: 1 });
  });

  test('includeAdmins: true deletes every doc with userEmail or adminEmail, including merged and admin-only docs', async () => {
    const docs = [
      makeDoc('sess1', { session: { userEmail: 'user@gmail.com' } }),
      makeDoc('sess2', { session: { adminEmail: 'admin@gmail.com' } }),
      makeDoc('sess3', {
        session: { userEmail: 'both@gmail.com', adminEmail: 'admin@gmail.com' },
      }),
    ];
    queryGetMock.mockResolvedValue({ docs });
    batchCommitMock.mockResolvedValue();

    const result = await repo.clearAuthenticatedSessions({
      includeAdmins: true,
    });

    expect(batchDeleteMock).toHaveBeenCalledTimes(3);
    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 3, strippedAdminDocs: 0 });
  });

  test('skips the batch commit when nothing matches', async () => {
    const docs = [makeDoc('sess1', { session: { anonymous: true } })];
    queryGetMock.mockResolvedValue({ docs });

    const result = await repo.clearAuthenticatedSessions();

    expect(batchDeleteMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, strippedAdminDocs: 0 });
  });

  test('splits deletes across multiple batches of 450 when count exceeds limit', async () => {
    const docs = Array.from({ length: 500 }, (_, i) =>
      makeDoc(`sess${i}`, { session: { userEmail: `user${i}@gmail.com` } }),
    );
    queryGetMock.mockResolvedValue({ docs });

    const result = await repo.clearAuthenticatedSessions();

    expect(batchDeleteMock).toHaveBeenCalledTimes(500);
    expect(batchCommitMock).toHaveBeenCalledTimes(2); // batch 1: 450, batch 2: 50
    expect(result).toEqual({ deleted: 500, strippedAdminDocs: 0 });
  });

  test('splits merged-doc userEmail strips across multiple batches of 450 when count exceeds limit', async () => {
    const docs = Array.from({ length: 500 }, (_, i) =>
      makeDoc(`sess${i}`, {
        session: {
          userEmail: `user${i}@gmail.com`,
          adminEmail: `admin${i}@gmail.com`,
        },
      }),
    );
    queryGetMock.mockResolvedValue({ docs });

    const result = await repo.clearAuthenticatedSessions();

    expect(batchUpdateMock).toHaveBeenCalledTimes(500);
    expect(batchCommitMock).toHaveBeenCalledTimes(2); // batch 1: 450, batch 2: 50
    expect(result).toEqual({ deleted: 0, strippedAdminDocs: 500 });
  });
});

// ─── EntryRepository.updateMultipleEntryPoints — deleted-entry resilience ──
describe('EntryRepository.updateMultipleEntryPoints — missing-doc retry', () => {
  const repo = new EntryRepository();

  // #780: the retry rebuilds `refs` from pointsChunk independently of the loop
  // that built the failed batch, then pairs snapshots[i] with refs[i] and
  // pointsChunk[i]. A misalignment there never throws — it writes one entry's
  // totalPoints onto a different entry's document — so the refs have to be
  // distinguishable for an assertion to catch it. The shared harness hands
  // every path the same docRef object, so tag each ref with its doc id for
  // this describe only and put the shared ref back afterwards.
  let sharedDocRef;
  beforeEach(() => {
    sharedDocRef = docMock('probe');
    docMock.mockImplementation((id) => ({ ...sharedDocRef, id: String(id) }));
    docMock.mockClear(); // drop the probe call so call-order assertions still line up
  });

  afterEach(() => {
    docMock.mockReset();
    docMock.mockReturnValue(sharedDocRef);
  });

  test('pairs each surviving snapshot with its own chunk entry and ref', async () => {
    batchCommitMock.mockRejectedValueOnce(new Error('NOT_FOUND'));
    // The hole is in the middle: if the retry ever indexed by survivor
    // position instead of chunk position, entry 30's points would land on
    // entry 20's ref and nothing would fail.
    getAllMock.mockResolvedValue([
      { exists: true },
      { exists: false },
      { exists: true },
    ]);

    await repo.updateMultipleEntryPoints(
      [
        { entryID: 10, points: 1, possPoints: 11 },
        { entryID: 20, points: 2, possPoints: 22 },
        { entryID: 30, points: 3, possPoints: 33 },
      ],
      2024,
    );

    // 3 updates on the failed attempt, then exactly 2 on the retry.
    expect(batchUpdateMock).toHaveBeenCalledTimes(5);
    expect(batchUpdateMock.mock.calls.slice(3)).toEqual([
      [
        expect.objectContaining({ id: '10' }),
        { totalPoints: 1, possPoints: 11 },
      ],
      [
        expect.objectContaining({ id: '30' }),
        { totalPoints: 3, possPoints: 33 },
      ],
    ]);
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
  });

  test('retries with only the still-existing docs when the atomic batch fails', async () => {
    // First commit fails (one entry deleted between read and write → whole
    // batch rejected); the retry must update the survivor and skip the ghost.
    batchCommitMock.mockRejectedValueOnce(
      new Error('NOT_FOUND: no entity to update'),
    );
    getAllMock.mockResolvedValue([
      { exists: true }, // entry 1 still there
      { exists: false }, // entry 2 was deleted
    ]);

    await repo.updateMultipleEntryPoints(
      [
        { entryID: 1, points: 10, possPoints: 100 },
        { entryID: 2, points: 20, possPoints: 200 },
      ],
      2024,
    );

    // 2 updates on the failed attempt + 1 on the retry (only the existing doc)
    expect(batchUpdateMock).toHaveBeenCalledTimes(3);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(3, expect.anything(), {
      totalPoints: 10,
      possPoints: 100,
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
    expect(getAllMock).toHaveBeenCalledTimes(1);

    // #328 — the full standings cache-bust set must fire on the retry path too.
    // This is the ESPN-poll scoring write: if the retry succeeds but any of
    // these busts regress, live standings serve stale points for a full TTL
    // (300s) right after a game resolves.
    expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
    expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');
  });

  test('skips the retry commit entirely when no docs survive', async () => {
    batchCommitMock.mockRejectedValueOnce(new Error('NOT_FOUND'));
    getAllMock.mockResolvedValue([{ exists: false }]);

    await repo.updateMultipleEntryPoints(
      [{ entryID: 9, points: 1, possPoints: 2 }],
      2024,
    );

    expect(batchCommitMock).toHaveBeenCalledTimes(1); // failed attempt only

    // #328 — the cache-bust block sits after (not inside) the catch, so it must
    // run even when zero docs survive and no retry commit happens: the first
    // commit may have partially raced with reads, and busting is free.
    expect(invalidateCache).toHaveBeenCalledWith('groupTeams_');
    expect(invalidateCache).toHaveBeenCalledWith('entriesForGroup_');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
    expect(cacheDel).toHaveBeenCalledWith('allEntries_2024');
    expect(cacheDel).toHaveBeenCalledWith('entriesByNameRaw_2024');
  });

  test('rethrows when even the existence-checked retry fails', async () => {
    batchCommitMock.mockRejectedValue(new Error('UNAVAILABLE'));
    getAllMock.mockResolvedValue([{ exists: true }]);

    await expect(
      repo.updateMultipleEntryPoints(
        [{ entryID: 1, points: 1, possPoints: 2 }],
        2024,
      ),
    ).rejects.toThrow('UNAVAILABLE');
  });

  // The year guard throws from inside the try, and the inner retry catch calls
  // yearDoc again while rebuilding refs — so a bad year has two chances to be
  // mistaken for a Firestore failure. It must still reach the caller as a
  // ValidationError.
  test('surfaces a bad year as ValidationError, not a batch failure', async () => {
    const error = await repo
      .updateMultipleEntryPoints(
        [{ entryID: 1, points: 1, possPoints: 2 }],
        'not-a-year',
      )
      .catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.field).toBe('year');
  });
});

// ─── GameRepository.resolveGame / undoResolvedGame — single-transaction ───
describe('GameRepository.resolveGame / undoResolvedGame', () => {
  const repo = new GameRepository();

  test('resolveGame writes winner+hold release, next-round slot, and both team records in ONE transaction', async () => {
    queryGetMock
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          makeDoc('w', {
            sID: 1,
            nameNick: 'Duke',
            schoolName: 'Duke University',
            seed: 2,
          }),
        ],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 2 })],
      });

    await repo.resolveGame(
      {
        gameID: 9,
        winner: 1,
        loser: 2,
        nextGame: 13,
        nextGameSpot: 1,
        winnerPoints: 5,
        winnerStatus: ['W', 'W'],
        loserPoints: 2,
        loserStatus: ['W', 'L'],
      },
      2024,
    );

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ winner: 1, manualHold: false });
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: 1,
      team1Name: 'Duke',
      team1Seed: 2,
    });
    expect(updateMock).toHaveBeenCalledWith({
      points: 5,
      gameStatus: ['W', 'W'],
    });
    expect(updateMock).toHaveBeenCalledWith({
      points: 2,
      gameStatus: ['W', 'L'],
    });

    // Game + team caches busted, including the team-points cache the old
    // 4-write path busted via updateTeamRecord
    expect(cacheDel).toHaveBeenCalledWith('tournamentDetails_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeGames_2024');
    expect(cacheDel).toHaveBeenCalledWith('activeFutureGames_2024');
    expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
    expect(invalidateCache).toHaveBeenCalledWith('gameViewData_2024_');
    expect(invalidateCache).toHaveBeenCalledWith('fullGridData_2024_');
  });

  test('resolveGame updates ALL schoolRecords docs sharing the winner sID (ff_ + canonical)', async () => {
    queryGetMock
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          makeDoc('ff_64_1', { sID: 1, nameNick: 'FDU' }),
          makeDoc('1_16', { sID: 1, nameNick: 'FDU' }),
        ],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 2 })],
      });

    await repo.resolveGame(
      {
        gameID: 1,
        winner: 1,
        loser: 2,
        nextGame: null,
        nextGameSpot: null,
        winnerPoints: 2,
        winnerStatus: ['W'],
        loserPoints: 0,
        loserStatus: ['L'],
      },
      2024,
    );

    const winnerRecordWrites = updateMock.mock.calls.filter(
      ([data]) => data.points === 2 && Array.isArray(data.gameStatus),
    );
    expect(winnerRecordWrites).toHaveLength(2);
  });

  test('resolveGame with no nextGame writes no team-slot update', async () => {
    queryGetMock
      .mockResolvedValueOnce({ empty: false, docs: [makeDoc('w', { sID: 1 })] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 2 })],
      });

    await repo.resolveGame(
      {
        gameID: 63,
        winner: 1,
        loser: 2,
        nextGame: null,
        nextGameSpot: null,
        winnerPoints: 69,
        winnerStatus: [],
        loserPoints: 36,
        loserStatus: [],
      },
      2024,
    );

    const slotWrites = updateMock.mock.calls.filter(
      ([data]) => 'team1ID' in data || 'team2ID' in data,
    );
    expect(slotWrites).toHaveLength(0);
  });

  // #338 — every existing resolveGame test used nextGameSpot: 1 and non-empty
  // schoolRecords snapshots. Half of all bracket games feed slot 2 of their
  // next game, and the poll must survive games whose teams have no
  // schoolRecords docs (legacy/missing data) without tearing the transaction.
  test('resolveGame writes the winner into team2* keys (and ONLY team2*) when nextGameSpot is 2', async () => {
    queryGetMock
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('w', { sID: 5, nameNick: 'UNC', seed: 4 })],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 6 })],
      });

    await repo.resolveGame(
      {
        gameID: 2,
        winner: 5,
        loser: 6,
        nextGame: 9,
        nextGameSpot: 2,
        winnerPoints: 2,
        winnerStatus: ['W'],
        loserPoints: 0,
        loserStatus: ['L'],
      },
      2024,
    );

    expect(updateMock).toHaveBeenCalledWith({
      team2ID: 5,
      team2Name: 'UNC',
      team2Seed: 4,
    });
    // A regression in the slot ternary would misplace every second winner —
    // no write may touch the team1* slot.
    const slot1Writes = updateMock.mock.calls.filter(
      ([data]) => 'team1ID' in data,
    );
    expect(slot1Writes).toHaveLength(0);
  });

  test('resolveGame with empty schoolRecords snapshots still records the winner + slot (null name/seed) and writes zero team records', async () => {
    queryGetMock
      .mockResolvedValueOnce({ empty: true, docs: [] }) // winner records missing
      .mockResolvedValueOnce({ empty: true, docs: [] }); // loser records missing

    await expect(
      repo.resolveGame(
        {
          gameID: 2,
          winner: 5,
          loser: 6,
          nextGame: 9,
          nextGameSpot: 1,
          winnerPoints: 2,
          winnerStatus: ['W'],
          loserPoints: 0,
          loserStatus: ['L'],
        },
        2024,
      ),
    ).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalledWith({ winner: 5, manualHold: false });
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: 5,
      team1Name: null,
      team1Seed: null,
    });
    // No schoolRecords docs → no points/gameStatus writes at all.
    const recordWrites = updateMock.mock.calls.filter(
      ([data]) => 'points' in data,
    );
    expect(recordWrites).toHaveLength(0);
  });

  test('resolveGame with only loser records present writes the loser record and no winner record', async () => {
    queryGetMock
      .mockResolvedValueOnce({ empty: true, docs: [] }) // winner records missing
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 6 })],
      }); // loser present

    await repo.resolveGame(
      {
        gameID: 2,
        winner: 5,
        loser: 6,
        nextGame: 9,
        nextGameSpot: 2,
        winnerPoints: 2,
        winnerStatus: ['W'],
        loserPoints: 0,
        loserStatus: ['L'],
      },
      2024,
    );

    expect(updateMock).toHaveBeenCalledWith({ points: 0, gameStatus: ['L'] });
    const winnerRecordWrites = updateMock.mock.calls.filter(
      ([data]) => data.points === 2,
    );
    expect(winnerRecordWrites).toHaveLength(0);
    // The next-game slot still fills from the winner param, name/seed null.
    expect(updateMock).toHaveBeenCalledWith({
      team2ID: 5,
      team2Name: null,
      team2Seed: null,
    });
  });

  test('undoResolvedGame clears winner WITH manualHold, clears the slot, and restores both records atomically', async () => {
    queryGetMock
      .mockResolvedValueOnce({ empty: false, docs: [makeDoc('w', { sID: 1 })] })
      .mockResolvedValueOnce({
        empty: false,
        docs: [makeDoc('l', { sID: 2 })],
      });

    await repo.undoResolvedGame(
      {
        gameID: 9,
        winner: 1,
        loser: 2,
        nextGame: 13,
        nextGameSpot: 2,
        restorePoints: null,
        restoreStatus: [],
      },
      2024,
    );

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ winner: null, manualHold: true });
    expect(updateMock).toHaveBeenCalledWith({
      team2ID: null,
      team2Name: null,
      team2Seed: null,
    });
    const restoreWrites = updateMock.mock.calls.filter(
      ([data]) =>
        data.points === null &&
        Array.isArray(data.gameStatus) &&
        data.gameStatus.length === 0,
    );
    expect(restoreWrites).toHaveLength(2); // winner + loser
    expect(cacheDel).toHaveBeenCalledWith('allTeamNames_2024');
  });
});

// ─── GameRepository — pending points-recalc marker ─────────────────────────
describe('GameRepository — pending recalc marker', () => {
  const repo = new GameRepository();

  test('addPendingRecalcSIDs merges a numeric, deduped arrayUnion onto tournaments/{year}', async () => {
    await repo.addPendingRecalcSIDs(2024, [28, '73', 28]);

    expect(collectionMock).toHaveBeenCalledWith('tournaments');
    expect(docMock).toHaveBeenCalledWith('2024');
    expect(setMock).toHaveBeenCalledWith(
      { pendingRecalcSIDs: expect.anything() },
      { merge: true },
    );
  });

  test('addPendingRecalcSIDs with an empty list writes nothing', async () => {
    await repo.addPendingRecalcSIDs(2024, []);
    expect(setMock).not.toHaveBeenCalled();
  });

  test('getPendingRecalcSIDs returns numeric sIDs, and [] when the doc or field is missing', async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ pendingRecalcSIDs: [28, '73'] }),
    });
    expect(await repo.getPendingRecalcSIDs(2024)).toEqual([28, 73]);

    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    expect(await repo.getPendingRecalcSIDs(2024)).toEqual([]);

    docGetMock.mockResolvedValueOnce({ exists: false });
    expect(await repo.getPendingRecalcSIDs(2024)).toEqual([]);
  });

  test('clearPendingRecalcSIDs removes only the given sIDs (merge + arrayRemove), nothing on empty', async () => {
    await repo.clearPendingRecalcSIDs(2024, [28, 73]);
    expect(setMock).toHaveBeenCalledWith(
      { pendingRecalcSIDs: expect.anything() },
      { merge: true },
    );

    setMock.mockClear();
    await repo.clearPendingRecalcSIDs(2024, []);
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe('isExcludedOnlyGroup', () => {
  it('should return true when groups contains only an excluded group', () => {
    const excludedGroup = APP_CONFIG.tournament.excludedGroups[0] || 'Bad';
    expect(_isExcludedOnlyGroupForTests([excludedGroup])).toBe(true);
  });

  it('should return false when groups contains multiple groups including an excluded group', () => {
    const excludedGroup = APP_CONFIG.tournament.excludedGroups[0] || 'Bad';
    expect(_isExcludedOnlyGroupForTests([excludedGroup, 'OtherGroup'])).toBe(
      false,
    );
  });

  it('should return false when groups contains a single group that is not excluded', () => {
    expect(_isExcludedOnlyGroupForTests(['GoodGroup'])).toBe(false);
  });

  it('should return false when groups is empty', () => {
    expect(_isExcludedOnlyGroupForTests([])).toBe(false);
  });
});
