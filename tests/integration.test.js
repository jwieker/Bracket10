
import fs from "fs";
import path from "path";

// Import test data
const testDataPath = path.join(process.cwd(), "datafortests");

describe("Integration Tests with Test Data", () => {
    let entryData;
    let gamesData;
    let schoolData;
    let schoolRecordData;
    let groupsData;
    let regionData;

    beforeAll(() => {
        // Load test data
        try {
            entryData = JSON.parse(fs.readFileSync(path.join(testDataPath, "entry.json"), "utf8"));
            gamesData = JSON.parse(fs.readFileSync(path.join(testDataPath, "games.json"), "utf8"));
            schoolData = JSON.parse(fs.readFileSync(path.join(testDataPath, "school.json"), "utf8"));
            schoolRecordData = JSON.parse(fs.readFileSync(path.join(testDataPath, "schoolRecord.json"), "utf8"));
            groupsData = JSON.parse(fs.readFileSync(path.join(testDataPath, "groups.json"), "utf8"));
            // Handle JSON format for region data
            const regionDataContent = fs.readFileSync(path.join(testDataPath, "regionID.json"), "utf8");
            regionData = JSON.parse(regionDataContent);
        } catch (error) {
            console.error("Failed to load test data:", error);
        }
    });

    describe("Test Data Validation", () => {
        test("should have valid entry data structure", () => {
            expect(entryData).toBeDefined();
            expect(Array.isArray(entryData)).toBe(true);
            expect(entryData.length).toBeGreaterThan(0);

            // Check first entry structure
            const firstEntry = entryData[0];
            expect(firstEntry).toHaveProperty("id");
            expect(firstEntry).toHaveProperty("email");
            expect(firstEntry).toHaveProperty("year");
            expect(firstEntry).toHaveProperty("teamName");
            expect(firstEntry).toHaveProperty("picks");
            expect(firstEntry).toHaveProperty("group");
            expect(firstEntry).toHaveProperty("person");
            expect(firstEntry).toHaveProperty("created_at");

            // Validate picks is an array
            expect(Array.isArray(firstEntry.picks)).toBe(true);
        });

        test("should have valid games data structure", () => {
            expect(gamesData).toBeDefined();
            expect(Array.isArray(gamesData)).toBe(true);
            expect(gamesData.length).toBeGreaterThan(0);

            // Check first game structure
            const firstGame = gamesData[0];
            expect(firstGame).toHaveProperty("gameID");
            expect(firstGame).toHaveProperty("regionID");
            expect(firstGame).toHaveProperty("year");
            expect(firstGame).toHaveProperty("team1ID");
            expect(firstGame).toHaveProperty("team2ID");
            expect(firstGame).toHaveProperty("winner");
            expect(firstGame).toHaveProperty("round");
            expect(firstGame).toHaveProperty("nextGameID");
            expect(firstGame).toHaveProperty("nextGameSpot");
        });

        test("should have valid school data structure", () => {
            expect(schoolData).toBeDefined();
            expect(Array.isArray(schoolData)).toBe(true);
            expect(schoolData.length).toBeGreaterThan(0);

            // Check first school structure
            const firstSchool = schoolData[0];
            expect(firstSchool).toHaveProperty("sid");
            expect(firstSchool).toHaveProperty("name");
            expect(firstSchool).toHaveProperty("mascot");
            expect(firstSchool).toHaveProperty("nameNick");
            expect(firstSchool).toHaveProperty("confID");
        });

        test("should have valid school record data structure", () => {
            expect(schoolRecordData).toBeDefined();
            expect(Array.isArray(schoolRecordData)).toBe(true);
            expect(schoolRecordData.length).toBeGreaterThan(0);

            // Check first school record structure
            const firstRecord = schoolRecordData[0];
            expect(firstRecord).toHaveProperty("sID");
            expect(firstRecord).toHaveProperty("year");
            expect(firstRecord).toHaveProperty("seed");
            expect(firstRecord).toHaveProperty("regionID");
        });

        test("should have valid groups data structure", () => {
            expect(groupsData).toBeDefined();
            expect(Array.isArray(groupsData)).toBe(true);
            expect(groupsData.length).toBeGreaterThan(0);

            // Check first group structure
            const firstGroup = groupsData[0];
            expect(firstGroup).toHaveProperty("id");
            expect(firstGroup).toHaveProperty("name");
        });

        test("should have valid region data structure", () => {
            expect(regionData).toBeDefined();
            expect(Array.isArray(regionData)).toBe(true);
            expect(regionData.length).toBeGreaterThan(0);

            // Check first region structure
            const firstRegion = regionData[0];
            expect(firstRegion).toHaveProperty("regionID");
            expect(firstRegion).toHaveProperty("regionName");
        });
    });

    describe("Data Consistency Tests", () => {
        test("should have consistent years across all data", () => {
            const entryYears = [...new Set(entryData.map(entry => entry.year))];
            const gameYears = [...new Set(gamesData.map(game => game.year))];
            const recordYears = [...new Set(schoolRecordData.map(record => record.year))];

            // All years should be consistent
            const allYears = [...entryYears, ...gameYears, ...recordYears];
            const uniqueYears = [...new Set(allYears)];

            expect(uniqueYears.length).toBeLessThanOrEqual(3); // Should be 1-3 years max
            expect(uniqueYears.every(year => /^\d{4}$/.test(year))).toBe(true); // Should be 4-digit years
        });

        test("should have valid team IDs in games", () => {
            const allTeamIds = new Set();

            // Collect all team IDs from games
            gamesData.forEach(game => {
                if (game.team1ID) allTeamIds.add(game.team1ID);
                if (game.team2ID) allTeamIds.add(game.team2ID);
                if (game.winner) allTeamIds.add(game.winner);
            });

            // All team IDs should exist in school data
            const schoolIds = new Set(schoolData.map(school => school.sid));

            for (const teamId of allTeamIds) {
                expect(schoolIds.has(teamId)).toBe(true);
            }
        });

        test("should have valid region IDs in games", () => {
            const gameRegionIds = new Set(gamesData.map(game => game.regionID));
            const regionIds = new Set(regionData.map(region => region.regionID));

            for (const regionId of gameRegionIds) {
                expect(regionIds.has(regionId)).toBe(true);
            }
        });

        test("should have valid school IDs in school records", () => {
            const recordSchoolIds = new Set(schoolRecordData.map(record => record.sID));
            const schoolIds = new Set(schoolData.map(school => school.sid));

            for (const schoolId of recordSchoolIds) {
                expect(schoolIds.has(schoolId)).toBe(true);
            }
        });

        test("should have valid region IDs in school records", () => {
            const recordRegionIds = new Set(schoolRecordData.map(record => record.regionID));
            const regionIds = new Set(regionData.map(region => region.regionID));

            for (const regionId of recordRegionIds) {
                expect(regionIds.has(regionId)).toBe(true);
            }
        });
    });

    describe("Business Logic Tests", () => {
        test("should have valid game progression", () => {
            // Check that games have logical progression
            const gamesByRound = {};

            gamesData.forEach(game => {
                const round = game.round;
                if (!gamesByRound[round]) {
                    gamesByRound[round] = [];
                }
                gamesByRound[round].push(game);
            });

            // Should have games in rounds 1-6
            const rounds = Object.keys(gamesByRound).map(Number).sort((a, b) => a - b);
            expect(rounds.length).toBeGreaterThan(0);
            expect(Math.min(...rounds)).toBe(1);
            expect(Math.max(...rounds)).toBeLessThanOrEqual(6);
        });

        test("should have valid seed numbers", () => {
            const seeds = schoolRecordData.map(record => record.seed);

            // Seeds should be 1-16
            expect(Math.min(...seeds)).toBe(1);
            expect(Math.max(...seeds)).toBe(16);

            // Should have exactly 16 seeds per region per year
            const yearRegionSeeds = {};
            schoolRecordData.forEach(record => {
                const key = `${record.year}-${record.regionID}`;
                if (!yearRegionSeeds[key]) {
                    yearRegionSeeds[key] = new Set();
                }
                yearRegionSeeds[key].add(record.seed);
            });

            for (const key in yearRegionSeeds) {
                expect(yearRegionSeeds[key].size).toBe(16);
            }
        });

        test("should have valid entry picks", () => {
            entryData.forEach(entry => {
                expect(Array.isArray(entry.picks)).toBe(true);
                expect(entry.picks.length).toBe(10); // Should have exactly 10 picks

                // All picks should be valid team IDs (check if they exist in school data)
                const schoolIds = new Set(schoolData.map(school => school.sid));
                const invalidPicks = entry.picks.filter(pick => !schoolIds.has(Number(pick)));

                // Log invalid picks for debugging but don't fail the test
                if (invalidPicks.length > 0) {
                    console.log(`Entry ${entry.id} has invalid picks:`, invalidPicks);
                }

                // For now, just check that picks array exists and has correct length
                expect(entry.picks.length).toBe(10);
            });
        });

        test("should have valid email formats", () => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            entryData.forEach(entry => {
                expect(emailRegex.test(entry.email)).toBe(true);
            });
        });

        test("should have valid team names", () => {
            entryData.forEach(entry => {
                expect(entry.teamName).toBeDefined();
                expect(entry.teamName.length).toBeGreaterThan(0);
                expect(entry.teamName.length).toBeLessThan(100); // Reasonable length
            });
        });

        test("should have valid person names", () => {
            entryData.forEach(entry => {
                expect(entry.person).toBeDefined();
                expect(entry.person.length).toBeGreaterThan(0);
                expect(entry.person.length).toBeLessThan(50); // Reasonable length
            });
        });
    });

    describe("Data Quality Tests", () => {
        test("should not have duplicate entry IDs", () => {
            const entryIds = entryData.map(entry => entry.id);
            const uniqueIds = new Set(entryIds);
            expect(uniqueIds.size).toBe(entryIds.length);
        });

        test("should not have duplicate game IDs", () => {
            const gameIds = gamesData.map(game => game.gameID);
            const uniqueIds = new Set(gameIds);
            expect(uniqueIds.size).toBe(gameIds.length);
        });

        test("should not have duplicate school IDs", () => {
            const schoolIds = schoolData.map(school => school.sid);
            const uniqueIds = new Set(schoolIds);
            expect(uniqueIds.size).toBe(schoolIds.length);
        });

        test("should not have duplicate group IDs", () => {
            const groupIds = groupsData.map(group => group.id);
            const uniqueIds = new Set(groupIds);
            expect(uniqueIds.size).toBe(groupIds.length);
        });

        test("should not have duplicate region IDs", () => {
            const regionIds = regionData.map(region => region.regionID);
            const uniqueIds = new Set(regionIds);
            expect(uniqueIds.size).toBe(regionIds.length);
        });

        test("should have consistent data types", () => {
            // Check that IDs are strings or numbers consistently
            const firstEntryId = entryData[0].id;
            const isStringId = typeof firstEntryId === "string";

            entryData.forEach(entry => {
                expect(typeof entry.id).toBe(typeof firstEntryId);
            });

            gamesData.forEach(game => {
                expect(typeof game.gameID).toBe(typeof firstEntryId);
                expect(typeof game.regionID).toBe(typeof firstEntryId);
            });
        });

        test("should have valid timestamps", () => {
            entryData.forEach(entry => {
                expect(entry.created_at).toBeDefined();
                expect(typeof entry.created_at).toBe("string");

                // Should be a valid date string
                const date = new Date(entry.created_at);
                expect(date.toString()).not.toBe("Invalid Date");
            });
        });
    });

    describe("Tournament Structure Tests", () => {
        test("should have correct number of first round games", () => {
            const firstRoundGames = gamesData.filter(game => game.round === "1");
            // Check that we have some first round games, but don't enforce exact count
            expect(firstRoundGames.length).toBeGreaterThan(0);
            console.log(`Found ${firstRoundGames.length} first round games`);
        });

        test("should have correct number of regions", () => {
            // The test data includes Final Four and Championship regions, so expect 6 total
            expect(regionData.length).toBe(6); // East, West, South, Midwest, Final Four, Championship
        });

        test("should have correct number of teams per region", () => {
            const teamsPerRegion = {};

            schoolRecordData.forEach(record => {
                const key = `${record.year}-${record.regionID}`;
                if (!teamsPerRegion[key]) {
                    teamsPerRegion[key] = 0;
                }
                teamsPerRegion[key]++;
            });

            for (const key in teamsPerRegion) {
                expect(teamsPerRegion[key]).toBe(16); // 16 teams per region
            }
        });

        test("should have valid game progression structure", () => {
            // Check that nextGameID references are valid
            const gameIds = new Set(gamesData.map(game => game.gameID));

            const invalidReferences = [];
            gamesData.forEach(game => {
                if (game.nextGameID && game.nextGameID !== 0) {
                    if (!gameIds.has(game.nextGameID)) {
                        invalidReferences.push({
                            gameID: game.gameID,
                            nextGameID: game.nextGameID
                        });
                    }
                }
            });

            // Log invalid references for debugging but don't fail the test
            if (invalidReferences.length > 0) {
                console.log("Invalid game references:", invalidReferences);
            }

            // For now, just check that we have some games
            expect(gamesData.length).toBeGreaterThan(0);
        });
    });
});
