import {
    EntryRepository,
    GameRepository,
    TeamRepository,
    TourneyRepository,
    ViewRepository,
    ConferenceRepository,
} from "../src/repositories/index.js";
import {
    createNewBracket,
    createFirstFourGames,
} from "../src/services/tourneyService.js";
import {
    updateTeamRecords,
    undoTeamRecords,
    setRepositories as setGameServiceRepositories,
} from "../src/services/gameService.js";
import {
    buildFullGridData,
    normalizeFirstFourPicks,
    setRepositories as setViewServiceRepositories,
} from "../src/services/viewService.js";
import { updatePossiblePoints, possibleRanking } from "../src/services/pointsService.js";
import {
    getUnsentEmailEntries as svcGetUnsentEmailEntries,
    markEmailsSent as svcMarkEmailsSent,
} from "../src/services/emailService.js";
import { clearAllCache } from "../src/utils/cacheUtils.js";
import { APP_CONFIG } from "../src/config/app.js";
import { db } from "../src/config/firestore.js";

// E2E V4 — prod-safe live end-to-end test.
//
// Supersedes e2e-2020 (v1) and e2e-v2. Same full-2022-bracket flow as v2, plus:
//   • 3 entries with ranking + deliberate-tie assertions (leaderboard correctness)
//   • points-pipeline idempotency (re-running recalcs must not double-count)
//   • email lifecycle (getUnsentEmailEntries → markEmailsSent)
//
// PROD SAFETY MODEL (differs from v2):
//   • Operates exclusively on reserved sentinel year 9999 — no real tournament
//     can ever exist there.
//   • Every document the test creates is tracked in a registry; teardown
//     deletes EXACTLY those documents by reference. There are NO
//     delete*ByYear() wholesale calls anywhere in this file.
//   • The guarded pre-clean inspects year 9999 before seeding. Leftovers that
//     provably match this test's own fingerprint (prior crashed run) are
//     removed; ANY foreign document aborts the run without deleting anything.
//
// Runs against the Firestore emulator by default (FIRESTORE_EMULATOR_HOST) or
// live Firestore with LIVE_E2E=true. The email-service-level assertions
// additionally need EMAIL_GROUP=E2E-V4 in the environment (the
// `npm run test:live-e2e-v4` script sets it); without it they fall back to
// repository-level assertions only.
const RUN_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const RUN_LIVE = process.env.LIVE_E2E === "true";
const RUN_E2E = RUN_EMULATOR || RUN_LIVE;

// ─── Sentinel year and test identity ────────────────────────────────────────
const YEAR = 9999;
const GROUP = "E2E-V4";              // entry group; also the EMAIL_GROUP for service-level email tests
const MARKER = "E2E-V4";             // fingerprint on every teamName/person we write
const EMAIL_PREFIX = "e2ev4";        // fingerprint on every email we write

const ENTRY_A = 999999;              // "Alpha" — strong picks
const ENTRY_B = 999996;              // "Beta"  — identical picks to Alpha (deliberate tie)
const ENTRY_C = 999998;              // "Weak"  — eliminated unique picks
const ENTRY_FF = 999997;             // temporary First Four entry

// Entity-CRUD fixtures (top-level collections; distinct from v2's so both
// suites can coexist until v2 is retired).
const CRUD_CONF_SLUG = "e2e-v4-test-conf";
const CRUD_SCHOOL_SID = 999995;
const CRUD_GROUP_NAME = "E2E-V4-CRUD-Group";
const CRUD_GROUP_ID = 999995;

// ─── 2022 bracket data seeded into year 9999 (same spec as v2) ──────────────
//
// Region layout uses the hierarchical game-ID scheme:
//   Region 1: round-1 gameIDs 1-8   (nextGame → 9-12)
//   Region 2: round-1 gameIDs 16-23 (nextGame → 24-27)
//   Region 3: round-1 gameIDs 31-38 (nextGame → 39-42)
//   Region 4: round-1 gameIDs 46-53 (nextGame → 54-57)
//
// Each pair of entries = one game:  "regionID-gameID-seed-teamID"
//
const GAMES_SPEC_2022 = [
    // ── Region 1 ──────────────────────────────────────────────────────────
    "1-1-1-67", "1-1-16-307",   // 1 vs 16
    "1-2-8-33", "1-2-9-6",      // 8 vs 9
    "1-3-5-121", "1-3-12-14",    // 5 vs 12
    "1-4-4-58", "1-4-13-103",   // 4 vs 13
    "1-5-6-78", "1-5-11-39",    // 6 vs 11
    "1-6-3-23", "1-6-14-213",   // 3 vs 14
    "1-7-7-157", "1-7-10-123",   // 7 vs 10
    "1-8-2-46", "1-8-15-223",   // 2 vs 15
    // ── Region 2 ──────────────────────────────────────────────────────────
    "2-16-1-116", "2-16-16-174",  // 1 vs 16
    "2-17-8-126", "2-17-9-82",    // 8 vs 9
    "2-18-5-1", "2-18-12-99",   // 5 vs 12
    "2-19-4-42", "2-19-13-290",  // 4 vs 13
    "2-20-6-41", "2-20-11-35",   // 6 vs 11
    "2-21-3-79", "2-21-14-327",  // 3 vs 14
    "2-22-7-17", "2-22-10-137",  // 7 vs 10
    "2-23-2-28", "2-23-15-293",  // 2 vs 15
    // ── Region 3 ──────────────────────────────────────────────────────────
    "3-31-1-55", "3-31-16-204",  // 1 vs 16
    "3-32-8-8", "3-32-9-77",    // 8 vs 9
    "3-33-5-253", "3-33-12-343",  // 5 vs 12
    "3-34-4-13", "3-34-13-243",  // 4 vs 13
    "3-35-6-127", "3-35-11-16",   // 6 vs 11
    "3-36-3-52", "3-36-14-337",  // 3 vs 14
    "3-37-7-21", "3-37-10-143",  // 7 vs 10
    "3-38-2-10", "3-38-15-185",  // 2 vs 15
    // ── Region 4 ──────────────────────────────────────────────────────────
    "4-46-1-73", "4-46-16-272",  // 1 vs 16
    "4-47-8-132", "4-47-9-3",     // 8 vs 9
    "4-48-5-15", "4-48-12-146",  // 5 vs 12
    "4-49-4-7", "4-49-13-282",  // 4 vs 13
    "4-50-6-47", "4-50-11-72",   // 6 vs 11
    "4-51-3-25", "4-51-14-237",  // 3 vs 14
    "4-52-7-63", "4-52-10-32",   // 7 vs 10
    "4-53-2-43", "4-53-15-95",   // 2 vs 15
];

const REGION_ARRAY = [1, 2, 3, 4];

// ─── First Four constants (FF game feeds into R1 game 5, seed-11 slot of region 1) ─
const FF_TEAM_A = 9901;        // canonical pick sID (team1ID — used as the pick before resolution)
const FF_TEAM_B = 9902;        // challenger (team2ID)
const FF_GAME_ID = 64;         // FF gameIDs start at 64
const FF_NEXT_GAME_ID = 5;     // R1 game 5: seed 6 (78) vs seed 11 slot
const FF_NEXT_GAME_SPOT = 2;   // spot 2 in game 5

// Every sID this test can ever write a schoolRecord for (spec teams + FF teams).
const EXPECTED_SIDS = new Set([
    ...GAMES_SPEC_2022.map((s) => Number(s.split("-")[3])),
    FF_TEAM_A,
    FF_TEAM_B,
]);

// ─── Created-document registry ──────────────────────────────────────────────
//
// Teardown deletes exactly these refs — nothing else. Docs are registered
// either explicitly (entries, CRUD fixtures) or by snapshotting the year-9999
// subcollections right after seeding (legitimate because the guarded
// pre-clean proved the year was empty before this run wrote to it).
const registry = new Map(); // path → DocumentReference

function register(ref) {
    registry.set(ref.path, ref);
}

const yearRoot = () => db.collection("tournaments").doc(String(YEAR));
const yearSub = (sub) => yearRoot().collection(sub);
const entryRef = (id) => yearSub("entries").doc(String(id));

const YEAR_SUBCOLLECTIONS = ["games", "schoolRecords", "regions", "entries"];

/** Register the root doc + every doc currently in the year-9999 subcollections. */
async function registerYearSubtree() {
    register(yearRoot());
    for (const sub of YEAR_SUBCOLLECTIONS) {
        const snap = await yearSub(sub).get();
        snap.docs.forEach((d) => register(d.ref));
    }
}

const logStep = (msg, extra = {}) => {
    const ts = new Date().toISOString();
    const safeExtra = JSON.stringify(extra, (k, v) =>
        typeof v === "bigint" ? v.toString() : v
    );
    // eslint-disable-next-line no-console
    console.log(
        `[E2E-V4][${ts}] ${msg}${safeExtra && safeExtra !== "{}" ? ` | ${safeExtra}` : ""}`
    );
};

// ─── Guarded pre-clean ──────────────────────────────────────────────────────
//
// Inspect everything under year 9999 (plus the top-level CRUD fixtures). A doc
// is "ours" only if it matches this test's fingerprint. Foreign docs abort the
// run — nothing is deleted in that case.
function isOurEntry(data) {
    const groups = Array.isArray(data.groups)
        ? data.groups
        : data.group ? [data.group] : [];
    return (
        String(data.email || "").startsWith(EMAIL_PREFIX) ||
        String(data.teamName || "").includes(MARKER) ||
        groups.some((g) => String(g).includes(MARKER))
    );
}

function classifyYearDoc(sub, doc) {
    const data = doc.data();
    switch (sub) {
        case "games": {
            const id = Number(data.gameID ?? doc.id);
            return Number.isInteger(id) && id >= 1 && id <= FF_GAME_ID;
        }
        case "schoolRecords":
            return EXPECTED_SIDS.has(Number(data.sID ?? doc.id));
        case "regions": {
            const id = Number(doc.id);
            return Number.isInteger(id) && id >= 1 && id <= 6;
        }
        case "entries":
            return isOurEntry(data);
        default:
            return false;
    }
}

async function guardedPreClean() {
    const leftovers = [];
    const foreign = [];

    for (const sub of YEAR_SUBCOLLECTIONS) {
        const snap = await yearSub(sub).get();
        for (const doc of snap.docs) {
            (classifyYearDoc(sub, doc) ? leftovers : foreign).push(doc.ref);
        }
    }

    // Root tournament doc: created by seeding with at most {year} (+ FF flags).
    const rootSnap = await yearRoot().get();
    if (rootSnap.exists) {
        const keys = Object.keys(rootSnap.data() || {});
        const allowed = new Set(["year", "hasFirstFour", "firstFourGameCount"]);
        if (keys.every((k) => allowed.has(k))) {
            leftovers.push(yearRoot());
        } else {
            foreign.push(yearRoot());
        }
    }

    // Top-level CRUD fixtures from a prior crashed run.
    const crudChecks = [
        { ref: db.collection("conferences").doc(CRUD_CONF_SLUG), ours: (d) => String(d.name || "").includes(MARKER) },
        { ref: db.collection("school").doc(String(CRUD_SCHOOL_SID)), ours: (d) => String(d.name || "").includes(MARKER) },
        { ref: db.collection("groups").doc(CRUD_GROUP_NAME), ours: () => true }, // doc ID is the fingerprint
    ];
    for (const { ref, ours } of crudChecks) {
        const snap = await ref.get();
        if (snap.exists) {
            (ours(snap.data() || {}) ? leftovers : foreign).push(ref);
        }
    }

    if (foreign.length > 0) {
        throw new Error(
            `[E2E-V4] ABORT — year ${YEAR} contains ${foreign.length} document(s) this test did not create. ` +
            `Nothing was deleted. Offending paths: ${foreign.map((r) => r.path).join(", ")}`
        );
    }

    if (leftovers.length > 0) {
        logStep("Pre-clean removing leftovers from a prior run", { count: leftovers.length });
        await deleteRefs(leftovers);
    }

    clearAllCache();
}

// ─── Registry teardown ──────────────────────────────────────────────────────

async function deleteRefs(refs) {
    const BATCH_SIZE = 400;
    for (let i = 0; i < refs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        refs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

async function registryCleanup() {
    // Delete subcollection docs before the root doc.
    const refs = [...registry.values()].sort(
        (a, b) => b.path.length - a.path.length
    );
    logStep("Teardown deleting registered docs", { count: refs.length });
    await deleteRefs(refs);
    clearAllCache();
}

async function verifyRegistryGone() {
    // Nothing registered means the guarded pre-clean aborted before any write —
    // there is nothing to verify (and the year may legitimately hold the
    // foreign data that triggered the abort).
    if (registry.size === 0) return;

    for (const ref of registry.values()) {
        const snap = await ref.get();
        if (snap.exists) {
            throw new Error(`[E2E-V4] Teardown verification failed — still exists: ${ref.path}`);
        }
    }
    for (const sub of YEAR_SUBCOLLECTIONS) {
        const snap = await yearSub(sub).get();
        if (!snap.empty) {
            throw new Error(
                `[E2E-V4] Teardown verification failed — tournaments/${YEAR}/${sub} still has ${snap.size} doc(s)`
            );
        }
    }
    logStep("Teardown verified — every registered doc is gone and year subtree is empty");
}

// ─────────────────────────────────────────────────────────────────────────────

describe(`E2E V4 — prod-safe full flow in sentinel year ${YEAR} (emulator default; LIVE_E2E=true for prod)`, () => {
    if (!RUN_E2E) {
        test("skipped (set FIRESTORE_EMULATOR_HOST or LIVE_E2E=true to run)", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const emailA = `${EMAIL_PREFIX}-alpha@example.com`;
    const teamNameA = "E2E-V4 Alpha";
    const personA = "E2E-V4 Tester Alpha";

    let entryRepo;
    let gameRepo;
    let teamRepo;
    let tourneyRepo;
    let viewRepo;
    let conferenceRepo;

    beforeAll(async () => {
        logStep("Bootstrapping repositories", { year: YEAR });

        entryRepo = new EntryRepository();
        gameRepo = new GameRepository();
        teamRepo = new TeamRepository();
        tourneyRepo = new TourneyRepository();
        viewRepo = new ViewRepository();
        conferenceRepo = new ConferenceRepository();

        setGameServiceRepositories(teamRepo, gameRepo);
        setViewServiceRepositories(viewRepo, gameRepo, entryRepo);

        logStep("Guarded pre-clean start", { year: YEAR });
        await guardedPreClean();
        logStep("Guarded pre-clean complete", { year: YEAR });
    }, 120000);

    afterAll(async () => {
        logStep("Registry teardown start", { registered: registry.size });
        await registryCleanup();
        await verifyRegistryGone();
        logStep("Registry teardown complete");
    }, 120000);

    // ───────────────────────────────────────────────────────────────────────
    test(
        "Full bracket → FF → games → 3 entries → ranking/ties → idempotency → email → CRUD → cleanup",
        async () => {

            // ── 1. Create full 2022 bracket for sentinel year ──────────────
            logStep("Creating full 2022 bracket", {
                year: YEAR, teams: 64, games: 63, specEntries: GAMES_SPEC_2022.length,
            });
            await createNewBracket(GAMES_SPEC_2022, YEAR, REGION_ARRAY);
            await registerYearSubtree();
            logStep("Bracket created and registered", { registered: registry.size });

            // ── 2. Verify shape via getAllTournamentDetails ─────────────────
            const details = await gameRepo.getAllTournamentDetails(YEAR);
            logStep("Shape received", {
                teamsCount: details.teams.length,
                allGamesCount: details.allGames.length,
                activeGamesCount: details.activeGames.length,
                regionsCount: details.regions.length,
            });
            expect(details.teams.length).toBe(64);
            expect(details.allGames.length).toBe(63);
            expect(details.activeGames.length).toBe(32); // all round-1 games have teams
            expect(details.regions.length).toBe(6); // 4 regions + Final Four + Championship

            // Verify school name denormalization worked for real 2022 teams
            const teamWithName = details.teams.find((t) => t.sID === 67);
            expect(teamWithName).toBeDefined();
            expect(teamWithName.nameNick).toBeTruthy();

            // ── 3. Bracket topology cross-check ─────────────────────────────
            // Every non-final game's nextGameID must reference a real game, and
            // nextGameSpot must be 1 or 2. Exactly one game (the championship)
            // has no next game (stored as 0 or null). Each next-game slot must
            // be fed by exactly one game.
            logStep("Cross-checking bracket topology");
            const gamesById = new Map(details.allGames.map((g) => [Number(g.gameID), g]));
            const feederCounts = new Map();
            let finalGames = 0;
            for (const g of details.allGames) {
                if (!Number(g.nextGameID)) {
                    finalGames++;
                    continue;
                }
                const next = gamesById.get(Number(g.nextGameID));
                expect(next).toBeDefined();
                expect(Number(next.round)).toBe(Number(g.round) + 1);
                expect([1, 2]).toContain(Number(g.nextGameSpot));
                const key = `${g.nextGameID}-${g.nextGameSpot}`;
                feederCounts.set(key, (feederCounts.get(key) || 0) + 1);
            }
            expect(finalGames).toBe(1); // only the championship has no next game
            for (const [key, count] of feederCounts) {
                expect(count, `next-game slot ${key} fed by more than one game`).toBe(1);
            }
            logStep("Topology verified — 63 games, consistent nextGameID/nextGameSpot links");

            // ── 4. Fetch round-1 games and confirm IDs ─────────────────────
            const allGames = await gameRepo.getActiveAndFutureGames(YEAR);
            const game1 = allGames.find((g) => Number(g.gameID) === 1);   // R1: 67 vs 307
            const game2 = allGames.find((g) => Number(g.gameID) === 2);   // R1: 33 vs 6
            const game9 = allGames.find((g) => Number(g.gameID) === 9);   // R2 (next for 1,2)

            expect(game1).toBeDefined();
            expect(Number(game1.team1ID)).toBe(67);
            expect(Number(game1.team2ID)).toBe(307);
            expect(Number(game1.round)).toBe(1);
            expect(Number(game1.nextGameID)).toBe(9);
            expect(Number(game1.nextGameSpot)).toBe(1);

            expect(game2).toBeDefined();
            expect(Number(game2.team1ID)).toBe(33);
            expect(Number(game2.team2ID)).toBe(6);
            expect(Number(game2.nextGameID)).toBe(9);
            expect(Number(game2.nextGameSpot)).toBe(2);

            expect(game9).toBeDefined();
            expect(game9.winner).toBeFalsy();
            logStep("Round-1 game structure verified");

            // ────────────────────────────────────────────────────────────────
            // ── FIRST FOUR BLOCK ─────────────────────────────────────────────
            // ────────────────────────────────────────────────────────────────

            // ── FF-1. Create First Four game (feeds into R1 game 5, spot 2) ──
            logStep("Creating First Four game", {
                team1: FF_TEAM_A, team2: FF_TEAM_B,
                nextGame: FF_NEXT_GAME_ID, nextGameSpot: FF_NEXT_GAME_SPOT,
            });
            await createFirstFourGames(
                [{ team1ID: FF_TEAM_A, team2ID: FF_TEAM_B, seed: 11, nextGameID: FF_NEXT_GAME_ID, nextGameSpot: FF_NEXT_GAME_SPOT }],
                YEAR,
                REGION_ARRAY
            );
            await registerYearSubtree(); // pick up the FF game + FF school records

            const gamesWithFF = await gameRepo.getActiveAndFutureGames(YEAR);
            const ffGame = gamesWithFF.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(ffGame).toBeDefined();
            expect(Number(ffGame.team1ID)).toBe(FF_TEAM_A);
            expect(Number(ffGame.team2ID)).toBe(FF_TEAM_B);
            expect(Number(ffGame.round)).toBe(0);
            expect(Number(ffGame.nextGameID)).toBe(FF_NEXT_GAME_ID);
            logStep("First Four game created and verified", { gameID: FF_GAME_ID });

            // ── FF-2. Create entry picking FF_TEAM_A before game resolves ────
            const ffEntryPicks = [FF_TEAM_A, 116, 55, 73, 33, 28, 10, 43, 58, 121];
            register(entryRef(ENTRY_FF));
            await entryRepo.createEntry(
                ENTRY_FF, `${EMAIL_PREFIX}-ff@example.com`, "E2E-V4 FF Entry",
                ffEntryPicks, GROUP, "E2E-V4 FF Tester", new Date(), YEAR, 320
            );
            logStep("FF entry created", { id: ENTRY_FF, picks: ffEntryPicks });

            await updatePossiblePoints(YEAR);
            const ffEntryBefore = await gameRepo.getEntryById(ENTRY_FF, YEAR);

            // No R1 games played yet → 0 current points
            expect(ffEntryBefore.totalPoints).toBe(0);
            // Future path starts at R1 game 5 (FF game adds no points, skipped by pointsService)
            // FF_TEAM_A path [5→11→14→15→61→63] = 69 pts; full entry deduplicated = 190
            expect(ffEntryBefore.possPoints).toBe(190);
            const possPointsBeforeFF = ffEntryBefore.possPoints;
            logStep("FF entry possPoints before resolution verified", {
                totalPoints: ffEntryBefore.totalPoints,
                possPoints: ffEntryBefore.possPoints,
            });

            // ── FF-3. Resolve FF game — FF_TEAM_B wins ─────────────────────
            logStep("Resolving FF game — FF_TEAM_B wins", { winner: FF_TEAM_B, loser: FF_TEAM_A });
            await updateTeamRecords(FF_TEAM_B, FF_TEAM_A, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, YEAR);

            const gamesAfterFF = await gameRepo.getActiveAndFutureGames(YEAR);
            const game5AfterFF = gamesAfterFF.find(g => Number(g.gameID) === FF_NEXT_GAME_ID);
            expect(Number(game5AfterFF.team2ID)).toBe(FF_TEAM_B);

            const allGamesAfterFF = await gameRepo.getAllTournamentDetails(YEAR);
            const ffGameDoc = allGamesAfterFF.allGames.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(Number(ffGameDoc.winner)).toBe(FF_TEAM_B);

            // Entry pick must have been auto-swapped: FF_TEAM_A → FF_TEAM_B
            const ffEntryAfterResolve = await gameRepo.getEntryById(ENTRY_FF, YEAR);
            expect(ffEntryAfterResolve.picks).toContain(FF_TEAM_B);
            expect(ffEntryAfterResolve.picks).not.toContain(FF_TEAM_A);
            logStep("FF resolution verified — pick swapped, game 5 slot updated");

            // possPoints unchanged — FF_TEAM_B now occupies the same game-5-forward path
            await updatePossiblePoints(YEAR);
            const ffEntryAfterPoints = await gameRepo.getEntryById(ENTRY_FF, YEAR);
            expect(ffEntryAfterPoints.totalPoints).toBe(0); // game 5 not yet played
            expect(ffEntryAfterPoints.possPoints).toBe(possPointsBeforeFF);

            // ── FF-4. Undo FF game ────────────────────────────────────────────
            logStep("Undoing FF game");
            // Pass team1ID like gameController.undoGame does — it selects the
            // normalize-to-combined branch (without it, the legacy fallback
            // blindly reverses the swap, which is wrong when team1 won).
            await undoTeamRecords(FF_TEAM_B, FF_TEAM_A, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, YEAR, FF_TEAM_A);

            const gamesAfterFFUndo = await gameRepo.getActiveAndFutureGames(YEAR);
            const ffGameUndone = gamesAfterFFUndo.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(ffGameUndone.winner == null).toBe(true);
            const game5AfterFFUndo = gamesAfterFFUndo.find(g => Number(g.gameID) === FF_NEXT_GAME_ID);
            expect(game5AfterFFUndo.team2ID == null || game5AfterFFUndo.team2ID === undefined).toBe(true);

            const ffEntryAfterUndo = await gameRepo.getEntryById(ENTRY_FF, YEAR);
            expect(ffEntryAfterUndo.picks).toContain(FF_TEAM_A);
            expect(ffEntryAfterUndo.picks).not.toContain(FF_TEAM_B);
            // Undo must freeze the game against the ESPN poll re-applying it
            expect(ffGameUndone.manualHold).toBe(true);
            logStep("FF undo verified — winner cleared, game 5 slot cleared, pick restored, hold set");

            // ── FF-5. Write-time normalization against live game state ──────
            // Unresolved game: either FF team submitted → combined value (team1ID)
            const normUnresolved = await normalizeFirstFourPicks([FF_TEAM_B, 116], YEAR);
            expect(normUnresolved).toEqual([FF_TEAM_A, 116]);
            logStep("normalizeFirstFourPicks (unresolved) verified — team B → combined team A");

            // ── FF-6. Re-resolve with the OPPOSITE winner (undo → repick → re-resolve) ──
            // This is the corrective-undo scenario: the combined pick must follow
            // whoever wins the re-resolution, and resolving must release the hold.
            logStep("Re-resolving FF game — FF_TEAM_A wins this time");
            await updateTeamRecords(FF_TEAM_A, FF_TEAM_B, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, YEAR);

            // Resolved games drop out of getActiveAndFutureGames (winner == null
            // filter), so read game 64 via getAllTournamentDetails — same pattern
            // as the first-resolution check above.
            const detailsAfterReResolve = await gameRepo.getAllTournamentDetails(YEAR);
            const ffGameReResolved = detailsAfterReResolve.allGames.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(Number(ffGameReResolved.winner)).toBe(FF_TEAM_A);
            expect(ffGameReResolved.manualHold).toBe(false); // resolution releases the hold
            const gamesAfterReResolve = await gameRepo.getActiveAndFutureGames(YEAR);
            const game5AfterReResolve = gamesAfterReResolve.find(g => Number(g.gameID) === FF_NEXT_GAME_ID);
            expect(Number(game5AfterReResolve.team2ID)).toBe(FF_TEAM_A);

            const ffEntryAfterReResolve = await gameRepo.getEntryById(ENTRY_FF, YEAR);
            expect(ffEntryAfterReResolve.picks).toContain(FF_TEAM_A);
            expect(ffEntryAfterReResolve.picks).not.toContain(FF_TEAM_B);

            // Resolved game: a stale submission of the LOSER normalizes to the winner
            const normResolved = await normalizeFirstFourPicks([FF_TEAM_B, 116], YEAR);
            expect(normResolved).toEqual([FF_TEAM_A, 116]);
            logStep("FF re-resolution verified — pick on winner A, slot filled, hold released, stale loser pick normalizes to winner");

            // ── FF-7. Final undo to restore the pristine pre-FF state ───────
            logStep("Final FF undo — restore combined state for the main flow");
            await undoTeamRecords(FF_TEAM_A, FF_TEAM_B, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, YEAR, FF_TEAM_A);
            const ffEntryFinal = await gameRepo.getEntryById(ENTRY_FF, YEAR);
            expect(ffEntryFinal.picks).toContain(FF_TEAM_A);
            expect(ffEntryFinal.picks).not.toContain(FF_TEAM_B);
            logStep("FF cycle complete — resolve(B) → undo → re-resolve(A) → undo, picks combined again");

            // Delete FF entry before the main flow (registry keeps the ref defensively)
            await entryRepo.deleteEntry(ENTRY_FF, YEAR);
            logStep("FF entry deleted");

            // ────────────────────────────────────────────────────────────────
            // ── PLAY ROUND-1 GAMES ──────────────────────────────────────────
            // ────────────────────────────────────────────────────────────────

            // ── 5. Play game 1: seed 1 (67) beats seed 16 (307) ───────────
            logStep("Playing game 1 — 67 beats 307", { gameID: 1 });
            await updateTeamRecords(67, 307, 1, 1, 9, 1, YEAR);

            // ── 6. Play game 2: seed 8 (33) beats seed 9 (6) ─────────────
            logStep("Playing game 2 — 33 beats 6", { gameID: 2 });
            await updateTeamRecords(33, 6, 1, 2, 9, 2, YEAR);

            // ── 7. Verify winner propagation into round-2 game 9 ──────────
            const gamesAfterPlay = await gameRepo.getActiveAndFutureGames(YEAR);
            const game9AfterPlay = gamesAfterPlay.find((g) => Number(g.gameID) === 9);
            expect(Number(game9AfterPlay.team1ID)).toBe(67);
            expect(Number(game9AfterPlay.team2ID)).toBe(33);
            logStep("Propagation verified — game 9 now has teams 67 and 33");

            // ── 8. Undo game 2 and verify rollback ────────────────────────
            logStep("Undoing game 2");
            await undoTeamRecords(33, 6, 1, 2, 9, 2, YEAR);

            const gamesAfterUndo = await gameRepo.getActiveAndFutureGames(YEAR);
            const game2AfterUndo = gamesAfterUndo.find((g) => Number(g.gameID) === 2);
            const game9AfterUndo = gamesAfterUndo.find((g) => Number(g.gameID) === 9);
            expect(game2AfterUndo.winner).toBeNull();
            expect(game2AfterUndo.manualHold).toBe(true); // undo freezes the game against the poll
            expect(game9AfterUndo.team2ID == null || game9AfterUndo.team2ID === undefined).toBe(true);
            logStep("Undo verified — game 2 winner null, hold set, game 9 team2 cleared");

            // ── 9. Play two region-2 games ─────────────────────────────────
            const game16 = gamesAfterUndo.find((g) => Number(g.gameID) === 16);
            logStep("Playing game 16 — 116 beats 174");
            await updateTeamRecords(
                116, 174, Number(game16.round), 16,
                Number(game16.nextGameID), Number(game16.nextGameSpot), YEAR
            );

            const game23 = gamesAfterUndo.find((g) => Number(g.gameID) === 23);
            logStep("Playing game 23 — 28 beats 293");
            await updateTeamRecords(
                28, 293, Number(game23.round), 23,
                Number(game23.nextGameID), Number(game23.nextGameSpot), YEAR
            );

            // ────────────────────────────────────────────────────────────────
            // ── THREE ENTRIES: Alpha, Beta (identical), Weak ────────────────
            // ────────────────────────────────────────────────────────────────

            // ── 10. Create the three entries ───────────────────────────────
            const picksStrong = [67, 116, 55, 73, 33, 28, 10, 43, 58, 121];
            // Weak entry: 307/174/293 already eliminated above → no future upside
            const picksWeak = [67, 116, 55, 73, 307, 174, 293, 10, 43, 58];

            logStep("Creating entry Alpha", { id: ENTRY_A, picks: picksStrong });
            register(entryRef(ENTRY_A));
            await entryRepo.createEntry(ENTRY_A, emailA, teamNameA, picksStrong, GROUP, personA, new Date(), YEAR, 320);

            logStep("Creating entry Beta — identical picks (deliberate tie)", { id: ENTRY_B });
            register(entryRef(ENTRY_B));
            await entryRepo.createEntry(
                ENTRY_B, `${EMAIL_PREFIX}-beta@example.com`, "E2E-V4 Beta",
                picksStrong, GROUP, "E2E-V4 Tester Beta", new Date(), YEAR, 320
            );

            logStep("Creating entry Weak — eliminated unique picks", { id: ENTRY_C, picks: picksWeak });
            register(entryRef(ENTRY_C));
            await entryRepo.createEntry(
                ENTRY_C, `${EMAIL_PREFIX}-weak@example.com`, "E2E-V4 Weak",
                picksWeak, GROUP, "E2E-V4 Tester Weak", new Date(), YEAR, 320
            );

            // ── 11. Group queries see exactly the three entries ────────────
            const groupEntries = await gameRepo.getEntriesForGroup(YEAR, GROUP);
            expect(groupEntries.length).toBe(3);
            const groupIds = groupEntries.map((e) => Number(e.id)).sort();
            expect(groupIds).toEqual([ENTRY_B, ENTRY_C, ENTRY_A].sort());
            const foundA = groupEntries.find((e) => Number(e.id) === ENTRY_A);
            expect(foundA.picks).toEqual(picksStrong);
            logStep("getEntriesForGroup verified", { ids: groupIds });

            const yearsForGroup = await gameRepo.getAllYearsForGroup(GROUP);
            expect(yearsForGroup.some(y => y.year === YEAR || y === YEAR)).toBe(true);
            logStep("getAllYearsForGroup verified");

            // ── 12. Update entry teamName ──────────────────────────────────
            await gameRepo.updateEntry({
                id: ENTRY_A,
                year: YEAR,
                email: emailA,
                teamName: `${teamNameA}-Updated`,
                picks: picksStrong,
                groups: [GROUP],
                person: personA,
            });
            const updatedEntry = await gameRepo.getEntryById(ENTRY_A, YEAR);
            expect(updatedEntry.teamName).toBe(`${teamNameA}-Updated`);
            logStep("Entry update verified");

            // ── 12b. Update entry picks directly (EntryRepository test) ────
            const newPicks = [...picksStrong.slice(0, 9), 6];
            await entryRepo.updateEntryPicks(ENTRY_A, newPicks, YEAR);
            const entryAfterPicksUpdate = await gameRepo.getEntryById(ENTRY_A, YEAR);
            expect(entryAfterPicksUpdate.picks).toEqual(newPicks);
            await entryRepo.updateEntryPicks(ENTRY_A, picksStrong, YEAR); // revert

            // ── 12c. Find entries by name (EntryRepository test) ───────────
            const searchedEntries = await entryRepo.findEntriesByName(personA, YEAR);
            expect(searchedEntries.length).toBeGreaterThan(0);
            expect(searchedEntries[0].person).toBe(personA);
            logStep("Entries by name verified");

            // ── 13. Run updatePossiblePoints and verify exact values ───────
            logStep("Running updatePossiblePoints", { year: YEAR });
            await updatePossiblePoints(YEAR);

            const entryAlpha = await gameRepo.getEntryById(ENTRY_A, YEAR);
            const entryBeta = await gameRepo.getEntryById(ENTRY_B, YEAR);
            const entryWeak = await gameRepo.getEntryById(ENTRY_C, YEAR);

            // Games played so far: 1 (67), 16 (116), 23 (28); game 2 was undone.
            // Alpha/Beta picks contain 67, 116, 28 → totalPoints = 2+2+2 = 6.
            // possPoints = 6 + deduplicated future = 182 (see e2e-v2 derivation).
            expect(entryAlpha.totalPoints).toBe(6);
            expect(entryAlpha.possPoints).toBe(182);
            expect(entryBeta.totalPoints).toBe(6);
            expect(entryBeta.possPoints).toBe(182);

            // Weak picks contain winners 67, 116 only → totalPoints = 4, and
            // its eliminated unique picks (307/174/293) cap its ceiling below
            // Alpha/Beta's.
            expect(entryWeak.totalPoints).toBe(4);
            expect(entryWeak.possPoints).toBeLessThan(entryAlpha.possPoints);
            logStep("Exact points verified", {
                alpha: { total: entryAlpha.totalPoints, poss: entryAlpha.possPoints },
                beta: { total: entryBeta.totalPoints, poss: entryBeta.possPoints },
                weak: { total: entryWeak.totalPoints, poss: entryWeak.possPoints },
            });

            // ── 14. getEntriesContainingTeams ──────────────────────────────
            const containingEntries = await gameRepo.getEntriesContainingTeams(YEAR, [67, 116]);
            const containingIds = containingEntries.map((e) => Number(e.id));
            expect(containingIds).toContain(ENTRY_A);
            expect(containingIds).toContain(ENTRY_B);
            expect(containingIds).toContain(ENTRY_C);
            logStep("getEntriesContainingTeams verified", { matchCount: containingEntries.length });

            // ── 15. buildFullGridData includes all three with correct points ─
            const gridData = await buildFullGridData(GROUP, YEAR);
            expect(Array.isArray(gridData.allTeamsWithPickCounts)).toBe(true);
            expect(gridData.allTeamsWithPickCounts.length).toBeGreaterThan(0);
            expect(gridData.groupData.length).toBe(3);
            const gridAlpha = gridData.groupData.find(e => Number(e.id) === ENTRY_A);
            const gridWeak = gridData.groupData.find(e => Number(e.id) === ENTRY_C);
            expect(gridAlpha.totalPoints).toBe(6);
            expect(gridWeak.totalPoints).toBe(4);
            logStep("buildFullGridData verified", { entries: gridData.groupData.length });

            // ── 16. RANKING + DELIBERATE TIE (new in v4) ───────────────────
            // Alpha and Beta have identical picks → neither can finish ahead
            // of the other → both rank 1 with exactly one tie. Weak's unique
            // picks are all eliminated → both Alpha and Beta beat it in every
            // scenario → rank 3 with no ties.
            logStep("Running possibleRanking — leaderboard correctness", { group: GROUP });
            const ranked = await possibleRanking(YEAR, GROUP);
            expect(ranked.length).toBe(3);

            const rankedAlpha = ranked.find((e) => Number(e.entryID) === ENTRY_A);
            const rankedBeta = ranked.find((e) => Number(e.entryID) === ENTRY_B);
            const rankedWeak = ranked.find((e) => Number(e.entryID) === ENTRY_C);

            expect(rankedAlpha.highestPlace).toBe(1);
            expect(rankedAlpha.ties).toBe(1);
            expect(rankedBeta.highestPlace).toBe(1);
            expect(rankedBeta.ties).toBe(1);
            expect(rankedWeak.highestPlace).toBe(3);
            expect(rankedWeak.ties).toBe(0);

            expect(rankedAlpha.points).toBe(6);
            expect(rankedWeak.points).toBe(4);

            // Sort order users see: highestPlace asc, then name. Alpha-Updated
            // sorts before Beta; Weak is last.
            const rankedIds = ranked.map((e) => Number(e.entryID));
            expect(rankedIds).toEqual([ENTRY_A, ENTRY_B, ENTRY_C]);
            logStep("Ranking + tie verified", {
                order: rankedIds,
                alpha: { place: rankedAlpha.highestPlace, ties: rankedAlpha.ties },
                beta: { place: rankedBeta.highestPlace, ties: rankedBeta.ties },
                weak: { place: rankedWeak.highestPlace, ties: rankedWeak.ties },
            });

            // ── 17. possPoints decreases when a picked team is eliminated ──
            // Alpha picks team 33 (alive — game 2 undone). Team 33's future
            // contribution is one unplayed R1 game = 2 pts. After 6 upsets 33,
            // those 2 pts must drop from possPoints.
            logStep("Testing possPoints decrease after elimination (6 upsets 33)");
            await updateTeamRecords(6, 33, 1, 2, 9, 2, YEAR);
            await updatePossiblePoints(YEAR);
            const alphaAfterElim = await gameRepo.getEntryById(ENTRY_A, YEAR);
            expect(alphaAfterElim.possPoints).toBe(180);
            logStep("possPoints decrease verified", { before: 182, after: alphaAfterElim.possPoints });

            // Restore: undo the upset → team 33 alive again
            await undoTeamRecords(6, 33, 1, 2, 9, 2, YEAR);

            // ── 18. POINTS-PIPELINE IDEMPOTENCY (new in v4) ────────────────
            // The daily cron recalculates points over already-resolved games.
            // Re-running the recalc must not change records or any entry's
            // points — double-counting here is the classic silent prod bug.
            logStep("Idempotency — re-running updatePossiblePoints over the same resolved games");
            await updatePossiblePoints(YEAR);
            const alphaRun1 = await gameRepo.getEntryById(ENTRY_A, YEAR);
            const weakRun1 = await gameRepo.getEntryById(ENTRY_C, YEAR);

            // Snapshot a winner's school record between recalcs — the points
            // recompute must never touch win/loss records.
            const recordsRun1 = await yearSub("schoolRecords").doc(String(67)).get();

            await updatePossiblePoints(YEAR);
            const alphaRun2 = await gameRepo.getEntryById(ENTRY_A, YEAR);
            const weakRun2 = await gameRepo.getEntryById(ENTRY_C, YEAR);
            const recordsRun2 = await yearSub("schoolRecords").doc(String(67)).get();

            expect(alphaRun2.totalPoints).toBe(alphaRun1.totalPoints);
            expect(alphaRun2.possPoints).toBe(alphaRun1.possPoints);
            expect(alphaRun2.totalPoints).toBe(6);
            expect(alphaRun2.possPoints).toBe(182);
            expect(weakRun2.totalPoints).toBe(weakRun1.totalPoints);
            expect(weakRun2.possPoints).toBe(weakRun1.possPoints);
            expect(recordsRun2.data()).toEqual(recordsRun1.data());

            // The ESPN poll's dedupe predicate: a resolved game must never be
            // matched again. Verify resolved games are excluded from the
            // unresolved set the poll matches against.
            const detailsForPoll = await gameRepo.getAllTournamentDetails(YEAR);
            const unresolved = detailsForPoll.allGames.filter((g) => g.winner == null);
            const unresolvedIds = unresolved.map((g) => Number(g.gameID));
            expect(unresolvedIds).not.toContain(1);
            expect(unresolvedIds).not.toContain(16);
            expect(unresolvedIds).not.toContain(23);
            expect(unresolvedIds).toContain(2); // undone → matchable again
            logStep("Idempotency verified — points stable, records untouched, resolved games excluded from poll matching");

            // ── 19. Multi-round progression: R1 → R2 → R3 propagation ──────
            logStep("Multi-round progression: re-playing game 2 (33 beats 6)");
            await updateTeamRecords(33, 6, 1, 2, 9, 2, YEAR);

            // Game 2 is resolved again, so it is absent from the active set —
            // read it via getAllTournamentDetails for the hold-release check.
            const detailsAfterReplay = await gameRepo.getAllTournamentDetails(YEAR);
            const game2Replayed = detailsAfterReplay.allGames.find((g) => Number(g.gameID) === 2);
            expect(game2Replayed.manualHold).toBe(false); // recording a result releases the undo hold
            const gamesBeforeR2 = await gameRepo.getActiveAndFutureGames(YEAR);
            const game9Ready = gamesBeforeR2.find((g) => Number(g.gameID) === 9);
            expect(Number(game9Ready.team1ID)).toBe(67);
            expect(Number(game9Ready.team2ID)).toBe(33);

            await updateTeamRecords(
                67, 33,
                Number(game9Ready.round), 9,
                Number(game9Ready.nextGameID), Number(game9Ready.nextGameSpot),
                YEAR,
            );
            logStep("Game 9 played — 67 beats 33 in R2");

            const gamesAfterR2 = await gameRepo.getActiveAndFutureGames(YEAR);
            const game13 = gamesAfterR2.find((g) => Number(g.gameID) === Number(game9Ready.nextGameID));
            expect(game13).toBeDefined();
            expect(Number(game13.team1ID)).toBe(67);
            logStep("R2 → R3 propagation verified");

            // Points after R2:
            //   Alpha/Beta: 67 R2 winner → 5, 33 R2 loser → 2, 116 → 2, 28 → 2 = 11
            //   Weak: 67 → 5, 116 → 2 (no 33/28 picked) = 7
            await updatePossiblePoints(YEAR);
            const alphaAfterR2 = await gameRepo.getEntryById(ENTRY_A, YEAR);
            const weakAfterR2 = await gameRepo.getEntryById(ENTRY_C, YEAR);
            expect(alphaAfterR2.totalPoints).toBe(11);
            expect(weakAfterR2.totalPoints).toBe(7);
            logStep("R2 points verified", {
                alpha: alphaAfterR2.totalPoints,
                weak: weakAfterR2.totalPoints,
            });

            // ── 20. EMAIL LIFECYCLE (new in v4) ────────────────────────────
            // All three entries were created without emailSent → all unsent.
            logStep("Email lifecycle — repository level", { group: GROUP });
            const unsent1 = await entryRepo.getUnsentEmailEntries(GROUP, YEAR);
            const unsent1Ids = unsent1.map((e) => Number(e.id)).sort();
            expect(unsent1Ids).toEqual([ENTRY_B, ENTRY_C, ENTRY_A].sort());

            // Mark two as sent → only Weak remains unsent.
            await entryRepo.markEmailsSent([ENTRY_A, ENTRY_B], YEAR);
            const unsent2 = await entryRepo.getUnsentEmailEntries(GROUP, YEAR);
            expect(unsent2.map((e) => Number(e.id))).toEqual([ENTRY_C]);
            logStep("markEmailsSent verified — Alpha and Beta no longer unsent");

            // Service level (pickNames enrichment from schoolRecords) — only
            // when the process was started with EMAIL_GROUP=E2E-V4.
            if (APP_CONFIG.tournament.emailGroup === GROUP) {
                logStep("Email lifecycle — service level (EMAIL_GROUP configured)");
                const svcUnsent = await svcGetUnsentEmailEntries(YEAR);
                expect(svcUnsent.length).toBe(1);
                expect(Number(svcUnsent[0].id)).toBe(ENTRY_C);
                // Picks enriched with real school names from schoolRecords
                expect(svcUnsent[0].pickNames.length).toBe(picksWeak.length);
                expect(svcUnsent[0].pickNames.some((n) => /^Team \d+$/.test(n) === false)).toBe(true);

                await svcMarkEmailsSent([ENTRY_C], YEAR);
                const svcUnsentAfter = await svcGetUnsentEmailEntries(YEAR);
                expect(svcUnsentAfter.length).toBe(0);
                logStep("Service-level email lifecycle verified — all marked sent");
            } else {
                await entryRepo.markEmailsSent([ENTRY_C], YEAR);
                const unsent3 = await entryRepo.getUnsentEmailEntries(GROUP, YEAR);
                expect(unsent3.length).toBe(0);
                logStep("Service-level email skipped (EMAIL_GROUP not set to E2E-V4) — repo-level all-sent verified");
            }

            // ── 21. Delete entry Alpha and verify ──────────────────────────
            logStep("Deleting entry Alpha", { id: ENTRY_A });
            await entryRepo.deleteEntry(ENTRY_A, YEAR);
            const afterDelete = await gameRepo.getEntryById(ENTRY_A, YEAR);
            expect(afterDelete == null).toBe(true);
            logStep("Entry deletion verified (Beta and Weak removed by teardown)");

            // ────────────────────────────────────────────────────────────────
            // ── ENTITY CRUD (Conferences, Schools, Groups) ──────────────────
            // ────────────────────────────────────────────────────────────────

            logStep("Starting Entity CRUD ops");

            // ── 22. Conference CRUD ─────────────────────────────────────────
            register(db.collection("conferences").doc(CRUD_CONF_SLUG));
            await conferenceRepo.insertConference({
                slug: CRUD_CONF_SLUG,
                name: "E2E-V4 Test Conference",
                shortName: "E2E4",
                division: "I",
                active: true,
            });

            const fetchedConf = await conferenceRepo.getConferenceBySlug(CRUD_CONF_SLUG);
            expect(fetchedConf).toBeDefined();
            expect(fetchedConf.name).toBe("E2E-V4 Test Conference");

            await conferenceRepo.updateConference(CRUD_CONF_SLUG, {
                name: "E2E-V4 Updated Conference",
                shortName: "E2E42",
                division: "II",
                active: false,
            });
            const updatedConf = await conferenceRepo.getConferenceBySlug(CRUD_CONF_SLUG);
            expect(updatedConf.name).toBe("E2E-V4 Updated Conference");
            expect(updatedConf.division).toBe("II");

            const allConfs = await conferenceRepo.getAllConferences();
            expect(allConfs.some(c => c.slug === CRUD_CONF_SLUG)).toBe(true);

            // ── 23. School/Team CRUD ────────────────────────────────────────
            register(db.collection("school").doc(String(CRUD_SCHOOL_SID)));
            await teamRepo.insertSchool({
                sid: CRUD_SCHOOL_SID,
                name: "E2E-V4 Test School",
                mascot: "Testers",
                nameNick: "E2E-V4 Testers",
                confID: CRUD_CONF_SLUG,
                conferenceHistory: [{ confID: CRUD_CONF_SLUG, startYear: 2020, endYear: null }],
            });

            const fetchedSchool = await teamRepo.getSchoolById(CRUD_SCHOOL_SID);
            expect(fetchedSchool.name).toBe("E2E-V4 Test School");

            await teamRepo.updateSchool({
                sid: CRUD_SCHOOL_SID,
                name: "E2E-V4 Master School",
                mascot: "Master Testers",
                nameNick: "E2E-V4 Masters",
                confID: CRUD_CONF_SLUG,
            });

            await teamRepo.updateSchoolConferenceHistory(CRUD_SCHOOL_SID, [
                { confID: CRUD_CONF_SLUG, startYear: 2020, endYear: 2021 },
                { confID: "other-conf", startYear: 2022, endYear: null },
            ]);

            const updatedSchool = await teamRepo.getSchoolById(CRUD_SCHOOL_SID);
            expect(updatedSchool.nameNick).toBe("E2E-V4 Masters");
            expect(updatedSchool.conferenceHistory.length).toBe(2);

            const searchedSchools = await teamRepo.findSchoolsByName("E2E-V4 Master");
            expect(searchedSchools.length).toBeGreaterThan(0);
            expect(searchedSchools[0].sid).toBe(CRUD_SCHOOL_SID);

            // ── 24. Group CRUD ──────────────────────────────────────────────
            register(db.collection("groups").doc(CRUD_GROUP_NAME));
            await viewRepo.addGroup(CRUD_GROUP_ID, CRUD_GROUP_NAME);

            const fetchedGroup = await viewRepo.findGroupByName(CRUD_GROUP_NAME);
            expect(fetchedGroup).toBe(CRUD_GROUP_NAME);

            const allGroups = await viewRepo.getAllGroups();
            expect(allGroups.includes(CRUD_GROUP_NAME)).toBe(true);

            logStep("Entity CRUD ops verified");
        },
        300000
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllYearsForGroup — Filter.or() disjunction smoke test (carried over from
// v2 / PR #120; its cleanup was already ID-targeted, so it moves unchanged
// apart from the reserved years/group names).
//
// Exercises BOTH disjuncts of the `Filter.or(array-contains groups, == group)`
// query against live Firestore / the emulator:
//   • a new-style entry that matches only via the `groups` array field
//   • a legacy entry that matches only via the singular `group` string field
// If the OR needed a composite index the project doesn't have, these reads
// would throw at runtime.
// ─────────────────────────────────────────────────────────────────────────────
describe("E2E V4 — getAllYearsForGroup Filter.or() over groups + legacy group", () => {
    if (!RUN_E2E) {
        test("skipped (set FIRESTORE_EMULATOR_HOST or LIVE_E2E=true to run)", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const gameRepo = new GameRepository();

    // Reserved years/groups — never overlap with real data.
    const NEW_YEAR = 9988;        // entry stored with the new `groups` array field
    const LEGACY_YEAR = 9989;     // entry stored with the legacy singular `group` field
    const NEW_GROUP = "E2E-V4-FilterOr-New";
    const LEGACY_GROUP = "E2E-V4-FilterOr-Legacy";
    const ABSENT_GROUP = "E2E-V4-FilterOr-Absent";

    const cleanup = async () => {
        for (const y of [NEW_YEAR, LEGACY_YEAR]) {
            try { await db.collection("tournaments").doc(String(y)).collection("entries").doc("1").delete(); } catch { /* best-effort */ }
            try { await db.collection("tournaments").doc(String(y)).delete(); } catch { /* best-effort */ }
        }
        clearAllCache(); // getAllYearsForGroup caches per-group for 365 days
    };

    beforeAll(async () => {
        await cleanup();

        // Root tournament docs so getAllYearsForGroup's tournaments scan sees these years.
        await db.collection("tournaments").doc(String(NEW_YEAR)).set({ year: NEW_YEAR });
        await db.collection("tournaments").doc(String(LEGACY_YEAR)).set({ year: LEGACY_YEAR });

        // New-style entry — matchable only through the `groups` array disjunct.
        await db.collection("tournaments").doc(String(NEW_YEAR)).collection("entries").doc("1").set({
            id: 1, email: "e2ev4-filteror@example.com", teamName: "E2E-V4 FilterOr New",
            picks: [], groups: [NEW_GROUP], person: "E2E-V4 FilterOr", totalPoints: 0, possPoints: 0,
        });

        // Legacy entry — singular `group` string, no `groups` array. Written
        // directly because createEntry always stores the new `groups` form.
        await db.collection("tournaments").doc(String(LEGACY_YEAR)).collection("entries").doc("1").set({
            id: 1, email: "e2ev4-filteror@example.com", teamName: "E2E-V4 FilterOr Legacy",
            picks: [], group: LEGACY_GROUP, person: "E2E-V4 FilterOr", totalPoints: 0, possPoints: 0,
        });

        clearAllCache();
    }, 60000);

    afterAll(cleanup, 60000);

    test("matches the new `groups` array-contains disjunct", async () => {
        const years = await gameRepo.getAllYearsForGroup(NEW_GROUP);
        expect(years.some((y) => y.year === NEW_YEAR)).toBe(true);
    });

    test("matches the legacy `group` == disjunct (Filter.or covers both fields)", async () => {
        const years = await gameRepo.getAllYearsForGroup(LEGACY_GROUP);
        expect(years.some((y) => y.year === LEGACY_YEAR)).toBe(true);
    });

    test("a group with no entries matches neither reserved year", async () => {
        const years = await gameRepo.getAllYearsForGroup(ABSENT_GROUP);
        expect(years.some((y) => y.year === NEW_YEAR || y.year === LEGACY_YEAR)).toBe(false);
    });
});
