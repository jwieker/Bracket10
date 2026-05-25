import {
  EntryRepository,
  ViewRepository,
  GameRepository,
  TourneyRepository,
  TeamRepository,
  ConferenceRepository,
} from "../src/repositories/hierarchicalRepository.js";

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
  batchDeleteMock,
  batchCommitMock,
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateCache,
  runTransactionMock,
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
  const batchDeleteMock = vi.fn();
  const batchCommitMock = vi.fn().mockResolvedValue({});
  const batchRef = {
    update: batchUpdateMock,
    set: batchSetMock,
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
      update: vi.fn().mockImplementation((_ref, data) => updateMock(data)),
      set: vi.fn().mockImplementation((_ref, data) => setMock(data)),
      delete: vi.fn().mockImplementation((_ref) => deleteMock()),
    };
    return await cb(tx);
  });

  return {
    collectionMock, docMock, docGetMock, queryGetMock,
    updateMock, setMock, deleteMock,
    whereMock, orderByMock, limitMock,
    batchMock, batchUpdateMock, batchSetMock, batchDeleteMock, batchCommitMock,
    cacheGet, cacheSet, cacheDel, invalidateCache,
    runTransactionMock,
  };
});

vi.mock("../src/config/firestore.js", () => ({
  db: { collection: collectionMock, batch: batchMock, runTransaction: runTransactionMock },
}));

vi.mock("../src/utils/cacheUtils.js", () => ({
  cacheGet, cacheSet, cacheDel, invalidateCache,
}));

// Helper — build a fake doc snapshot for query results.
const makeDoc = (id, data) => ({
  id, ref: { id }, exists: true, data: () => data,
});

beforeEach(() => {
  vi.clearAllMocks();
  // mockResolvedValueOnce queues drain between tests with clearAllMocks; reset defaults:
  cacheGet.mockReturnValue(undefined);
});

// ─── EntryRepository ──────────────────────────────────────────────────────
describe("EntryRepository", () => {
  const repo = new EntryRepository();

  test("updateMultipleEntryPoints writes one batch.update per entry with totalPoints+possPoints", async () => {
    await repo.updateMultipleEntryPoints(
      [{ entryID: 1, points: 10, possPoints: 100 }, { entryID: 2, points: 20, possPoints: 200 }],
      2024
    );

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), { totalPoints: 10, possPoints: 100 });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(2, expect.anything(), { totalPoints: 20, possPoints: 200 });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);

    // Path: tournaments/{year}/entries/{id} — walked once per entry, in order
    expect(collectionMock.mock.calls.map(c => c[0])).toEqual([
      "tournaments", "entries", "tournaments", "entries",
    ]);
    expect(docMock.mock.calls.map(c => c[0])).toEqual([
      "2024", "1", "2024", "2",
    ]);
  });

  test("createEntry writes full entry doc and busts per-group + allEntries caches", async () => {
    await repo.createEntry(7, "x@y.com", "Team X", [1, 2], ["A", "B"], "Alice", "2024-03-01", 2024, 150);

    expect(setMock).toHaveBeenCalledWith({
      id: 7, email: "x@y.com", teamName: "Team X", picks: [1, 2],
      groups: ["A", "B"], person: "Alice", created_at: "2024-03-01",
      possPoints: 150, totalPoints: 0,
    });

    // Cache busts (per-group keys + global key)
    expect(cacheDel).toHaveBeenCalledWith("groupTeams_A_2024");
    expect(cacheDel).toHaveBeenCalledWith("groupTeams_B_2024");
    expect(cacheDel).toHaveBeenCalledWith("entriesForGroup_A_2024");
    expect(cacheDel).toHaveBeenCalledWith("entriesForGroup_B_2024");
    expect(cacheDel).toHaveBeenCalledWith("gameViewData_2024_A");
    expect(cacheDel).toHaveBeenCalledWith("gameViewData_2024_B");
    expect(cacheDel).toHaveBeenCalledWith("allEntries_2024");
  });

  test("createEntry wraps a single groupName string into a groups array", async () => {
    await repo.createEntry(8, "a@b.com", "T", [], "OnlyGroup", "P", "2024-03-01", 2024, 0);

    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ groups: ["OnlyGroup"] }));
    expect(cacheDel).toHaveBeenCalledWith("groupTeams_OnlyGroup_2024");
  });

  test("findEntriesByName filters case-insensitively against person OR teamName and returns slim shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("1", { id: 1, person: "Alice",  teamName: "Wildcats", groups: ["A"], hasPaid: true,  paymentNote: "PAID", payByCheck: false }),
        makeDoc("2", { id: 2, person: "Bob",    teamName: "alice's", groups: ["B"] }),   // matches via teamName
        makeDoc("3", { id: 3, person: "Charlie", teamName: "Other",   groups: ["C"] }),  // no match
      ],
    });

    const results = await repo.findEntriesByName("ALICE", 2024);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 1, teamName: "Wildcats", person: "Alice", year: 2024,
      groups: ["A"], hasPaid: true, paymentNote: "PAID", payByCheck: false,
    });
    // Defaults for missing fields on doc 2
    expect(results[1]).toEqual({
      id: 2, teamName: "alice's", person: "Bob", year: 2024,
      groups: ["B"], hasPaid: false, paymentNote: "", payByCheck: false,
    });
    // Populates the entriesByNameRaw cache so repeated typeahead keystrokes
    // skip the DB read.
    expect(cacheSet).toHaveBeenCalledWith(
      "entriesByNameRaw_2024",
      expect.any(Array),
      300,
    );
  });

  test("findEntriesByName cache hit filters the cached list without a DB read", async () => {
    cacheGet.mockReturnValue([
      { id: 1, person: "Alice", teamName: "Wildcats", year: 2024, groups: ["A"], hasPaid: true,  paymentNote: "", payByCheck: false },
      { id: 2, person: "Bob",   teamName: "Other",    year: 2024, groups: ["B"], hasPaid: false, paymentNote: "", payByCheck: false },
    ]);

    const results = await repo.findEntriesByName("alice", 2024);

    expect(cacheGet).toHaveBeenCalledWith("entriesByNameRaw_2024");
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  test("entry-write methods invalidate entriesByNameRaw_{year} alongside allEntries_{year}", async () => {
    // createEntry
    await repo.createEntry(7, "x@y.com", "Team X", [1, 2], ["A"], "Alice", "2024-03-01", 2024, 0);
    expect(cacheDel).toHaveBeenCalledWith("entriesByNameRaw_2024");

    cacheDel.mockClear();
    await repo.deleteEntry("42", 2024);
    expect(cacheDel).toHaveBeenCalledWith("entriesByNameRaw_2024");

    cacheDel.mockClear();
    await repo.updateEntryPicks("5", [10], 2024);
    expect(cacheDel).toHaveBeenCalledWith("entriesByNameRaw_2024");

    cacheDel.mockClear();
    await repo.updateMultipleEntryPicks([{ entryId: "1", picks: [9] }], 2024);
    expect(cacheDel).toHaveBeenCalledWith("entriesByNameRaw_2024");
  });

  test("getUnpaidEntriesForGroup queries by array-contains and filters out paid + payByCheck", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("1", { id: 1, person: "Alice", teamName: "A", groups: ["G"], hasPaid: false, payByCheck: false }),
        makeDoc("2", { id: 2, person: "Bob",   teamName: "B", groups: ["G"], hasPaid: true,  payByCheck: false }),
        makeDoc("3", { id: 3, person: "Carol", teamName: "C", groups: ["G"], hasPaid: false, payByCheck: true  }),
      ],
    });

    const results = await repo.getUnpaidEntriesForGroup("G", 2024);

    expect(whereMock).toHaveBeenCalledWith("groups", "array-contains", "G");
    expect(results).toEqual([
      { id: 1, teamName: "A", person: "Alice", year: 2024, groups: ["G"], hasPaid: false, paymentNote: "" },
    ]);
  });

  test("deleteEntry deletes doc and invalidates group + allEntries caches", async () => {
    await repo.deleteEntry("42", 2024);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith("42");
    expect(invalidateCache).toHaveBeenCalledWith("groupTeams_");
    expect(invalidateCache).toHaveBeenCalledWith("entriesForGroup_");
    expect(cacheDel).toHaveBeenCalledWith("allEntries_2024");
  });

  test("updateEntryPicks writes picks-only update and invalidates relevant caches", async () => {
    await repo.updateEntryPicks("5", [10, 20], 2024);

    expect(updateMock).toHaveBeenCalledWith({ picks: [10, 20] });
    expect(docMock).toHaveBeenCalledWith("5");
    expect(invalidateCache).toHaveBeenCalledWith("entriesForGroup_");
    expect(cacheDel).toHaveBeenCalledWith("allEntries_2024");
  });

  test("updateMultipleEntryPicks no-ops on empty array (no batch.commit)", async () => {
    await repo.updateMultipleEntryPicks([], 2024);
    expect(batchMock).not.toHaveBeenCalled();
    expect(batchCommitMock).not.toHaveBeenCalled();
  });

  test("updateMultipleEntryPicks chunks at 500 (601 updates → 2 batches)", async () => {
    const updates = Array.from({ length: 601 }, (_, i) => ({ entryId: String(i + 1), picks: [i] }));
    await repo.updateMultipleEntryPicks(updates, 2024);

    expect(batchMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenCalledTimes(601);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), { picks: [0] });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(601, expect.anything(), { picks: [600] });
  });

  test("getUnsentEmailEntries filters out emailSent=true and returns email shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("1", { id: 1, email: "a@x", person: "A", teamName: "T1", picks: [1], groups: ["G"], emailSent: false }),
        makeDoc("2", { id: 2, email: "b@x", person: "B", teamName: "T2", picks: [2], groups: ["G"], emailSent: true  }),
      ],
    });

    const results = await repo.getUnsentEmailEntries("G", 2024);

    expect(whereMock).toHaveBeenCalledWith("groups", "array-contains", "G");
    expect(results).toEqual([
      { id: 1, email: "a@x", person: "A", teamName: "T1", picks: [1], groups: ["G"], year: 2024 },
    ]);
  });

  test("markEmailsSent batches one update per id with { emailSent: true }", async () => {
    await repo.markEmailsSent(["10", "11"], 2024);

    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock).toHaveBeenNthCalledWith(1, expect.anything(), { emailSent: true });
    expect(batchUpdateMock).toHaveBeenNthCalledWith(2, expect.anything(), { emailSent: true });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith("10");
    expect(docMock).toHaveBeenCalledWith("11");
  });
});

// ─── ViewRepository ───────────────────────────────────────────────────────
describe("ViewRepository", () => {
  const repo = new ViewRepository();

  test("findGroupByName cache hit short-circuits the DB (no get() calls)", async () => {
    cacheGet.mockReturnValue("CachedGroup");

    const res = await repo.findGroupByName("CachedGroup");

    expect(res).toBe("CachedGroup");
    expect(cacheGet).toHaveBeenCalledWith("groupByName_cachedgroup");
    expect(docGetMock).not.toHaveBeenCalled();
    expect(queryGetMock).not.toHaveBeenCalled();
  });

  test("findGroupByName uses exact-name doc lookup first and caches the hit for 24h", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "Bob" }) });

    const res = await repo.findGroupByName("Bob");

    expect(collectionMock).toHaveBeenCalledWith("groups");
    expect(docMock).toHaveBeenCalledWith("Bob");
    expect(res).toBe("Bob");
    expect(cacheSet).toHaveBeenCalledWith("groupByName_bob", "Bob", 86400);
  });

  test("findGroupByName falls back to case-insensitive scan if doc missing", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("Alice", { name: "Alice" }), makeDoc("Bob", { name: "Bob" })],
    });

    const res = await repo.findGroupByName("bob");

    expect(res).toBe("Bob"); // returns DB casing
    expect(cacheSet).toHaveBeenCalledWith("groupByName_bob", "Bob", 86400);
  });

  test("findGroupByName caches a null result so missing groups don't re-query", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    queryGetMock.mockResolvedValue({ docs: [] });

    const res = await repo.findGroupByName("Nope");
    expect(res).toBeNull();
    expect(cacheSet).toHaveBeenCalledWith("groupByName_nope", null, 86400);
  });

  test("getGroupTeams maps to slim shape and caches for 5 minutes", async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("1", { id: 1, teamName: "T", picks: [9], totalPoints: 5, person: "Alice", possPoints: 100, junk: "drop" })],
    });

    const res = await repo.getGroupTeams("G", 2024);

    expect(whereMock).toHaveBeenCalledWith("groups", "array-contains", "G");
    expect(res).toEqual([
      { id: 1, teamName: "T", picks: [9], totalPoints: 5, person: "Alice", possPoints: 100 },
    ]);
    expect(cacheSet).toHaveBeenCalledWith("groupTeams_G_2024", res, 300);
  });

  test("getMaxGroupId queries groups orderBy id desc limit 1", async () => {
    queryGetMock.mockResolvedValue({ empty: false, docs: [makeDoc("x", { id: 42 })] });

    const max = await repo.getMaxGroupId();

    expect(collectionMock).toHaveBeenCalledWith("groups");
    expect(orderByMock).toHaveBeenCalledWith("id", "desc");
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(max).toBe(42);
  });

  test("getMaxGroupId returns 0 when no groups exist", async () => {
    queryGetMock.mockResolvedValue({ empty: true });
    expect(await repo.getMaxGroupId()).toBe(0);
  });

  test("addGroup writes {id,name} and busts allGroups + lookup caches", async () => {
    await repo.addGroup(5, "MyGroup");
    expect(setMock).toHaveBeenCalledWith({ id: 5, name: "MyGroup" });
    expect(docMock).toHaveBeenCalledWith("MyGroup");
    expect(cacheDel).toHaveBeenCalledWith("allGroups");
    expect(cacheDel).toHaveBeenCalledWith("groupByName_mygroup");
  });

  test("getAllGroups returns sorted names and caches for 24h", async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("A", { name: "Group A" }), makeDoc("B", { name: "Group B" })],
    });
    const res = await repo.getAllGroups();

    expect(orderByMock).toHaveBeenCalledWith("name", "asc");
    expect(res).toEqual(["Group A", "Group B"]);
    expect(cacheSet).toHaveBeenCalledWith("allGroups", res, 86400);
  });

  test("getAllGroups returns cached value without querying", async () => {
    cacheGet.mockReturnValue(["Cached A", "Cached B"]);
    const res = await repo.getAllGroups();
    expect(res).toEqual(["Cached A", "Cached B"]);
    expect(queryGetMock).not.toHaveBeenCalled();
  });
});

// ─── GameRepository ───────────────────────────────────────────────────────
describe("GameRepository", () => {
  const repo = new GameRepository();

  test("updateWinner writes winner only and busts all dependent caches", async () => {
    await repo.updateWinner("23", 101, 2024);

    expect(updateMock).toHaveBeenCalledWith({ winner: 101 });
    expect(docMock).toHaveBeenCalledWith("23");
    expect(cacheDel).toHaveBeenCalledWith("tournamentDetails_2024");
    expect(cacheDel).toHaveBeenCalledWith("activeGames_2024");
    expect(cacheDel).toHaveBeenCalledWith("activeFutureGames_2024");
    expect(invalidateCache).toHaveBeenCalledWith("gameViewData_2024_");
  });

  test("updateNextGameTeam denormalizes team name+seed from schoolRecords for slot 1 inside a transaction", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec", { sID: 101, nameNick: "Blue Devils", seed: 2 })],
    });

    await repo.updateNextGameTeam("33", 1, 101, 2024);

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledWith("sID", "==", 101);
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: 101, team1Name: "Blue Devils", team1Seed: 2,
    });
  });

  test("updateNextGameTeam writes to slot 2 with team2* keys", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec", { sID: 7, nameNick: "Cats", seed: 5 })],
    });
    await repo.updateNextGameTeam("33", 2, 7, 2024);
    expect(updateMock).toHaveBeenCalledWith({ team2ID: 7, team2Name: "Cats", team2Seed: 5 });
  });

  test("updateNextGameTeam with no winner (undo) writes nulls and skips schoolRecord read", async () => {
    await repo.updateNextGameTeam("33", 1, null, 2024);

    expect(queryGetMock).not.toHaveBeenCalled(); // no schoolRecord lookup when winner is falsy
    expect(updateMock).toHaveBeenCalledWith({
      team1ID: null, team1Name: null, team1Seed: null,
    });
  });

  test("updateNextGameTeam falls back to schoolName when nameNick is missing", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec", { sID: 101, schoolName: "Duke", seed: 2 })],
    });
    await repo.updateNextGameTeam("33", 1, 101, 2024);
    expect(updateMock).toHaveBeenCalledWith({ team1ID: 101, team1Name: "Duke", team1Seed: 2 });
  });

  test("getActiveAndFutureGames queries winner==null and returns sorted with year stamped", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("g2", { gameID: 6, winner: null }),
        makeDoc("g1", { gameID: 5, winner: null }),
      ],
    });

    const games = await repo.getActiveAndFutureGames(2024);

    expect(whereMock).toHaveBeenCalledWith("winner", "==", null);
    expect(games).toEqual([
      { gameID: 5, winner: null, year: 2024 },
      { gameID: 6, winner: null, year: 2024 },
    ]);
    expect(cacheSet).toHaveBeenCalledWith("activeFutureGames_2024", games, 300);
  });

  test("getActiveAndFutureGames returns cached value without DB hit", async () => {
    cacheGet.mockReturnValue([{ gameID: 1, year: 2024 }]);
    const res = await repo.getActiveAndFutureGames(2024);
    expect(res).toEqual([{ gameID: 1, year: 2024 }]);
    expect(queryGetMock).not.toHaveBeenCalled();
  });

  test("deleteGamesByYear batches one delete per game and commits", async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("g1", {}), makeDoc("g2", {}), makeDoc("g3", {})],
    });
    await repo.deleteGamesByYear(2024);
    expect(batchDeleteMock).toHaveBeenCalledTimes(3);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  test("getEntriesContainingTeams uses array-contains-any with numeric SIDs and drops EXCLUDED 'Bad' group-only entries", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("1", { id: 1, teamName: "Keep",  picks: [101], totalPoints: 5, person: "A", groups: ["Good"] }),
        makeDoc("2", { id: 2, teamName: "Skip",  picks: [101], totalPoints: 0, person: "B", groups: ["Bad"]  }),
        makeDoc("3", { id: 3, teamName: "Keep2", picks: [101], totalPoints: 1, person: "C", group: "Legacy"  }), // legacy single-group string
      ],
    });

    const entries = await repo.getEntriesContainingTeams(2024, ["101"]);

    expect(whereMock).toHaveBeenCalledWith("picks", "array-contains-any", [101]); // coerced to Number
    expect(entries.map(e => e.id)).toEqual([1, 3]);
    // Legacy single-group string is normalized into groups[]
    expect(entries.find(e => e.id === 3).groups).toEqual(["Legacy"]);
  });

  test("getEntriesContainingTeams empty input short-circuits with zero queries", async () => {
    const entries = await repo.getEntriesContainingTeams(2024, []);
    expect(entries).toEqual([]);
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(whereMock).not.toHaveBeenCalled();
  });

  test("getEntriesContainingTeams chunks sID lists >30 into batches of 30 and dedupes by entry id", async () => {
    // 65 sIDs → 3 chunks: 30 + 30 + 5
    const sIDs = Array.from({ length: 65 }, (_, i) => 1000 + i);

    // Same entry id "shared" returned in all three chunks must collapse to one
    // result. Each chunk also returns a chunk-unique entry to verify merge.
    const shared = makeDoc("shared", { id: 7777, teamName: "Shared", picks: [1000], totalPoints: 0, person: "S", groups: ["Good"] });
    queryGetMock
      .mockResolvedValueOnce({ docs: [shared, makeDoc("a", { id: 1, teamName: "A", picks: [1000], totalPoints: 0, person: "Pa", groups: ["Good"] })] })
      .mockResolvedValueOnce({ docs: [shared, makeDoc("b", { id: 2, teamName: "B", picks: [1030], totalPoints: 0, person: "Pb", groups: ["Good"] })] })
      .mockResolvedValueOnce({ docs: [shared, makeDoc("c", { id: 3, teamName: "C", picks: [1060], totalPoints: 0, person: "Pc", groups: ["Good"] })] });

    const entries = await repo.getEntriesContainingTeams(2024, sIDs);

    // One Firestore query per chunk
    expect(queryGetMock).toHaveBeenCalledTimes(3);

    // Each chunk used array-contains-any with ≤30 disjuncts
    const arrayContainsAnyCalls = whereMock.mock.calls.filter(c => c[0] === "picks" && c[1] === "array-contains-any");
    expect(arrayContainsAnyCalls).toHaveLength(3);
    expect(arrayContainsAnyCalls[0][2]).toHaveLength(30);
    expect(arrayContainsAnyCalls[1][2]).toHaveLength(30);
    expect(arrayContainsAnyCalls[2][2]).toHaveLength(5);

    // Shared entry collapses to a single result; chunk-unique entries all kept
    expect(entries.map(e => e.id).sort()).toEqual([1, 2, 3, 7777]);
  });

  test("getEntriesContainingTeams dedupes duplicate sIDs in the input before chunking", async () => {
    queryGetMock.mockResolvedValue({ docs: [] });
    // 60 entries but only 5 distinct → 1 chunk of 5
    const sIDs = Array.from({ length: 60 }, () => 101);
    sIDs[10] = 102; sIDs[20] = 103; sIDs[30] = 104; sIDs[40] = 105;
    await repo.getEntriesContainingTeams(2024, sIDs);
    expect(queryGetMock).toHaveBeenCalledTimes(1);
    const arrayContainsAnyCalls = whereMock.mock.calls.filter(c => c[1] === "array-contains-any");
    expect(arrayContainsAnyCalls[0][2].sort()).toEqual([101, 102, 103, 104, 105]);
  });

  test("getEntriesForGroup sorts by entry id ascending", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("b", { id: 2, teamName: "Bob",   picks: [], totalPoints: 0, person: "Bob",   groups: ["G"] }),
        makeDoc("a", { id: 1, teamName: "Alice", picks: [], totalPoints: 0, person: "Alice", groups: ["G"] }),
      ],
    });
    const res = await repo.getEntriesForGroup(2024, "G");
    expect(whereMock).toHaveBeenCalledWith("groups", "array-contains", "G");
    expect(res.map(e => e.id)).toEqual([1, 2]);
    expect(cacheSet).toHaveBeenCalledWith("entriesForGroup_G_2024", res);
  });

  test("getAllEntries filters EXCLUDED 'Bad'-only entries, sorts by id, returns slim shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("c", { id: 3, teamName: "Drop", picks: [], totalPoints: 0, person: "C", groups: ["Bad"] }),
        makeDoc("a", { id: 1, teamName: "T1",   picks: [],  totalPoints: 0, person: "A", groups: ["G"]   }),
        makeDoc("b", { id: 2, teamName: "T2",   picks: [],  totalPoints: 0, person: "B", groups: ["G", "Bad"] }),
      ],
    });
    const entries = await repo.getAllEntries(2024);

    // EXCLUDED only filters when "Bad" is the ONLY group → id=3 dropped; id=2 has both Good + Bad so kept
    expect(entries.map(e => e.id)).toEqual([1, 2]);
    expect(cacheSet).toHaveBeenCalledWith("allEntries_2024", entries);
  });

  test("getTournamentTeams sorts by seed asc, then regionName asc", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("s1", { sID: 101, seed: 2, regionName: "South",   schoolName: "Duke",   nameNick: "Blue Devils", mascot: "BD",  points: 0, gameStatus: [] }),
        makeDoc("s2", { sID: 102, seed: 1, regionName: "Midwest", schoolName: "Kansas", nameNick: "Jayhawks",    mascot: "JH",  points: 0, gameStatus: [] }),
        makeDoc("s3", { sID: 103, seed: 1, regionName: "East",    schoolName: "Yale",   nameNick: "Bulldogs",    mascot: "BD2", points: 0, gameStatus: [] }),
      ],
    });
    const teams = await repo.getTournamentTeams(2024);
    expect(teams.map(t => t.sID)).toEqual([103, 102, 101]); // seed=1 East, seed=1 Midwest, seed=2 South
    expect(cacheSet).toHaveBeenCalledWith("allTeamNames_2024", teams, 86400);
  });

  test("getAllTournamentDetails reads games+records+regions in parallel, builds maps, caches 300s", async () => {
    queryGetMock
      .mockResolvedValueOnce({ // games
        docs: [makeDoc("g1", { gameID: 1, team1ID: 1, team2ID: 2, regionID: 7, winner: null })],
      })
      .mockResolvedValueOnce({ // schoolRecords
        docs: [makeDoc("r1", { sID: 1, seed: 5, schoolName: "Duke", nameNick: "BD", mascot: "M", regionName: "E", gameStatus: [], canonicalDocId: null })],
      })
      .mockResolvedValueOnce({ // regions
        docs: [makeDoc("rg1", { regionID: 7, regionName: "East" })],
      });

    const details = await repo.getAllTournamentDetails(2024);

    expect(details.allGames).toEqual([
      { gameID: 1, team1ID: 1, team2ID: 2, regionID: 7, winner: null, year: 2024 },
    ]);
    expect(details.activeGames[0]).toMatchObject({ gameID: 1, regionName: "East" });
    expect(details.teams[0]).toMatchObject({ sID: 1, name: "Duke", regionName: "E", isFFDoc: false });
    expect(details.regions).toEqual([{ regionID: 7, regionName: "East" }]);
    expect(cacheSet).toHaveBeenCalledWith("tournamentDetails_2024", details, 300);
  });

  test("getAllTournamentDetails marks FF schoolRecords (with canonicalDocId set) as isFFDoc", async () => {
    queryGetMock
      .mockResolvedValueOnce({ docs: [] }) // games
      .mockResolvedValueOnce({             // schoolRecords
        docs: [makeDoc("ff_x", { sID: 9999, seed: 16, canonicalDocId: "1_16" })],
      })
      .mockResolvedValueOnce({ docs: [] }); // regions

    const details = await repo.getAllTournamentDetails(2024);
    expect(details.teams[0].isFFDoc).toBe(true);
  });

  test("getEntryById returns enriched entry when found, null when missing", async () => {
    docGetMock
      .mockResolvedValueOnce({ exists: true, data: () => ({ id: 1, person: "Bob" }) })
      .mockResolvedValueOnce({ exists: false });

    expect(await repo.getEntryById(1, 2024)).toEqual({ id: 1, person: "Bob", year: 2024 });
    expect(await repo.getEntryById(99, 2024)).toBeNull();
  });

  test("updateEntry writes full payload + edited_at timestamp, normalizes groups, includes optional fields", async () => {
    await repo.updateEntry({
      year: 2024, id: 1, email: "x@y", teamName: "T",
      picks: [10], person: "P", possPoints: 50,
      groups: "G",                       // string → array
      hasPaid: true, paymentNote: "ok", payByCheck: true,
      emailSent: true,
    });

    const payload = updateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      email: "x@y", teamName: "T", picks: [10], person: "P", possPoints: 50,
      groups: ["G"], hasPaid: true, paymentNote: "ok", payByCheck: true, emailSent: true,
    });
    expect(payload.edited_at).toBeInstanceOf(Date);
    expect(invalidateCache).toHaveBeenCalledWith("entriesForGroup_");
    expect(cacheDel).toHaveBeenCalledWith("allEntries_2024");
  });

  test("updateEntry omits hasPaid/emailSent when not provided (no accidental clobbering)", async () => {
    await repo.updateEntry({
      year: 2024, id: 1, email: "x@y", teamName: "T",
      picks: [], person: "P", groups: ["G"],
    });
    const payload = updateMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty("hasPaid");
    expect(payload).not.toHaveProperty("emailSent");
  });
});

// ─── TourneyRepository ────────────────────────────────────────────────────
describe("TourneyRepository", () => {
  const repo = new TourneyRepository();

  test("getAllRegions queries year/regions ordered by __name__ and caches 24h", async () => {
    queryGetMock.mockResolvedValue({ docs: [makeDoc("1", { regionID: 1, regionName: "East" })] });

    const regions = await repo.getAllRegions(2024);

    expect(collectionMock).toHaveBeenCalledWith("regions");
    expect(orderByMock).toHaveBeenCalledWith("__name__", "asc");
    expect(regions).toEqual([{ regionID: 1, regionName: "East" }]);
    expect(cacheSet).toHaveBeenCalledWith("allRegions_2024", regions, 86400);
  });

  test("getAllRegionTypes reads top-level regionID collection orderBy regionID asc", async () => {
    queryGetMock.mockResolvedValue({ docs: [makeDoc("1", { regionID: 1, regionName: "East" })] });
    await repo.getAllRegionTypes();
    expect(collectionMock).toHaveBeenCalledWith("regionID");
    expect(orderByMock).toHaveBeenCalledWith("regionID", "asc");
  });

  test("insertRegionsForYear writes one batch.set per matched master region keyed 1..N", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("a", { regionID: 1, regionName: "East" }),
        makeDoc("b", { regionID: 2, regionName: "West" }),
      ],
    });

    await repo.insertRegionsForYear(2024, [1, 2]);

    expect(batchSetMock).toHaveBeenCalledTimes(2);
    // Doc IDs should be "1" and "2" (1-based position)
    expect(docMock).toHaveBeenCalledWith("1");
    expect(docMock).toHaveBeenCalledWith("2");
    // Payload preserves master region data
    expect(batchSetMock.mock.calls[0][1]).toEqual({ regionID: 1, regionName: "East" });
    expect(batchSetMock.mock.calls[1][1]).toEqual({ regionID: 2, regionName: "West" });
    expect(cacheDel).toHaveBeenCalledWith("tournamentDetails_2024");
  });

  test("getSchoolRecordsForYear sorts by seed then regionID and returns minimal shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("a", { sID: 1, seed: 2, regionID: 5 }),
        makeDoc("b", { sID: 2, seed: 1, regionID: 8 }),
        makeDoc("c", { sID: 3, seed: 1, regionID: 3 }),
      ],
    });
    const records = await repo.getSchoolRecordsForYear(2024);
    expect(records).toEqual([
      { sID: 3, year: 2024, seed: 1, regionID: 3 },
      { sID: 2, year: 2024, seed: 1, regionID: 8 },
      { sID: 1, year: 2024, seed: 2, regionID: 5 },
    ]);
  });

  test("deleteTournamentDoc deletes tournaments/{year}", async () => {
    await repo.deleteTournamentDoc(2024);
    expect(collectionMock).toHaveBeenCalledWith("tournaments");
    expect(docMock).toHaveBeenCalledWith("2024");
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("upsertTournamentDoc merges only the supplied options", async () => {
    await repo.upsertTournamentDoc(2024, { hasFirstFour: true });
    expect(setMock).toHaveBeenCalledWith({ year: 2024, hasFirstFour: true }, { merge: true });

    setMock.mockClear();
    await repo.upsertTournamentDoc(2024, { firstFourGameCount: 4 });
    expect(setMock).toHaveBeenCalledWith({ year: 2024, firstFourGameCount: 4 }, { merge: true });

    setMock.mockClear();
    await repo.upsertTournamentDoc(2024, {});
    expect(setMock).toHaveBeenCalledWith({ year: 2024 }, { merge: true });
  });

  test("insertFirstFourGames denormalizes school names from a single schools fetch", async () => {
    queryGetMock.mockResolvedValueOnce({
      docs: [
        makeDoc("s1", { sid: 101, name: "Alpha University",  nameNick: "Alpha" }),
        makeDoc("s2", { sid: 102, name: "Beta College",      nameNick: null    }),
      ],
    });

    await repo.insertFirstFourGames(
      [{ gameID: 64, team1ID: 101, team2ID: 102, seed: 16, nextGameID: 5, nextGameSpot: 1 }],
      2024
    );

    expect(batchSetMock).toHaveBeenCalledTimes(1);
    expect(batchSetMock.mock.calls[0][1]).toEqual({
      gameID: 64, regionID: 7, round: 0,
      team1ID: 101, team1Name: "Alpha", team1Seed: 16,
      team2ID: 102, team2Name: "Beta College", team2Seed: 16, // falls back to name when nameNick null
      winner: null, nextGameID: 5, nextGameSpot: 1,
    });
    expect(cacheDel).toHaveBeenCalledWith("tournamentDetails_2024");
  });

  test("insertFirstFourGames no-ops on empty input", async () => {
    await repo.insertFirstFourGames([], 2024);
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(batchMock).not.toHaveBeenCalled();
  });
});

// ─── TeamRepository ───────────────────────────────────────────────────────
describe("TeamRepository", () => {
  const repo = new TeamRepository();

  test("updateTeamRecordWithNulls finds record by sID and updates points=null+gameStatus=[] inside a transaction", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec", { sID: 101 })],
    });
    await repo.updateTeamRecordWithNulls(101, 2024);

    expect(whereMock).toHaveBeenCalledWith("sID", "==", 101);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ points: null, gameStatus: [] });
    expect(cacheDel).toHaveBeenCalledWith("allTeamNames_2024");
    expect(cacheDel).toHaveBeenCalledWith("tournamentDetails_2024");
  });

  test("updateTeamRecordWithNulls no-ops + skips cache bust when no records match", async () => {
    queryGetMock.mockResolvedValue({ empty: true, docs: [] });
    await repo.updateTeamRecordWithNulls(999, 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cacheDel).not.toHaveBeenCalled();
  });

  test("updateTeamRecord writes provided points + gameStatus to all matched records inside a transaction", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec1", { sID: 101 }), makeDoc("rec2", { sID: 101 })], // canonical + ff_ pair
    });
    await repo.updateTeamRecord(101, 4, ["W", "W"], 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(1, { points: 4, gameStatus: ["W", "W"] });
  });

  test("updateTeamRecord no-ops + skips cache bust when no records match", async () => {
    queryGetMock.mockResolvedValue({ empty: true, docs: [] });
    await repo.updateTeamRecord(999, 0, [], 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(cacheDel).not.toHaveBeenCalled();
  });

  test("createCanonicalSchoolRecord clones the ff_ doc into canonicalDocId inside a transaction, strips canonicalDocId field", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("ff_64_t1", {
        sID: 101, canonicalDocId: "1_16",
        schoolName: "Duke", nameNick: "Blue Devils", seed: 16, regionID: 1,
        points: null, gameStatus: ["W"],
      })],
    });

    await repo.createCanonicalSchoolRecord(101, 2024);

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith("1_16");
    const payload = setMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty("canonicalDocId");
    expect(payload).toMatchObject({
      sID: 101, schoolName: "Duke", nameNick: "Blue Devils",
      seed: 16, regionID: 1, gameStatus: ["W"],
    });
  });

  test("createCanonicalSchoolRecord no-ops if no ff_ record has canonicalDocId", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("rec", { sID: 101 /* no canonicalDocId */ })],
    });
    await repo.createCanonicalSchoolRecord(101, 2024);
    expect(setMock).not.toHaveBeenCalled();
  });

  test("deleteCanonicalSchoolRecord deletes the canonical doc inside a transaction when ff_ pair exists", async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [makeDoc("ff_64_t1", { sID: 101, canonicalDocId: "1_16" })],
    });
    await repo.deleteCanonicalSchoolRecord(101, 2024);
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(docMock).toHaveBeenCalledWith("1_16");
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("getSchoolById returns null when doc does not exist", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    expect(await repo.getSchoolById(99)).toBeNull();
  });

  test("getSchoolById returns data on hit", async () => {
    docGetMock.mockResolvedValue({ exists: true, data: () => ({ name: "Duke" }) });
    const school = await repo.getSchoolById(101);
    expect(school).toEqual({ name: "Duke" });
    expect(collectionMock).toHaveBeenCalledWith("school");
    expect(docMock).toHaveBeenCalledWith("101");
  });

  test("updateSchool writes exactly { name, mascot, nameNick, confID }", async () => {
    await repo.updateSchool({ sid: 101, name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc" });
    expect(updateMock).toHaveBeenCalledWith({
      name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc",
    });
    expect(cacheDel).toHaveBeenCalledWith("allSchools");
  });

  test("getAllSchools orders by name asc so the cached list is alphabetical for admin <select> dropdowns", async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("z", { sid: 9, name: "Zaga" }), makeDoc("a", { sid: 1, name: "Alpha" })],
    });
    await repo.getAllSchools();
    expect(orderByMock).toHaveBeenCalledWith("name", "asc");
    expect(cacheSet).toHaveBeenCalledWith("allSchools", expect.any(Array), 86400);
  });

  test("findSchoolsByName reuses the allSchools cache without a DB read", async () => {
    // Simulate a warm allSchools cache (populated earlier by e.g. getAllSchools
    // or a TourneyRepository batch method).
    cacheGet.mockImplementation((k) => k === "allSchools" ? [
      { sid: 1, name: "Duke",     mascot: "Blue Devils", nameNick: "Duke",    confID: "acc" },
      { sid: 2, name: "Kansas",   mascot: "Jayhawks",    nameNick: "Kansas",  confID: "b12" },
    ] : undefined);

    const results = await repo.findSchoolsByName("blue");

    expect(cacheGet).toHaveBeenCalledWith("allSchools");
    expect(queryGetMock).not.toHaveBeenCalled();
    expect(results).toEqual([
      { sid: 1, name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc" },
    ]);
  });

  test("findSchoolsByName matches on name/mascot/nameNick case-insensitively", async () => {
    queryGetMock.mockResolvedValue({
      docs: [
        makeDoc("1", { sid: 1, name: "Duke",     mascot: "Blue Devils", nameNick: "Duke",    confID: "acc" }),
        makeDoc("2", { sid: 2, name: "Kansas",   mascot: "Jayhawks",    nameNick: "Kansas",  confID: "b12" }),
        makeDoc("3", { sid: 3, name: "Stanford", mascot: "Cardinal",    nameNick: "Stanford", confID: "p12" }),
      ],
    });
    const results = await repo.findSchoolsByName("BLUE");
    expect(results).toEqual([
      { sid: 1, name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc" },
    ]);
  });

  test("getMaxSchoolId queries school orderBy sid desc limit 1, returns 0 when empty", async () => {
    queryGetMock.mockResolvedValueOnce({ empty: false, docs: [makeDoc("x", { sid: 42 })] });
    expect(await repo.getMaxSchoolId()).toBe(42);
    expect(orderByMock).toHaveBeenCalledWith("sid", "desc");
    expect(limitMock).toHaveBeenCalledWith(1);

    queryGetMock.mockResolvedValueOnce({ empty: true });
    expect(await repo.getMaxSchoolId()).toBe(0);
  });

  test("insertSchool bootstraps conferenceHistory from confID when not provided", async () => {
    await repo.insertSchool({ sid: 101, name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc" });
    expect(setMock).toHaveBeenCalledWith({
      sid: 101, name: "Duke", mascot: "Blue Devils", nameNick: "Duke", confID: "acc",
      conferenceHistory: [{ confID: "acc", startYear: null, endYear: null }],
    });
  });

  test("insertSchool uses provided conferenceHistory verbatim if given", async () => {
    const history = [{ confID: "ind", startYear: 1900, endYear: 1950 }];
    await repo.insertSchool({ sid: 7, name: "X", mascot: "Y", nameNick: "Z", confID: "ind", conferenceHistory: history });
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ conferenceHistory: history }));
  });

  test("deleteSchool removes the school doc by string sid", async () => {
    await repo.deleteSchool(101);
    expect(docMock).toHaveBeenCalledWith("101");
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(cacheDel).toHaveBeenCalledWith("allSchools");
  });
});

// ─── ConferenceRepository ─────────────────────────────────────────────────
describe("ConferenceRepository", () => {
  const repo = new ConferenceRepository();

  test("getAllConferences orders by name asc and returns { slug, ...data } shape", async () => {
    queryGetMock.mockResolvedValue({
      docs: [makeDoc("acc", { name: "Atlantic Coast Conference", shortName: "ACC" })],
    });
    const confs = await repo.getAllConferences();

    expect(orderByMock).toHaveBeenCalledWith("name", "asc");
    expect(confs).toEqual([
      { slug: "acc", name: "Atlantic Coast Conference", shortName: "ACC" },
    ]);
    expect(cacheSet).toHaveBeenCalledWith("allConferences", confs, 86400);
  });

  test("getConferenceBySlug returns null when doc missing", async () => {
    docGetMock.mockResolvedValue({ exists: false });
    expect(await repo.getConferenceBySlug("nope")).toBeNull();
  });

  test("getConferenceBySlug returns merged { slug: id, ...data }", async () => {
    docGetMock.mockResolvedValue({
      exists: true, id: "acc",
      data: () => ({ name: "Atlantic Coast Conference" }),
    });
    const conf = await repo.getConferenceBySlug("acc");
    expect(conf).toEqual({ slug: "acc", name: "Atlantic Coast Conference" });
  });

  test("insertConference sets defaults for division ('I') and active (true)", async () => {
    await repo.insertConference({ slug: "acc", name: "Atlantic Coast Conference", shortName: "ACC" });
    expect(setMock).toHaveBeenCalledWith({
      name: "Atlantic Coast Conference",
      shortName: "ACC",
      division: "I",
      active: true,
    });
    expect(cacheDel).toHaveBeenCalledWith("allConferences");
  });

  test("updateConference passes through all provided fields", async () => {
    await repo.updateConference("acc", { name: "ACC updated", shortName: "ACC", division: "I", active: false });
    expect(updateMock).toHaveBeenCalledWith({
      name: "ACC updated", shortName: "ACC", division: "I", active: false,
    });
  });
});
