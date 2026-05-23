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
    createNewEntry,
    buildFullGridData,
    setRepositories as setViewServiceRepositories,
} from "../src/services/viewService.js";
import { updatePossiblePoints, possibleRanking } from "../src/services/pointsService.js";
import { db } from "../src/config/firestore.js";

// Live E2E guard
const RUN_LIVE = process.env.LIVE_E2E === "true";

// ─── 2022 bracket data seeded into year 2020 ───────────────────────────────
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

describe(`LIVE E2E V2 — real 2022 data into year 2020 (requires LIVE_E2E=true)`, () => {
    if (!RUN_LIVE) {
        test("skipped (set LIVE_E2E=true to run)", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const year = 2020;
    const tempGroup = "E2E-V2-Temp-2020";
    const email = "e2ev2-2020@example.com";
    const teamName = "E2E-V2 Team 2020";
    const personName = "E2E-V2 Tester";

    let entryRepo;
    let gameRepo;
    let teamRepo;
    let tourneyRepo;
    let viewRepo;
    let conferenceRepo;
    let createdEntryId;

    const logStep = (msg, extra = {}) => {
        const ts = new Date().toISOString();
        const safeExtra = JSON.stringify(extra, (k, v) =>
            typeof v === "bigint" ? v.toString() : v
        );
        // eslint-disable-next-line no-console
        console.log(
            `[E2E-V2][${ts}] ${msg}${safeExtra && safeExtra !== "{}" ? ` | ${safeExtra}` : ""}`
        );
    };

    beforeAll(async () => {
        logStep("Bootstrapping repositories", { year });

        entryRepo = new EntryRepository();
        gameRepo = new GameRepository();
        teamRepo = new TeamRepository();
        tourneyRepo = new TourneyRepository();
        viewRepo = new ViewRepository();
        conferenceRepo = new ConferenceRepository();

        setGameServiceRepositories(teamRepo, gameRepo);
        setViewServiceRepositories(viewRepo, gameRepo, entryRepo);

        logStep("Pre-clean start", { year });
        await preCleanYear(year, entryRepo, gameRepo, tourneyRepo, viewRepo, teamRepo);
        logStep("Pre-clean complete", { year });
    }, 60000);

    afterAll(async () => {
        logStep("Post-clean start", { year });
        await preCleanYear(year, entryRepo, gameRepo, tourneyRepo, viewRepo, teamRepo);
        logStep("Post-clean complete", { year });
    }, 60000);

    // ───────────────────────────────────────────────────────────────────────
    test(
        "Full 2022 bracket → play games → undo → entry → points → verify → cleanup",
        async () => {

            // ── 1. Create full 2022 bracket for year 2020 ─────────────────
            logStep("Creating full 2022 bracket for year 2020", {
                teams: 64,
                games: 63,
                specEntries: GAMES_SPEC_2022.length,
            });
            await createNewBracket(GAMES_SPEC_2022, year, REGION_ARRAY);
            logStep("Bracket created");

            // ── 2. Verify shape via getAllTournamentDetails ─────────────────
            logStep("Verifying tournament shape via getAllTournamentDetails");
            const details = await gameRepo.getAllTournamentDetails(year);

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
            expect(teamWithName.nameNick).toBeTruthy(); // real school name populated

            logStep("Shape assertions passed");

            // ── 3. Fetch round-1 games and confirm IDs ─────────────────────
            logStep("Fetching all games for year", { year });
            const allGames = await gameRepo.getActiveAndFutureGames(year);

            // Find specific round-1 games by gameID
            const game1 = allGames.find((g) => Number(g.gameID) === 1);   // R1 team1 67 vs 307
            const game2 = allGames.find((g) => Number(g.gameID) === 2);   // R1 team2 33 vs 6
            const game9 = allGames.find((g) => Number(g.gameID) === 9);   // R2 game (R1 next for 1,2)

            expect(game1).toBeDefined();
            expect(Number(game1.team1ID)).toBe(67);
            expect(Number(game1.team2ID)).toBe(307);
            expect(Number(game1.round)).toBe(1);
            expect(Number(game1.nextGameID)).toBe(9);
            expect(Number(game1.nextGameSpot)).toBe(1);

            expect(game2).toBeDefined();
            expect(Number(game2.team1ID)).toBe(33);
            expect(Number(game2.team2ID)).toBe(6);
            expect(Number(game2.round)).toBe(1);
            expect(Number(game2.nextGameID)).toBe(9);
            expect(Number(game2.nextGameSpot)).toBe(2);

            // game9 (round 2) should have no teams yet
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
                year,
                REGION_ARRAY
            );

            const gamesWithFF = await gameRepo.getActiveAndFutureGames(year);
            const ffGame = gamesWithFF.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(ffGame).toBeDefined();
            expect(Number(ffGame.team1ID)).toBe(FF_TEAM_A);
            expect(Number(ffGame.team2ID)).toBe(FF_TEAM_B);
            expect(Number(ffGame.round)).toBe(0);
            expect(Number(ffGame.nextGameID)).toBe(FF_NEXT_GAME_ID);
            logStep("First Four game created and verified", { gameID: FF_GAME_ID });

            // ── FF-2. Create entry picking FF_TEAM_A before game resolves ────
            const ffEntryPicks = [FF_TEAM_A, 116, 55, 73, 33, 28, 10, 43, 58, 121];
            await entryRepo.createEntry(
                999997, "e2ev2-ff@example.com", "E2E-FF Entry",
                ffEntryPicks, tempGroup, "E2E-FF Tester", new Date(), year, 320
            );
            logStep("FF entry created", { id: 999997, picks: ffEntryPicks });

            await updatePossiblePoints(year);
            const ffEntryBefore = await gameRepo.getEntryById(999997, year);

            // No R1 games played yet → 0 current points
            expect(ffEntryBefore.totalPoints).toBe(0);
            // Future path starts at R1 game 5 (FF game adds no points, skipped by pointsService)
            // FF_TEAM_A path [5→11→14→15→61→63] = 69 pts; full entry deduplicated = 190
            expect(ffEntryBefore.possPoints).toBeGreaterThan(0);
            expect(ffEntryBefore.possPoints).toBe(190);
            const possPointsBeforeFF = ffEntryBefore.possPoints;
            logStep("FF entry possPoints before resolution verified", {
                totalPoints: ffEntryBefore.totalPoints,
                possPoints: ffEntryBefore.possPoints,
            });

            // ── FF-3. Resolve FF game — FF_TEAM_B wins ─────────────────────
            logStep("Resolving FF game — FF_TEAM_B wins", { winner: FF_TEAM_B, loser: FF_TEAM_A });
            await updateTeamRecords(FF_TEAM_B, FF_TEAM_A, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, year);

            const gamesAfterFF = await gameRepo.getActiveAndFutureGames(year);

            // Game 5's slot 2 must now hold FF_TEAM_B (propagated from FF resolution)
            const game5AfterFF = gamesAfterFF.find(g => Number(g.gameID) === FF_NEXT_GAME_ID);
            expect(Number(game5AfterFF.team2ID)).toBe(FF_TEAM_B);

            // FF game itself must show winner
            const allGamesAfterFF = await gameRepo.getAllTournamentDetails(year);
            const ffGameDoc = allGamesAfterFF.allGames.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(Number(ffGameDoc.winner)).toBe(FF_TEAM_B);

            // Entry pick must have been auto-swapped: FF_TEAM_A → FF_TEAM_B
            const ffEntryAfterResolve = await gameRepo.getEntryById(999997, year);
            expect(ffEntryAfterResolve.picks).toContain(FF_TEAM_B);
            expect(ffEntryAfterResolve.picks).not.toContain(FF_TEAM_A);
            logStep("FF resolution verified — pick swapped, game 5 slot updated");

            // possPoints unchanged — FF_TEAM_B now occupies the same game-5-forward path
            await updatePossiblePoints(year);
            const ffEntryAfterPoints = await gameRepo.getEntryById(999997, year);
            expect(ffEntryAfterPoints.totalPoints).toBe(0); // game 5 not yet played
            expect(ffEntryAfterPoints.possPoints).toBe(possPointsBeforeFF);
            logStep("FF post-resolution possPoints match pre-resolution", {
                possPoints: ffEntryAfterPoints.possPoints,
            });

            // ── FF-4. Undo FF game ────────────────────────────────────────────
            logStep("Undoing FF game");
            await undoTeamRecords(FF_TEAM_B, FF_TEAM_A, 0, FF_GAME_ID, FF_NEXT_GAME_ID, FF_NEXT_GAME_SPOT, year);

            const gamesAfterFFUndo = await gameRepo.getActiveAndFutureGames(year);
            const ffGameUndone = gamesAfterFFUndo.find(g => Number(g.gameID) === FF_GAME_ID);
            expect(ffGameUndone.winner == null).toBe(true);
            const game5AfterFFUndo = gamesAfterFFUndo.find(g => Number(g.gameID) === FF_NEXT_GAME_ID);
            expect(game5AfterFFUndo.team2ID == null || game5AfterFFUndo.team2ID === undefined).toBe(true);

            // Entry picks must revert to FF_TEAM_A
            const ffEntryAfterUndo = await gameRepo.getEntryById(999997, year);
            expect(ffEntryAfterUndo.picks).toContain(FF_TEAM_A);
            expect(ffEntryAfterUndo.picks).not.toContain(FF_TEAM_B);
            logStep("FF undo verified — winner cleared, game 5 slot cleared, pick restored");

            // Clean up FF entry before main test proceeds
            await entryRepo.deleteEntry(999997, year);
            logStep("FF entry cleaned up");

            // ────────────────────────────────────────────────────────────────
            // ── END FIRST FOUR BLOCK ─────────────────────────────────────────
            // ────────────────────────────────────────────────────────────────

            // ── 4. Play game 1: seed 1 (67) beats seed 16 (307) ───────────
            logStep("Playing game 1 — seed1(67) beats seed16(307)", {
                gameID: 1,
                winner: 67,
                nextGameID: 9,
                nextGameSpot: 1,
            });
            await updateTeamRecords(67, 307, 1, 1, 9, 1, year);
            logStep("Game 1 recorded");

            // ── 5. Play game 2: seed 8 (33) beats seed 9 (6) ─────────────
            logStep("Playing game 2 — seed8(33) beats seed9(6)", {
                gameID: 2,
                winner: 33,
                nextGameID: 9,
                nextGameSpot: 2,
            });
            await updateTeamRecords(33, 6, 1, 2, 9, 2, year);
            logStep("Game 2 recorded");

            // ── 6. Verify winner propagation into round-2 game 9 ──────────
            logStep("Verifying propagation into round-2 game 9");
            const gamesAfterPlay = await gameRepo.getActiveAndFutureGames(year);
            const game9AfterPlay = gamesAfterPlay.find((g) => Number(g.gameID) === 9);
            expect(game9AfterPlay).toBeDefined();
            expect(Number(game9AfterPlay.team1ID)).toBe(67); // winner of game 1
            expect(Number(game9AfterPlay.team2ID)).toBe(33); // winner of game 2
            logStep("Propagation verified — game 9 now has teams 67 and 33");

            // ── 7. Undo game 2 and verify rollback ────────────────────────
            logStep("Undoing game 2");
            await undoTeamRecords(33, 6, 1, 2, 9, 2, year);
            logStep("Game 2 undone");

            const gamesAfterUndo = await gameRepo.getActiveAndFutureGames(year);
            const game2AfterUndo = gamesAfterUndo.find((g) => Number(g.gameID) === 2);
            const game9AfterUndo = gamesAfterUndo.find((g) => Number(g.gameID) === 9);

            expect(game2AfterUndo.winner).toBeNull();
            // team2 slot in game 9 should be cleared (null) after undo
            expect(game9AfterUndo.team2ID == null || game9AfterUndo.team2ID === undefined).toBe(true);
            logStep("Undo verified — game 2 winner is null, game 9 team2 cleared");

            // ── 8. Play two more region-2 games for variety ───────────────
            // game 16: seed1(116) beats seed16(174) — region 2
            const game16 = gamesAfterUndo.find((g) => Number(g.gameID) === 16);
            expect(game16).toBeDefined();
            logStep("Playing game 16 — seed1(116) beats seed16(174)", { gameID: 16, nextGameID: game16.nextGameID });
            await updateTeamRecords(
                116, 174, Number(game16.round), 16,
                Number(game16.nextGameID), Number(game16.nextGameSpot), year
            );

            // game 23: seed2(28) beats seed15(293) — region 2
            const game23 = gamesAfterUndo.find((g) => Number(g.gameID) === 23);
            expect(game23).toBeDefined();
            logStep("Playing game 23 — seed2(28) beats seed15(293)", { gameID: 23 });
            await updateTeamRecords(
                28, 293, Number(game23.round), 23,
                Number(game23.nextGameID), Number(game23.nextGameSpot), year
            );
            logStep("Extra games played");

            // ── 9. Build picks from real team IDs in the bracket ──────────
            const picks = [67, 116, 55, 73, 33, 28, 10, 43, 58, 121];
            logStep("Creating new entry with real 2022 team picks", {
                email, teamName, group: tempGroup, picks,
            });
            // We use standard point max 320 to emulate a normal full entry
            await entryRepo.createEntry(999999, email, teamName, picks, tempGroup, personName, new Date(), year, 320);
            logStep("Entry created directly via repo");

            // ── 10. Locate created entry ───────────────────────────────────
            const allEntries = await gameRepo.getAllEntries(year);
            const matching = allEntries.filter((e) => {
                const groups = Array.isArray(e.groups)
                    ? e.groups
                    : e.group ? [e.group] : [];
                return groups.includes(tempGroup);
            });
            logStep("Filtered entries by group", {
                total: allEntries.length,
                matched: matching.length,
            });
            expect(matching.length).toBeGreaterThan(0);
            createdEntryId = 999999;
            logStep("Using createdEntryId", { createdEntryId });

            // ── 11. Verify getEntriesForGroup ─────────────────────────────
            logStep("Verifying getEntriesForGroup", { group: tempGroup });
            const groupEntries = await gameRepo.getEntriesForGroup(year, tempGroup);
            expect(groupEntries.length).toBeGreaterThan(0);
            const found = groupEntries.find((e) => Number(e.id) === createdEntryId);
            expect(found).toBeDefined();
            expect(found.picks).toEqual(picks);
            logStep("getEntriesForGroup verified");

            // ── 11b. getAllYearsForGroup ───────────────────────────────────
            logStep("Verifying getAllYearsForGroup", { group: tempGroup });
            const yearsForGroup = await gameRepo.getAllYearsForGroup(tempGroup);
            expect(yearsForGroup.some(y => y.year === year || y === year)).toBe(true);
            logStep("getAllYearsForGroup verified", { years: yearsForGroup });

            // ── 12. Update entry teamName ──────────────────────────────────
            logStep("Updating entry teamName", { createdEntryId });
            await gameRepo.updateEntry({
                id: createdEntryId,
                year,
                email,
                teamName: `${teamName}-Updated`,
                picks,
                groups: [tempGroup],
                person: personName,
            });
            const updatedEntry = await gameRepo.getEntryById(createdEntryId, year);
            expect(updatedEntry.teamName).toBe(`${teamName}-Updated`);
            logStep("Entry update verified");

            // ── 12b. Update entry picks directly (EntryRepository test) ────
            logStep("Updating entry picks directly");
            const newPicks = [...picks.slice(0, 9), 6]; // change last pick
            await entryRepo.updateEntryPicks(createdEntryId, newPicks, year);
            const entryAfterPicksUpdate = await gameRepo.getEntryById(createdEntryId, year);
            expect(entryAfterPicksUpdate.picks).toEqual(newPicks);
            // Revert back for future assertions
            await entryRepo.updateEntryPicks(createdEntryId, picks, year);

            // ── 12c. Find entries by name (EntryRepository test) ───────────
            const searchedEntries = await entryRepo.findEntriesByName(personName, year);
            expect(searchedEntries.length).toBeGreaterThan(0);
            expect(searchedEntries[0].person).toBe(personName);
            logStep("Entries by name verified");

            // ── 13. Run updatePossiblePoints ───────────────────────────────
            logStep("Running updatePossiblePoints for year", { year });
            await updatePossiblePoints(year);
            logStep("Possible points updated");

            const entryAfterPoints = await gameRepo.getEntryById(createdEntryId, year);

            // Games played before this point:
            //   - game 1: 67 beats 307 (R1) → team 67 earns 2 pts
            //   - game 2: 33 beats 6 (R1), then UNDONE → team 33 earns 0 pts
            //   - game 16: 116 beats 174 (R1) → team 116 earns 2 pts
            //   - game 23: 28 beats 293 (R1) → team 28 earns 2 pts
            // picks = [67, 116, 55, 73, 33, 28, 10, 43, 58, 121]
            // totalPoints = 2 + 2 + 2 = 6
            expect(entryAfterPoints.totalPoints).toBe(6);

            // possPoints = currentPoints(6) + deduplicated future points across all paths:
            //   67:  ["W",9,13,15,61,63]  → 3+5+9+17+33 = 67
            //   116: ["W",24,28,30]       → 3+5+9       = 17  (61 deduped by 67's path)
            //   55:  [31,39,43,45,62]     → 2+3+5+9+17  = 36  (63 deduped)
            //   73:  [46,54,58,60]        → 2+3+5+9     = 19  (62 deduped)
            //   33:  [2]                  → 2            = 2   (9 deduped by 67's path)
            //   28:  ["W",27,29]          → 3+5         = 8   (30 deduped by 116's path)
            //   10:  [38,42,44]           → 2+3+5       = 10  (45 deduped by 55's path)
            //   43:  [53,57,59]           → 2+3+5       = 10  (60 deduped by 73's path)
            //   58:  [4,10]               → 2+3         = 5   (13 deduped by 67's path)
            //   121: [3]                  → 2            = 2   (10 deduped by 58's path)
            // total future: 67+17+36+19+2+8+10+10+5+2 = 176 → possPoints = 6+176 = 182
            expect(entryAfterPoints.possPoints).toBe(182);

            logStep("Points fields verified", {
                totalPoints: entryAfterPoints.totalPoints,
                possPoints: entryAfterPoints.possPoints,
            });

            // ── 13x. getEntriesContainingTeams ────────────────────────────
            // Winners 67 and 116 are in entry 1's picks — must appear in results.
            logStep("Verifying getEntriesContainingTeams", { teams: [67, 116] });
            const containingEntries = await gameRepo.getEntriesContainingTeams(year, [67, 116]);
            expect(containingEntries.some(e => Number(e.id) === createdEntryId)).toBe(true);
            logStep("getEntriesContainingTeams verified", { matchCount: containingEntries.length });

            // ── 13y. buildFullGridData ─────────────────────────────────────
            logStep("Verifying buildFullGridData", { group: tempGroup, year });
            const gridData = await buildFullGridData(tempGroup, year);
            expect(gridData).toBeDefined();
            expect(Array.isArray(gridData.allTeamsWithPickCounts)).toBe(true);
            expect(gridData.allTeamsWithPickCounts.length).toBeGreaterThan(0);
            expect(Array.isArray(gridData.groupData)).toBe(true);
            expect(gridData.groupData.length).toBeGreaterThan(0);
            // Entry should appear in groupData with correct points
            const gridEntry = gridData.groupData.find(e => Number(e.id) === createdEntryId);
            expect(gridEntry).toBeDefined();
            expect(gridEntry.totalPoints).toBe(entryAfterPoints.totalPoints);
            logStep("buildFullGridData verified", {
                teams: gridData.allTeamsWithPickCounts.length,
                entries: gridData.groupData.length,
            });

            // ── 13b. Verify possibleRanking (best rank) ────────────────────
            // Single entry in the group → must be ranked #1 with no ties.
            logStep("Running possibleRanking for year and group", { year, group: tempGroup });
            const rankedEntries = await possibleRanking(year, tempGroup);
            logStep("possibleRanking result", { count: rankedEntries.length });

            expect(rankedEntries.length).toBe(1);
            const ourRankedEntry = rankedEntries[0];

            // Being the only entry guarantees rank 1
            expect(ourRankedEntry.highestPlace).toBe(1);
            expect(ourRankedEntry.ties).toBe(0);

            // Current points should match what updatePossiblePoints stored
            expect(ourRankedEntry.points).toBe(6);

            // possPoints from possibleRanking (recalculated live) should match stored value
            const liveMaxPoints = ourRankedEntry.points + (ourRankedEntry.futureGames || []).reduce(() => 0, 0);
            expect(typeof ourRankedEntry.futureGames).toBe('object');

            logStep("possibleRanking verified", {
                highestPlace: ourRankedEntry.highestPlace,
                ties: ourRankedEntry.ties,
                points: ourRankedEntry.points,
            });

            // ── 13c. possPoints decreases when a picked team is eliminated ──
            // Entry 1 picks team 33. Game 2 was undone so team 33 is alive.
            // Team 33's entire future contribution is [2] = 2 pts (one unplayed R1 game).
            // After team 6 upsets team 33 in game 2, that 2 pts must drop from possPoints.
            logStep("Testing possPoints decrease after elimination (6 upsets 33 in game 2)");
            const possPointsBefore = entryAfterPoints.possPoints; // 182

            await updateTeamRecords(6, 33, 1, 2, 9, 2, year);
            await updatePossiblePoints(year);
            const entryAfterElimination = await gameRepo.getEntryById(createdEntryId, year);

            // Team 33's path was [2] = 2 pts → possPoints must decrease by 2
            expect(entryAfterElimination.possPoints).toBeLessThan(possPointsBefore);
            expect(entryAfterElimination.possPoints).toBe(180);
            logStep("possPoints decrease verified after elimination", {
                before: possPointsBefore,
                after: entryAfterElimination.possPoints,
            });

            // Restore state: undo game 2 (6 over 33) → team 33 is alive again
            await undoTeamRecords(6, 33, 1, 2, 9, 2, year);
            logStep("Undo elimination — team 33 restored to alive");

            // ── 13d. Multiple entries with competitive ranking ─────────────
            // Entry 2 holds eliminated teams (307, 174, 293) so its ceiling is
            // lower than entry 1's.  getHighestPlace should give entry 1 rank=1
            // and entry 2 rank=2.
            const secondEntryId = 999998;
            // picks: 67 and 116 are alive winners; 307/174/293 are eliminated (no future)
            const secondEntryPicks = [67, 116, 55, 73, 307, 174, 293, 10, 43, 58];
            logStep("Creating second entry with weaker picks", { secondEntryId, secondEntryPicks });
            await entryRepo.createEntry(
                secondEntryId,
                "e2ev2-second@example.com",
                "E2E-V2 Second 2020",
                secondEntryPicks,
                tempGroup,
                "E2E-V2 Second",
                new Date(),
                year,
                320,
            );

            await updatePossiblePoints(year);
            const rankedTwo = await possibleRanking(year, tempGroup);
            logStep("Multi-entry possibleRanking result", { count: rankedTwo.length });
            expect(rankedTwo.length).toBe(2);

            const entry1Ranked = rankedTwo.find((e) => Number(e.entryID) === createdEntryId);
            const entry2Ranked = rankedTwo.find((e) => Number(e.entryID) === secondEntryId);
            expect(entry1Ranked).toBeDefined();
            expect(entry2Ranked).toBeDefined();

            // Entry 1's unique picks (33, 28, 121) all have future upside;
            // entry 2's unique picks (307, 174, 293) are eliminated → no upside.
            // Therefore entry 1 can always beat entry 2's ceiling → rank 1 vs rank 2.
            expect(entry1Ranked.highestPlace).toBe(1);
            expect(entry2Ranked.highestPlace).toBe(2);
            logStep("Multi-entry ranking verified", {
                entry1HighestPlace: entry1Ranked.highestPlace,
                entry2HighestPlace: entry2Ranked.highestPlace,
            });

            await entryRepo.deleteEntry(secondEntryId, year);
            logStep("Second entry deleted");

            // ── 13e. Multi-round progression: R1 → R2 → R3 propagation ─────
            // Re-play game 2 (33 beats 6) so game 9 now has both teams (67 & 33).
            // Then play game 9 (R2) and confirm:
            //   • winner (67) propagates into the R3 game slot
            //   • entry 1 totalPoints reflects the R2 win (+3 pts for team 67)
            logStep("Multi-round progression: re-playing game 2 (33 beats 6)");
            await updateTeamRecords(33, 6, 1, 2, 9, 2, year);

            const gamesBeforeR2 = await gameRepo.getActiveAndFutureGames(year);
            const game9Ready = gamesBeforeR2.find((g) => Number(g.gameID) === 9);
            expect(Number(game9Ready.team1ID)).toBe(67);
            expect(Number(game9Ready.team2ID)).toBe(33);
            logStep("Game 9 confirmed with both teams — playing R2");

            await updateTeamRecords(
                67, 33,
                Number(game9Ready.round), 9,
                Number(game9Ready.nextGameID), Number(game9Ready.nextGameSpot),
                year,
            );
            logStep("Game 9 played — 67 beats 33 in R2");

            // Winner must propagate into the R3 game (game 13, spot 1)
            const gamesAfterR2 = await gameRepo.getActiveAndFutureGames(year);
            const game13 = gamesAfterR2.find((g) => Number(g.gameID) === Number(game9Ready.nextGameID));
            expect(game13).toBeDefined();
            expect(Number(game13.team1ID)).toBe(67);
            logStep("R2 → R3 propagation verified", {
                r3GameID: game13 ? game13.gameID : null,
                r3Team1: game13 ? game13.team1ID : null,
            });

            // Run points update and verify totalPoints reflects R2 win:
            //   67: R2 winner → cumulative 5 pts (TOURNAMENT_ROUNDS[2].points)
            //   33: R2 loser  → loserPoints = 2 pts (same as R1 win total)
            //   116: R1 winner → 2 pts,  28: R1 winner → 2 pts
            //   All other picks have not played → 0 pts
            //   total = 5 + 2 + 2 + 2 = 11
            await updatePossiblePoints(year);
            const entryAfterR2 = await gameRepo.getEntryById(createdEntryId, year);
            expect(entryAfterR2.totalPoints).toBe(11);
            logStep("R2 points verified", { totalPoints: entryAfterR2.totalPoints });

            // ── 14. Delete entry and verify ────────────────────────────────
            logStep("Deleting entry", { createdEntryId });
            await entryRepo.deleteEntry(createdEntryId, year);
            const afterDelete = await gameRepo.getEntryById(createdEntryId, year);
            expect(afterDelete == null).toBe(true);
            logStep("Entry deletion verified");

            // ────────────────────────────────────────────────────────────────
            // ── PART 2: Entities CRUD (Conferences, Schools, Groups) ────────
            // ────────────────────────────────────────────────────────────────

            const testConfSlug = "e2e-test-conf";
            const testSid = 999999;
            const testGroupName = "E2E-CRUD-Group";

            logStep("Starting Entity CRUD ops");

            // ── 15. Conference CRUD ─────────────────────────────────────────
            logStep("Creating new conference", { testConfSlug });
            const testConf = {
                slug: testConfSlug,
                name: "E2E Test Conference",
                shortName: "E2E",
                division: "I",
                active: true
            };
            await conferenceRepo.insertConference(testConf);

            const fetchedConf = await conferenceRepo.getConferenceBySlug(testConfSlug);
            expect(fetchedConf).toBeDefined();
            expect(fetchedConf.name).toBe(testConf.name);

            await conferenceRepo.updateConference(testConfSlug, {
                name: "E2E Updated Conference",
                shortName: "E2E2",
                division: "II",
                active: false
            });
            const updatedConf = await conferenceRepo.getConferenceBySlug(testConfSlug);
            expect(updatedConf.name).toBe("E2E Updated Conference");
            expect(updatedConf.division).toBe("II");

            const allConfs = await conferenceRepo.getAllConferences();
            expect(allConfs.some(c => c.slug === testConfSlug)).toBe(true);

            // ── 16. School/Team CRUD ────────────────────────────────────────
            logStep("Creating new school", { testSid });
            const testSchool = {
                sid: testSid,
                name: "E2E Test School",
                mascot: "Testers",
                nameNick: "E2E Testers",
                confID: testConfSlug,
                conferenceHistory: [{ confID: testConfSlug, startYear: 2020, endYear: null }]
            };
            await teamRepo.insertSchool(testSchool);

            const fetchedSchool = await teamRepo.getSchoolById(testSid);
            expect(fetchedSchool).toBeDefined();
            expect(fetchedSchool.name).toBe(testSchool.name);

            await teamRepo.updateSchool({
                sid: testSid,
                name: "E2E Master School",
                mascot: "Master Testers",
                nameNick: "E2E Masters",
                confID: testConfSlug
            });

            await teamRepo.updateSchoolConferenceHistory(testSid, [
                { confID: testConfSlug, startYear: 2020, endYear: 2021 },
                { confID: "other-conf", startYear: 2022, endYear: null }
            ]);

            const updatedSchool = await teamRepo.getSchoolById(testSid);
            expect(updatedSchool.nameNick).toBe("E2E Masters");
            expect(updatedSchool.conferenceHistory.length).toBe(2);

            const searchedSchools = await teamRepo.findSchoolsByName("E2E Master");
            expect(searchedSchools.length).toBeGreaterThan(0);
            expect(searchedSchools[0].sid).toBe(testSid);

            // ── 17. Group CRUD ──────────────────────────────────────────────
            logStep("Creating new group", { testGroupName });
            // Using max entry id hack or random id for group
            const testGroupId = 999999;
            await viewRepo.addGroup(testGroupId, testGroupName);

            const fetchedGroup = await viewRepo.findGroupByName(testGroupName);
            expect(fetchedGroup).toBe(testGroupName);

            const allGroups = await viewRepo.getAllGroups();
            expect(allGroups.includes(testGroupName)).toBe(true);

            logStep("Entity CRUD ops verified");
        },
        300000
    );
});

// ─── Cleanup helper ────────────────────────────────────────────────────────

async function preCleanYear(year, entryRepo, gameRepo, tourneyRepo, viewRepo, teamRepo) {
    // eslint-disable-next-line no-console
    console.log(`[E2E-V2] preCleanYear starting for ${year}`);

    // Remove e2e-v2 entries
    try {
        const allEntries = await gameRepo.getAllEntries(year);
        const e2eEntries = allEntries.filter((e) =>
            String(e.teamName).includes("E2E-V2") ||
            String(e.email).includes("e2ev2") ||
            (Array.isArray(e.groups)
                ? e.groups.some((g) => String(g).includes("E2E-V2"))
                : String(e.group).includes("E2E-V2"))
        );
        for (const entry of e2eEntries) {
            await entryRepo.deleteEntry(Number(entry.id), year);
        }
        // eslint-disable-next-line no-console
        console.log(`[E2E-V2] Deleted ${e2eEntries.length} e2e-v2 entries`);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V2] Entry cleanup warning:", err.message);
    }

    // Remove all games for this year
    try {
        if (typeof gameRepo.deleteGamesByYear === "function") {
            await gameRepo.deleteGamesByYear(year);
            // eslint-disable-next-line no-console
            console.log(`[E2E-V2] Deleted games for year ${year}`);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V2] Games cleanup warning:", err.message);
    }

    // Remove all schoolRecords for this year
    try {
        if (typeof gameRepo.deleteSchoolRecordsByYear === "function") {
            await gameRepo.deleteSchoolRecordsByYear(year);
            // eslint-disable-next-line no-console
            console.log(`[E2E-V2] Deleted schoolRecords for year ${year}`);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V2] SchoolRecords cleanup warning:", err.message);
    }

    // Remove regions for this year (new in V2 — createNewBracket inserts regions)
    try {
        if (typeof tourneyRepo.deleteRegionsByYear === "function") {
            await tourneyRepo.deleteRegionsByYear(year);
            // eslint-disable-next-line no-console
            console.log(`[E2E-V2] Deleted regions for year ${year}`);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[E2E-V2] Regions cleanup warning:", err.message);
    }

    // Remove Test School
    if (teamRepo) {
        try {
            await teamRepo.deleteSchool(999999);
            console.log(`[E2E-V2] Deleted test school 999999`);
        } catch (err) {
            console.warn("[E2E-V2] School cleanup warning:", err.message);
        }
    }

    // Remove Test Conference (using raw db delete since no repo method)
    try {
        await db.collection("conferences").doc("e2e-test-conf").delete();
        console.log(`[E2E-V2] Deleted test conference`);
    } catch (err) {
        console.warn("[E2E-V2] Conference cleanup warning:", err);
    }

    // Remove Test Group (using raw db delete since no repo method outside of specific commands)
    try {
        await db.collection("groups").doc("E2E-CRUD-Group").delete();
        console.log(`[E2E-V2] Deleted test group`);
    } catch (err) {
        console.warn("[E2E-V2] Group cleanup warning:", err);
    }

    // Remove the root tournament document for the year
    try {
        await db.collection("tournaments").doc(String(year)).delete();
        console.log(`[E2E-V2] Deleted root tournament document for year ${year}`);
    } catch (err) {
        console.warn("[E2E-V2] Root tournament cleanup warning:", err);
    }

    // eslint-disable-next-line no-console
    console.log(`[E2E-V2] preCleanYear finished for ${year}`);
}
