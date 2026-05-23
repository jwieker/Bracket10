
import { fetchCompletedTournamentGames, fetchScheduledTournamentGames, getDateStrDaysAgo } from "../src/services/espnService.js";

function makeEvent({ completed = true, id = "123", competitors = null } = {}) {
  const defaultCompetitors = [
    { winner: true, team: { displayName: "Duke" } },
    { winner: false, team: { displayName: "Kansas" } },
  ];
  return {
    id,
    status: { type: { completed } },
    competitions: [{ competitors: competitors ?? defaultCompetitors }],
  };
}

function mockFetch(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

// ---------------------------------------------------------------------------
// fetchCompletedTournamentGames
// ---------------------------------------------------------------------------

describe("fetchCompletedTournamentGames", () => {
  test("returns completed games mapped to the expected shape", async () => {
    mockFetch({ events: [makeEvent({ id: "42" })] });

    const result = await fetchCompletedTournamentGames("20240321");

    expect(result).toEqual([
      {
        espnEventId: "42",
        team1DisplayName: "Duke",
        team2DisplayName: "Kansas",
        winnerDisplayName: "Duke",
      },
    ]);
  });

  test("includes the dateStr in the fetch URL", async () => {
    mockFetch({ events: [] });

    await fetchCompletedTournamentGames("20240321");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("dates=20240321"),
      expect.any(Object)
    );
  });

  test("skips events that are not completed", async () => {
    mockFetch({
      events: [makeEvent({ completed: false }), makeEvent({ id: "99" })],
    });

    const result = await fetchCompletedTournamentGames("20240321");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("99");
  });

  test("skips events with no competition", async () => {
    const eventNoComp = { id: "1", status: { type: { completed: true } }, competitions: [] };
    mockFetch({ events: [eventNoComp, makeEvent({ id: "2" })] });

    const result = await fetchCompletedTournamentGames("20240321");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("2");
  });

  test("skips events with != 2 competitors", async () => {
    const oneCompetitor = [{ winner: true, team: { displayName: "Duke" } }];
    mockFetch({
      events: [makeEvent({ id: "1", competitors: oneCompetitor }), makeEvent({ id: "2" })],
    });

    const result = await fetchCompletedTournamentGames("20240321");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("2");
  });

  test("skips events where no competitor has winner=true", async () => {
    const noWinner = [
      { winner: false, team: { displayName: "Duke" } },
      { winner: false, team: { displayName: "Kansas" } },
    ];
    mockFetch({
      events: [makeEvent({ id: "1", competitors: noWinner }), makeEvent({ id: "2" })],
    });

    const result = await fetchCompletedTournamentGames("20240321");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("2");
  });

  test("returns empty array when events is empty", async () => {
    mockFetch({ events: [] });
    const result = await fetchCompletedTournamentGames("20240321");
    expect(result).toEqual([]);
  });

  test("returns empty array when events is missing from response", async () => {
    mockFetch({});
    const result = await fetchCompletedTournamentGames("20240321");
    expect(result).toEqual([]);
  });

  test("throws when ESPN returns a non-ok HTTP status", async () => {
    mockFetch({}, { ok: false, status: 503 });

    await expect(fetchCompletedTournamentGames("20240321")).rejects.toThrow(
      "ESPN API returned HTTP 503"
    );
  });

  test("throws when fetch itself rejects (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(fetchCompletedTournamentGames("20240321")).rejects.toThrow("Network error");
  });

  test("uses today's date when no dateStr is provided", async () => {
    mockFetch({ events: [] });

    await fetchCompletedTournamentGames();

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toMatch(/dates=\d{8}/);
  });
});

// ---------------------------------------------------------------------------
// fetchScheduledTournamentGames
// ---------------------------------------------------------------------------

function makeScheduledEvent({ completed = false, id = "200", competitors = null } = {}) {
  const defaultCompetitors = [
    { winner: completed ? true : false, team: { displayName: "Duke" }, curatedRank: { current: 5 } },
    { winner: false, team: { displayName: "Kansas" }, curatedRank: { current: 12 } },
  ];
  return {
    id,
    status: { type: { completed } },
    competitions: [{ competitors: competitors ?? defaultCompetitors }],
  };
}

describe("fetchScheduledTournamentGames", () => {
  test("returns all games regardless of completed status", async () => {
    mockFetch({
      events: [
        makeScheduledEvent({ id: "1", completed: false }),
        makeScheduledEvent({ id: "2", completed: true }),
      ],
    });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result).toHaveLength(2);
  });

  test("returns correct shape with seeds and completed flag", async () => {
    mockFetch({ events: [makeScheduledEvent({ id: "42", completed: true })] });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result[0]).toEqual({
      espnEventId: "42",
      team1DisplayName: "Duke",
      team2DisplayName: "Kansas",
      team1Seed: 5,
      team2Seed: 12,
      completed: true,
      winnerDisplayName: "Duke",
      regionName: null,
    });
  });

  test("winnerDisplayName is null for incomplete games", async () => {
    mockFetch({ events: [makeScheduledEvent({ completed: false })] });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result[0].completed).toBe(false);
    expect(result[0].winnerDisplayName).toBeNull();
  });

  test("seed is null when curatedRank is missing", async () => {
    const competitors = [
      { winner: false, team: { displayName: "Duke" } },
      { winner: false, team: { displayName: "Kansas" } },
    ];
    mockFetch({ events: [makeScheduledEvent({ competitors })] });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result[0].team1Seed).toBeNull();
    expect(result[0].team2Seed).toBeNull();
  });

  test("includes the dateStr in the fetch URL", async () => {
    mockFetch({ events: [] });

    await fetchScheduledTournamentGames("20260317");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("dates=20260317"),
      expect.any(Object)
    );
  });

  test("skips events with no competition", async () => {
    const eventNoComp = { id: "1", status: { type: { completed: false } }, competitions: [] };
    mockFetch({ events: [eventNoComp, makeScheduledEvent({ id: "2" })] });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("2");
  });

  test("skips events with != 2 competitors", async () => {
    const oneCompetitor = [{ winner: false, team: { displayName: "Duke" }, curatedRank: { current: 1 } }];
    mockFetch({
      events: [makeScheduledEvent({ id: "1", competitors: oneCompetitor }), makeScheduledEvent({ id: "2" })],
    });

    const result = await fetchScheduledTournamentGames("20260317");

    expect(result).toHaveLength(1);
    expect(result[0].espnEventId).toBe("2");
  });

  test("returns empty array when events is empty", async () => {
    mockFetch({ events: [] });
    const result = await fetchScheduledTournamentGames("20260317");
    expect(result).toEqual([]);
  });

  test("throws when ESPN returns a non-ok HTTP status", async () => {
    mockFetch({}, { ok: false, status: 503 });

    await expect(fetchScheduledTournamentGames("20260317")).rejects.toThrow(
      "ESPN API returned HTTP 503"
    );
  });

  test("throws when fetch itself rejects (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(fetchScheduledTournamentGames("20260317")).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// getDateStrDaysAgo
// ---------------------------------------------------------------------------

describe("getDateStrDaysAgo", () => {
  test("returns a string in YYYYMMDD format", () => {
    const result = getDateStrDaysAgo(0);
    expect(result).toMatch(/^\d{8}$/);
  });

  test("daysAgo=0 and daysAgo=1 differ by one day", () => {
    const today = getDateStrDaysAgo(0);
    const yesterday = getDateStrDaysAgo(1);

    const todayDate = new Date(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`);
    const yesterdayDate = new Date(
      `${yesterday.slice(0, 4)}-${yesterday.slice(4, 6)}-${yesterday.slice(6, 8)}`
    );

    const diffMs = todayDate - yesterdayDate;
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });

  test("daysAgo=7 is earlier than daysAgo=0", () => {
    const today = getDateStrDaysAgo(0);
    const weekAgo = getDateStrDaysAgo(7);
    expect(weekAgo < today).toBe(true);
  });
});
