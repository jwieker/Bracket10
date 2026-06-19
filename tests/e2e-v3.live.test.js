import {
    EntryRepository,
    GameRepository,
    TeamRepository,
    TourneyRepository,
    ConferenceRepository,
} from "../src/repositories/index.js";
import { createNewBracket } from "../src/services/tourneyService.js";
import {
    setRepositories as setGameServiceRepositories,
    undoTeamRecords,
} from "../src/services/gameService.js";
import { runEspnPoll } from "../src/services/pollService.js";
import { updatePossiblePoints } from "../src/services/pointsService.js";
import { cacheGet, cacheSet, clearAllCache } from "../src/utils/cacheUtils.js";
import { db } from "../src/config/firestore.js";

// Mock only the ESPN HTTP layer — Firestore ops remain live.
// vi.hoisted ensures the mock ref exists before vi.mock is evaluated.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../src/services/espnService.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fetchCompletedTournamentGames: fetchMock,
        getDateStrDaysAgo: vi.fn().mockReturnValue("20260607"),
    };
});

const RUN_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const RUN_LIVE = process.env.LIVE_E2E === "true";
const RUN_E2E = RUN_EMULATOR || RUN_LIVE;

// ─── Reserved test constants — never overlap with real data ───────────────────
const ESPN_YEAR = 9997;          // reserved for ESPN poll tests
const ESPN_ENTRY_ID = 999990;
const CACHE_SCHOOL_SID = 999993; // reserved for cache invalidation tests
const CONF_SCHOOL_SID_A = 999994;
const CONF_SCHOOL_SID_B = 999995;
const CONF_SLUG_A = "e2e-v3-conf-a";
const CONF_SLUG_B = "e2e-v3-conf-b";

// 2-game bracket using teams whose display names exist in espnTeamMap.json:
//   Gonzaga Bulldogs = 116,  Duke Blue Devils = 28
//   Kansas Jayhawks  = 73,   Arizona Wildcats = 55
const ESPN_GAMES_SPEC = [
    "1-1-1-116",  "1-1-16-28", // game 1: Gonzaga (seed 1) vs Duke (seed 16)
    "1-2-8-73",   "1-2-9-55",  // game 2: Kansas (seed 8) vs Arizona (seed 9)
];
const ESPN_REGION_ARRAY = [1];
// Entry picks — includes Gonzaga (116) so it earns points when game 1 resolves
const ESPN_ENTRY_PICKS = [116, 73, 28, 55, 67, 307, 33, 6, 46, 52];

describe("E2E V3 — ESPN poll, cache invalidation, conference history, validation", () => {
    if (!RUN_E2E) {
        test("skipped (set FIRESTORE_EMULATOR_HOST or LIVE_E2E=true to run)", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const logStep = (msg, extra = {}) => {
        const ts = new Date().toISOString();
        const safeExtra = JSON.stringify(extra, (k, v) =>
            typeof v === "bigint" ? v.toString() : v
        );
        // eslint-disable-next-line no-console
        console.log(
            `[E2E-V3][${ts}] ${msg}${safeExtra && safeExtra !== "{}" ? ` | ${safeExtra}` : ""}`
        );
    };

    // ── Shared repo instances ─────────────────────────────────────────────────
    let entryRepo, gameRepo, teamRepo, tourneyRepo, conferenceRepo;

    beforeAll(() => {
        entryRepo = new EntryRepository();
        gameRepo = new GameRepository();
        teamRepo = new TeamRepository();
        tourneyRepo = new TourneyRepository();
        conferenceRepo = new ConferenceRepository();
        setGameServiceRepositories(teamRepo, gameRepo);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ESPN POLL FLOW
    // ─────────────────────────────────────────────────────────────────────────
    describe("ESPN poll flow (year 9997)", () => {
        beforeAll(async () => {
            logStep("ESPN pre-clean", { year: ESPN_YEAR });
            await preCleanEspnYear(ESPN_YEAR, gameRepo, tourneyRepo, entryRepo);

            logStep("Seeding 2-game bracket for ESPN tests", { year: ESPN_YEAR });
            await createNewBracket(ESPN_GAMES_SPEC, ESPN_YEAR, ESPN_REGION_ARRAY);

            await entryRepo.createEntry(
                ESPN_ENTRY_ID,
                "e2ev3-espn@example.com",
                "E2E-V3 ESPN Entry",
                ESPN_ENTRY_PICKS,
                "E2E-V3-ESPN-Group",
                "E2E-V3 ESPN Tester",
                new Date(),
                ESPN_YEAR,
                320,
            );
            logStep("ESPN setup complete", { entryId: ESPN_ENTRY_ID });
        }, 60000);

        afterAll(async () => {
            logStep("ESPN post-clean", { year: ESPN_YEAR });
            await preCleanEspnYear(ESPN_YEAR, gameRepo, tourneyRepo, entryRepo);
        }, 60000);

        beforeEach(() => {
            fetchMock.mockReset();
        });

        test("single game resolved via poll — updates DB and entry points", async () => {
            fetchMock.mockResolvedValueOnce([{
                espnEventId: "v3-single-1",
                team1DisplayName: "Gonzaga Bulldogs",
                team2DisplayName: "Duke Blue Devils",
                winnerDisplayName: "Gonzaga Bulldogs",
            }]);

            const summary = await runEspnPoll(ESPN_YEAR, { dryRun: false, dateStr: "20260607" });

            // Always undo regardless of assertion outcome so subsequent tests
            // see game 1 as unresolved. The undo runs in finally before any
            // thrown AssertionError propagates.
            try {
                expect(summary.updated).toBe(1);
                expect(summary.skipped).toBe(0);
                expect(summary.unmapped).toHaveLength(0);

                const games = await gameRepo.getActiveAndFutureGames(ESPN_YEAR);
                // game 1 is now resolved — getActiveAndFutureGames returns only winner==null rows
                const unresolvedGame1 = games.find(g => Number(g.gameID) === 1);
                expect(unresolvedGame1).toBeUndefined();

                // updatePointsForAffectedEntries (called internally by the poll) recalculates
                // possPoints but does not write totalPoints on its own — that requires an
                // explicit updatePossiblePoints call, matching the pattern used by e2e-v4.
                await updatePossiblePoints(ESPN_YEAR);
                const entry = await gameRepo.getEntryById(ESPN_ENTRY_ID, ESPN_YEAR);
                expect(entry.totalPoints).toBeGreaterThan(0);
                logStep("Single-game poll verified", { totalPoints: entry.totalPoints });
            } finally {
                await undoTeamRecords(116, 28, 1, 1, 9, 1, ESPN_YEAR);
                // undoTeamRecords sets manualHold=true so the live poll can't
                // re-resolve on the same ESPN feed, but subsequent tests in this
                // file need the game to be poll-resolvable again. Clear it here.
                await gameRepo.setGameManualHold('1', false, ESPN_YEAR);
                logStep("Game 1 undone — restored to unresolved for next tests");
            }
        });

        test("dry-run reports matched games but does not write to DB", async () => {
            fetchMock.mockResolvedValueOnce([{
                espnEventId: "v3-dry-1",
                team1DisplayName: "Kansas Jayhawks",
                team2DisplayName: "Arizona Wildcats",
                winnerDisplayName: "Kansas Jayhawks",
            }]);

            const summary = await runEspnPoll(ESPN_YEAR, { dryRun: true, dateStr: "20260607" });

            // `updated` counts matched games regardless of dryRun — it reflects
            // games that would have been written, not actual DB writes.
            expect(summary.updated).toBe(1);

            // Game 2 must still be unresolved — dry-run never writes
            const games = await gameRepo.getActiveAndFutureGames(ESPN_YEAR);
            const game2 = games.find(g => Number(g.gameID) === 2);
            expect(game2).toBeDefined();
            expect(game2.winner == null).toBe(true);
            logStep("Dry-run verified — game 2 still unresolved");
        });

        test("unmapped team name is logged and poll continues for mapped games", async () => {
            fetchMock.mockResolvedValueOnce([
                {
                    espnEventId: "v3-unmapped-1",
                    team1DisplayName: "Unknown Team Alpha",
                    team2DisplayName: "Unknown Team Beta",
                    winnerDisplayName: "Unknown Team Alpha",
                },
                {
                    espnEventId: "v3-unmapped-2",
                    team1DisplayName: "Gonzaga Bulldogs",
                    team2DisplayName: "Duke Blue Devils",
                    winnerDisplayName: "Gonzaga Bulldogs",
                },
            ]);

            const summary = await runEspnPoll(ESPN_YEAR, { dryRun: true, dateStr: "20260607" });

            expect(summary.unmapped).toContain("Unknown Team Alpha");
            expect(summary.unmapped).toContain("Unknown Team Beta");
            // Gonzaga/Duke still matched (dry-run)
            expect(summary.updated).toBe(1);
            logStep("Unmapped team handling verified", { unmapped: summary.unmapped });
        });

        test("multiple games resolved in a single poll call", async () => {
            fetchMock.mockResolvedValueOnce([
                {
                    espnEventId: "v3-multi-1",
                    team1DisplayName: "Gonzaga Bulldogs",
                    team2DisplayName: "Duke Blue Devils",
                    winnerDisplayName: "Gonzaga Bulldogs",
                },
                {
                    espnEventId: "v3-multi-2",
                    team1DisplayName: "Kansas Jayhawks",
                    team2DisplayName: "Arizona Wildcats",
                    winnerDisplayName: "Kansas Jayhawks",
                },
            ]);

            const summary = await runEspnPoll(ESPN_YEAR, { dryRun: false, dateStr: "20260607" });

            try {
                expect(summary.updated).toBe(2);
                expect(summary.skipped).toBe(0);
                expect(summary.unmapped).toHaveLength(0);

                // Both games resolved — neither appears in the active (unresolved) list
                const remaining = await gameRepo.getActiveAndFutureGames(ESPN_YEAR);
                const game1Unresolved = remaining.find(g => Number(g.gameID) === 1);
                const game2Unresolved = remaining.find(g => Number(g.gameID) === 2);
                expect(game1Unresolved).toBeUndefined();
                expect(game2Unresolved).toBeUndefined();
                logStep("Multi-game poll verified", { updated: summary.updated });
            } finally {
                await undoTeamRecords(116, 28, 1, 1, 0, 0, ESPN_YEAR);
                await undoTeamRecords(73, 55, 1, 2, 0, 0, ESPN_YEAR);
                logStep("Games 1 and 2 undone");
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CACHE INVALIDATION
    // ─────────────────────────────────────────────────────────────────────────
    describe("cache invalidation (live Firestore reads/writes)", () => {
        afterAll(async () => {
            try { await teamRepo.deleteSchool(CACHE_SCHOOL_SID); } catch { /* best-effort */ }
            clearAllCache();
            logStep("Cache test cleanup complete");
        }, 30000);

        beforeEach(() => {
            clearAllCache();
        });

        test("getAllSchools() result is stored in cache after first call", async () => {
            expect(cacheGet("allSchools")).toBeUndefined(); // cold start
            await teamRepo.getAllSchools();
            expect(cacheGet("allSchools")).toBeDefined();
            logStep("allSchools cache hit verified");
        });

        test("insertSchool() busts allSchools cache — new school visible on next call", async () => {
            await teamRepo.getAllSchools(); // prime cache
            expect(cacheGet("allSchools")).toBeDefined();

            await teamRepo.insertSchool({
                sid: CACHE_SCHOOL_SID,
                name: "E2E-V3 Cache School",
                mascot: "Cachers",
                nameNick: "V3 Cachers",
                confID: null,
                conferenceHistory: [],
            });

            // insertSchool must have called cacheDel('allSchools')
            expect(cacheGet("allSchools")).toBeUndefined();

            // Fresh fetch must include the new school
            const fresh = await teamRepo.getAllSchools();
            expect(fresh.some(s => Number(s.sid) === CACHE_SCHOOL_SID)).toBe(true);
            logStep("insertSchool cache bust verified", { sid: CACHE_SCHOOL_SID });
        });

        test("TTL expiry — cacheGet returns undefined after TTL elapses", () => {
            vi.useFakeTimers();
            try {
                cacheSet("e2e-v3-ttl", "hello", 1); // 1-second TTL
                expect(cacheGet("e2e-v3-ttl")).toBe("hello");
                vi.advanceTimersByTime(1500); // advance past TTL
                expect(cacheGet("e2e-v3-ttl")).toBeUndefined();
            } finally {
                vi.useRealTimers(); // always restore — Firestore needs real timers
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. CONFERENCE HISTORY MIGRATIONS
    // ─────────────────────────────────────────────────────────────────────────
    describe("conference history migrations (global school/conference docs)", () => {
        beforeAll(async () => {
            await conferenceRepo.insertConference({
                slug: CONF_SLUG_A,
                name: "E2E-V3 Conference A",
                shortName: "V3A",
                division: "I",
                active: true,
            });
            await conferenceRepo.insertConference({
                slug: CONF_SLUG_B,
                name: "E2E-V3 Conference B",
                shortName: "V3B",
                division: "I",
                active: true,
            });
            logStep("Test conferences inserted", { slugA: CONF_SLUG_A, slugB: CONF_SLUG_B });
        }, 30000);

        afterAll(async () => {
            // Schools must be deleted by SID — only reserved test range
            for (const sid of [CONF_SCHOOL_SID_A, CONF_SCHOOL_SID_B]) {
                try { await teamRepo.deleteSchool(sid); } catch { /* best-effort */ }
            }
            // Conferences deleted by slug — only e2e-v3-* slugs
            try { await db.collection("conferences").doc(CONF_SLUG_A).delete(); } catch { /* best-effort */ }
            try { await db.collection("conferences").doc(CONF_SLUG_B).delete(); } catch { /* best-effort */ }
            logStep("Conference history afterAll cleanup complete");
        }, 30000);

        test("insertSchool stores conferenceHistory as provided", async () => {
            await teamRepo.insertSchool({
                sid: CONF_SCHOOL_SID_A,
                name: "E2E-V3 School A",
                mascot: "Founders",
                nameNick: "V3A",
                confID: CONF_SLUG_A,
                conferenceHistory: [{ confID: CONF_SLUG_A, startYear: null, endYear: null }],
            });

            const fetched = await teamRepo.getSchoolById(CONF_SCHOOL_SID_A);
            expect(fetched).toBeDefined();
            expect(fetched.confID).toBe(CONF_SLUG_A);
            expect(fetched.conferenceHistory).toHaveLength(1);
            expect(fetched.conferenceHistory[0].confID).toBe(CONF_SLUG_A);
            expect(fetched.conferenceHistory[0].startYear).toBeNull();
            logStep("School A conference history bootstrapped", { sid: CONF_SCHOOL_SID_A });
        });

        test("updateSchoolConferenceHistory replaces the full history array", async () => {
            const newHistory = [
                { confID: CONF_SLUG_A, startYear: 2010, endYear: 2022 },
                { confID: CONF_SLUG_B, startYear: 2022, endYear: null },
            ];
            await teamRepo.updateSchoolConferenceHistory(CONF_SCHOOL_SID_A, newHistory);

            const fetched = await teamRepo.getSchoolById(CONF_SCHOOL_SID_A);
            expect(fetched.conferenceHistory).toHaveLength(2);
            expect(fetched.conferenceHistory[0]).toMatchObject({ confID: CONF_SLUG_A, startYear: 2010, endYear: 2022 });
            expect(fetched.conferenceHistory[1]).toMatchObject({ confID: CONF_SLUG_B, startYear: 2022, endYear: null });
            logStep("Conference history array replaced", { sid: CONF_SCHOOL_SID_A });
        });

        test("full realignment flow — school moves to new conference", async () => {
            await teamRepo.insertSchool({
                sid: CONF_SCHOOL_SID_B,
                name: "E2E-V3 School B",
                mascot: "Migrators",
                nameNick: "V3B",
                confID: CONF_SLUG_A,
                conferenceHistory: [{ confID: CONF_SLUG_A, startYear: 2020, endYear: null }],
            });

            // Realign: close conf-a, open conf-b
            await teamRepo.updateSchool({
                sid: CONF_SCHOOL_SID_B,
                name: "E2E-V3 School B",
                mascot: "Migrators",
                nameNick: "V3B",
                confID: CONF_SLUG_B,
            });
            await teamRepo.updateSchoolConferenceHistory(CONF_SCHOOL_SID_B, [
                { confID: CONF_SLUG_A, startYear: 2020, endYear: 2025 },
                { confID: CONF_SLUG_B, startYear: 2025, endYear: null },
            ]);

            const fetched = await teamRepo.getSchoolById(CONF_SCHOOL_SID_B);
            expect(fetched.confID).toBe(CONF_SLUG_B);
            expect(fetched.conferenceHistory).toHaveLength(2);
            expect(fetched.conferenceHistory[1].confID).toBe(CONF_SLUG_B);
            logStep("Full realignment flow verified", { sid: CONF_SCHOOL_SID_B });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. INPUT VALIDATION (throws before any DB access)
    // ─────────────────────────────────────────────────────────────────────────
    describe("input validation — errors thrown before DB access", () => {
        test("createNewBracket rejects odd-length gamesData", async () => {
            // 1 entry is odd — cannot form any pairs
            await expect(
                createNewBracket(["1-1-1-67"], ESPN_YEAR, [1])
            ).rejects.toThrow();
        });

        test("createNewBracket rejects > 64 entries (> 32 R1 pairs)", async () => {
            const oversized = Array.from({ length: 66 }, (_, i) => `1-${i + 1}-1-67`);
            await expect(
                createNewBracket(oversized, ESPN_YEAR, [1])
            ).rejects.toThrow();
        });

        test("undoTeamRecords rejects an invalid round number", async () => {
            await expect(
                undoTeamRecords(116, 28, 99, 1, 9, 1, ESPN_YEAR)
            ).rejects.toThrow(/invalid round/i);
        });
    });
});

// ─── Cleanup helper — only touches year-scoped data for reserved test years ──

async function preCleanEspnYear(year, gameRepo, tourneyRepo, entryRepo) {
    // eslint-disable-next-line no-console
    console.log(`[E2E-V3] preCleanEspnYear starting for ${year}`);

    try {
        const all = await gameRepo.getAllEntries(year);
        const e2e = all.filter((e) =>
            String(e.teamName).includes("E2E-V3") ||
            String(e.email).includes("e2ev3") ||
            (Array.isArray(e.groups)
                ? e.groups.some((g) => String(g).includes("E2E-V3"))
                : String(e.group).includes("E2E-V3"))
        );
        for (const entry of e2e) {
            await entryRepo.deleteEntry(Number(entry.id), year);
        }
        // eslint-disable-next-line no-console
        console.log(`[E2E-V3] Deleted ${e2e.length} e2e-v3 entries for year ${year}`);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V3] Entry cleanup warning:", err.message);
    }

    try {
        if (typeof gameRepo.deleteGamesByYear === "function") {
            await gameRepo.deleteGamesByYear(year);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V3] Games cleanup warning:", err.message);
    }

    try {
        if (typeof gameRepo.deleteSchoolRecordsByYear === "function") {
            await gameRepo.deleteSchoolRecordsByYear(year);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V3] SchoolRecords cleanup warning:", err.message);
    }

    try {
        if (typeof tourneyRepo.deleteRegionsByYear === "function") {
            await tourneyRepo.deleteRegionsByYear(year);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V3] Regions cleanup warning:", err.message);
    }

    try {
        await db.collection("tournaments").doc(String(year)).delete();
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V3] Root tournament cleanup warning:", err);
    }

    // eslint-disable-next-line no-console
    console.log(`[E2E-V3] preCleanEspnYear finished for ${year}`);
}
