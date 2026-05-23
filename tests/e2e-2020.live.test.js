import {
    EntryRepository,
    GameRepository,
    TeamRepository,
    TourneyRepository,
    ViewRepository,
} from "../src/repositories/index.js";
import {
    createNewBracket,
    updateBracket,
} from "../src/services/tourneyService.js";
import {
    updateTeamRecords,
    undoTeamRecords,
    setRepositories as setGameServiceRepositories,
} from "../src/services/gameService.js";
import {
    createNewEntry,
    setRepositories as setViewServiceRepositories,
} from "../src/services/viewService.js";
import { updatePossiblePoints } from "../src/services/pointsService.js";

// Live E2E guard
const RUN_LIVE = process.env.LIVE_E2E === "true";

describe(`LIVE E2E 2020 flow (requires LIVE_E2E=true)`, () => {
    if (!RUN_LIVE) {
        test("skipped (set LIVE_E2E=true to run)", () => {
            expect(true).toBe(true);
        });
        return;
    }

    const year = 2020;
    const tempGroup = "E2E-Temp-2020";
    const email = "e2e2020@example.com";
    const teamName = "E2E Team 2020";
    const personName = "E2E Tester";

    let entryRepo;
    let gameRepo;
    let teamRepo;
    let tourneyRepo;
    let viewRepo;
    let createdEntryId;

    const logStep = (msg, extra = {}) => {
        const ts = new Date().toISOString();
        const safeExtra = JSON.stringify(extra, (k, v) => (typeof v === "bigint" ? v.toString() : v));
        // eslint-disable-next-line no-console
        console.log(`[E2E][${ts}] ${msg}${safeExtra && safeExtra !== "{}" ? ` | ${safeExtra}` : ""}`);
    };

    beforeAll(async () => {
        logStep("Bootstrapping repositories", { year });

        entryRepo = new EntryRepository();
        gameRepo = new GameRepository();
        teamRepo = new TeamRepository();
        tourneyRepo = new TourneyRepository();
        viewRepo = new ViewRepository();

        // Wire repositories into services
        setGameServiceRepositories(teamRepo, gameRepo);
        setViewServiceRepositories(viewRepo, gameRepo, entryRepo);

        // Pre-clean (idempotent): remove any 2020 residue
        logStep("Pre-clean start", { year });
        await preCleanYear(year, entryRepo, gameRepo, tourneyRepo);
        logStep("Pre-clean complete", { year });
    }, 30000);

    afterAll(async () => {
        logStep("Post-clean start", { year });
        await preCleanYear(year, entryRepo, gameRepo, tourneyRepo);
        logStep("Post-clean complete", { year });
    }, 30000);

    test(
        "Create tournament, update teams, play/undo games, create/update entry, update points, verify, cleanup",
        async () => {
            // 1) Create a simple new bracket for 2020
            const regionArray = [1, 2, 3, 4];
            const gamesSpec = [
                "1-1-1-16", // game 1
                "1-1-8-9",  // game 2
                "2-16-1-16", // game 3
                "2-16-8-9",  // game 4
            ];

            logStep("Creating new bracket", { year, regionArray, gamesSpecCount: gamesSpec.length });
            try {
                await createNewBracket(gamesSpec, year, regionArray);
                logStep("Bracket created");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] createNewBracket failed", err);
                throw err;
            }

            // 2) Update teams in that bracket (simulate a seed swap in region 1)
            const updatedGamesSpec = [
                "1-1-16-1",
                "1-1-9-8",
                "2-16-1-16",
                "2-16-8-9",
            ];
            logStep("Updating bracket teams", { year, updatedGamesSpecCount: updatedGamesSpec.length });
            try {
                await updateBracket(updatedGamesSpec, year, regionArray);
                logStep("Bracket update complete");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] updateBracket failed", err);
                throw err;
            }

            // 3) Play a couple of games and then undo one
            logStep("Fetching active/future games", { year });
            const activeGames = await gameRepo.getActiveAndFutureGames(year);
            logStep("Fetched active/future games", { count: activeGames.length });
            expect(activeGames.length).toBeGreaterThanOrEqual(2);

            const g1 = activeGames[0];
            const g2 = activeGames[1];

            const g1Winner = Number(g1.team1ID || g1.team2ID);
            const g1Loser = g1Winner === Number(g1.team1ID) ? Number(g1.team2ID) : Number(g1.team1ID);
            logStep("Updating game 1 winner", { gameID: g1.gameID, winner: g1Winner, loser: g1Loser, round: g1.round, nextGameID: g1.nextGameID, nextGameSpot: g1.nextGameSpot });
            try {
                await updateTeamRecords(
                    g1Winner, g1Loser, Number(g1.round), Number(g1.gameID),
                    Number(g1.nextGameID), Number(g1.nextGameSpot), year
                );
                logStep("Game 1 updated");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] updateTeamRecords (g1) failed", err);
                throw err;
            }

            const g2Winner = Number(g2.team1ID || g2.team2ID);
            const g2Loser = g2Winner === Number(g2.team1ID) ? Number(g2.team2ID) : Number(g2.team1ID);
            logStep("Updating game 2 winner", { gameID: g2.gameID, winner: g2Winner, loser: g2Loser });
            try {
                await updateTeamRecords(
                    g2Winner, g2Loser, Number(g2.round), Number(g2.gameID),
                    Number(g2.nextGameID), Number(g2.nextGameSpot), year
                );
                logStep("Game 2 updated");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] updateTeamRecords (g2) failed", err);
                throw err;
            }

            // Undo the first game's result
            logStep("Undoing game 1", { gameID: g1.gameID });
            try {
                await undoTeamRecords(
                    g1Winner, g1Loser, Number(g1.round), Number(g1.gameID),
                    Number(g1.nextGameID), Number(g1.nextGameSpot), year
                );
                logStep("Game 1 undo complete");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] undoTeamRecords (g1) failed", err);
                throw err;
            }

            // Verify undo
            logStep("Verifying undo by refetching games");
            const gamesAfterUndo = await gameRepo.getActiveAndFutureGames(year);
            const g1After = gamesAfterUndo.find((gg) => Number(gg.gameID) === Number(g1.gameID));
            expect(g1After.winner).toBeNull();

            // 4) Create an entry for that tournament
            logStep("Building pick candidates from gamesAfterUndo", { count: gamesAfterUndo.length });
            const pickCandidates = gamesAfterUndo
                .map((gg) => [Number(gg.team1ID), Number(gg.team2ID)])
                .flat()
                .filter((id) => Number.isInteger(id));
            const uniquePicks = Array.from(new Set(pickCandidates)).slice(0, 10);
            logStep("Picks computed", { totalCandidates: pickCandidates.length, uniqueCount: uniquePicks.length });
            expect(uniquePicks.length).toBeGreaterThan(0);

            logStep("Creating new entry", { email, teamName, personName, group: tempGroup, picks: uniquePicks });
            try {
                await createNewEntry(email, teamName, personName, tempGroup, uniquePicks, year, 0);
                logStep("Entry created");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] createNewEntry failed", err);
                throw err;
            }

            // Find the created entry
            logStep("Fetching all entries for year to locate created entry", { year });
            const created = await gameRepo.getAllEntries(year);
            const candidates = created.filter((e) => {
                const groups = Array.isArray(e.groups) ? e.groups : (e.group ? [e.group] : []);
                return groups.includes(tempGroup);
            });
            logStep("Filtered entries by group", { total: created.length, matched: candidates.length });
            expect(candidates.length).toBeGreaterThan(0);
            createdEntryId = Number(candidates[candidates.length - 1].id);
            logStep("Using createdEntryId", { createdEntryId });

            // 5) Update the entry (change teamName)
            logStep("Updating entry teamName", { createdEntryId });
            await gameRepo.updateEntry({
                id: createdEntryId,
                year,
                email,
                teamName: `${teamName}-Updated`,
                picks: uniquePicks,
                groups: [tempGroup],
                person: personName,
            });

            logStep("Fetching entry after update", { createdEntryId });
            const fetched = await gameRepo.getEntryById(createdEntryId, year);
            expect(fetched.teamName).toBe(`${teamName}-Updated`);

            // 6) Update total points for 2020
            logStep("Updating possible points", { year });
            try {
                await updatePossiblePoints(year);
                logStep("Possible points updated");
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[E2E] updatePossiblePoints failed", err);
                throw err;
            }

            // 7) Verify points fields
            logStep("Fetching entry to verify points", { createdEntryId });
            const updatedEntry = await gameRepo.getEntryById(createdEntryId, year);
            expect(typeof updatedEntry.totalPoints === "number" || updatedEntry.totalPoints === null).toBe(true);
            expect(typeof updatedEntry.possPoints === "number" || updatedEntry.possPoints === null).toBe(true);

            // 8) Cleanup created entry
            logStep("Deleting created entry", { createdEntryId });
            await entryRepo.deleteEntry(createdEntryId, year);
            const afterDelete = await gameRepo.getEntryById(createdEntryId, year);
            expect(afterDelete == null).toBe(true); // null (Firestore)
        },
        180000
    );
});

/**
 * Cleans up all 2020 test data using repository methods.
 */
async function preCleanYear(year, entryRepo, gameRepo, tourneyRepo) {
    // eslint-disable-next-line no-console
    console.log(`[E2E] preCleanYear starting for ${year}`);

    // Delete e2e entries for this year
    try {
        const allEntries = await gameRepo.getAllEntries(year);
        const e2eEntries = allEntries.filter((e) =>
            e.teamName === "E2E Team 2020" ||
            e.teamName === "E2E Team 2020-Updated" ||
            String(e.group).includes("E2E-Temp-2020") ||
            e.email === "e2e2020@example.com"
        );
        for (const entry of e2eEntries) {
            await entryRepo.deleteEntry(Number(entry.id), year);
        }
        // eslint-disable-next-line no-console
        console.log(`[E2E] Deleted ${e2eEntries.length} e2e entries`);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[E2E] Entry cleanup warning:`, err.message);
    }

    // Delete all games for this year
    try {
        if (typeof gameRepo.deleteGamesByYear === 'function') {
            await gameRepo.deleteGamesByYear(year);
            // eslint-disable-next-line no-console
            console.log(`[E2E] Deleted games for year ${year}`);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[E2E] Games cleanup warning:`, err.message);
    }

    // Delete all schoolRecords for this year
    try {
        if (typeof gameRepo.deleteSchoolRecordsByYear === 'function') {
            await gameRepo.deleteSchoolRecordsByYear(year);
            // eslint-disable-next-line no-console
            console.log(`[E2E] Deleted schoolRecords for year ${year}`);
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[E2E] SchoolRecords cleanup warning:`, err.message);
    }

    // eslint-disable-next-line no-console
    console.log(`[E2E] preCleanYear finished for ${year}`);
}
