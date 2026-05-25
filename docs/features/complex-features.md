---
tags: [features, points, scoring, simulation]
updated: 2026-04-12
---

# Most Complex Features

## 1. Max Possible Points & Potential Rankings (`src/services/pointsService.js`)

The most mathematically complex feature. Projects maximum possible points an entry can achieve.

*   **Pathing:** Projects future path for every active pick until the championship game.
*   **Collision Detection Algorithm:** Uses a Set-based deduplication algorithm (`removeDuplicateGames`) to avoid double-counting points when two of an entry's own picks meet each other. The Set is processed in picks order — first pick "owns" a shared future game ID; second pick's path is truncated there.
*   **Game Mapping:** `buildLookupMaps` constructs a `gameByTeam` map to find a team's next game. It sorts `activeGames` by `round` ASC during construction to ensure higher-round (current/active) games overwrite lower-round (historical/First Four) games for teams participating in both.
*   **`team.points` is cumulative:** The `points` field on a school record is total cumulative points (e.g. 5 after winning R1+R2), not per-round. `calculateTeamFuturePoints` uses `TOURNAMENT_ROUNDS[index+1].roundPoints` (incremental) to compute future value.
*   **Active team detection:** A team is still-active if `gameStatus` is empty OR its last entry is `"W"`. A last entry of `"L"` means eliminated.
*   **`possPoints` path shape:** A team that won R1 and R2 has `gameStatus = ["W","W"]`. Future path starts as `["W","W", nextGameID, ...]`. `calculateTeamFuturePoints` skips `"W"` entries and scores only the game IDs.
*   **First Four (FF) handling:** FF games (Round 0) are excluded from scoring paths and award zero points. If `nextGameID` points to a Round 0 game, `calculateEntryPointsAndPaths` skips it and begins the path at the Round 1 game it feeds into.
*   **Ranking Simulation:** `possibleRanking` simulates best-case scenarios. `minPoints` guarantees a floor by finding pairs of an entry's own picks destined to meet in the same future game. `getHighestPlace` compares an entry's max potential against every other entry's guaranteed minimum.
*   **Early-exit bounds optimization:** `getHighestPlace` uses pre-computed `maxPoints` (ceiling) and `points` (floor) for each entry to skip the expensive unique-pick analysis when absolute bounds already determine the outcome. Two fast paths: (1) if A's ceiling < B's current points, B definitely wins; (2) if A's current points > B's ceiling, A definitely wins. When `maxPoints` is absent (e.g., manually constructed test entries), the optimization is safely bypassed. This reduces work significantly when entries are far apart in the standings.
*   **Cross-iteration `minPoints` caching:** In `getHighestPlace`, the inner loop evaluates `otherRelativeMin = minPoints(otherUniquePaths, otherEntry.points)` for every (entry, otherEntry) pair. Across the O(N²) outer pairing, most (otherEntry, unique-picks-subset) tuples recur. We represent each subset as a bitmask over `otherEntry.picks` indices and cache the result per `otherEntry.entryID` inside a shared `otherMinCaches` Map passed from `enrichEntriesWithPotentialRankings`. Cache hits skip the `minPoints` call entirely. Hit rate scales with shared-pick locality across the group; it is highest when many entries make similar picks (the common case for popular favorites). Complementary to the `minPoints` single-pass rewrite, which keeps cache misses cheap.
*   **`enrichEntriesWithPotentialRankings` stores `maxPoints`:** The enrichment pass now preserves `maxPoints` from `calculateEntryPointsAndPaths` on each entry object, enabling the early-exit optimization in `getHighestPlace`.
*   **Test coverage:** `tests/pointsService.pure.test.js` covers all exported functions including early-exit optimization paths (boundary equality, graceful fallback without `maxPoints`, property test verifying results match with/without optimization). The live E2E V2 test verifies `possibleRanking` end-to-end against real Firestore.

## 2. Playground — Client-Side Simulation (`src/services/playgroundService.js`, `views/playground.ejs`)

Read-only "what-if" feature — pick hypothetical winners and see standings impact.

*   **No DB writes, no sessions.** Service layer only reads (via `getAllTournamentDetails`, which is cached). All simulated state lives in a plain JS `let` array on the page.
*   **Client-side data embedding pattern.** Server serializes all needed data as JSON into a `<script>` tag at page load using the `safeJson` helper. All computation runs in the browser — zero additional network calls after load.
*   **Event delegation required for dynamically generated HTML.** CSP blocks inline `onclick` on `innerHTML`-inserted elements. All click handlers use event delegation on stable parent containers.
*   **Scoring uses `gameStatus[]`, not `schoolRecord.points`.** The authoritative source for points is iterating each pick's `gameStatus` array and summing `roundPoints[i]` for every `'W'`. The `points` field on school records is a denormalized DB convenience — must not be relied on for scoring logic in simulation or testing.
*   **Bracket chain advancement.** When simulating a winner: update `game.winner`, push `'W'`/`'L'` to the school record's `gameStatus`, look up `game.nextGameID`, and set `nextGame.team1ID` or `nextGame.team2ID` (per `game.nextGameSpot`). Apply all picks sorted by `round` ascending.
*   **`getAllTournamentDetails` — team name enrichment.** The `allGames` array does NOT include team names — only `team1ID`/`team2ID`. To get names/seeds, build a `new Map(teams.map(t => [t.sID, t]))` for O(1) lookup.

## 3. Game Advancement & Undo Logic (`src/services/gameService.js`)

*   **Advancing:** When a team wins (`updateWinner`), look up `nextGameID` and place the winning `sID` into the correct spot (Team 1 or Team 2) of that future game.
*   **Undoing:** `undoGame` must cleanly roll back state. If undoing a Round 1 game where the team had already advanced and played in Round 2, the system must cascade the deletion without corrupting the rest of the bracket.

## Related Files

- `docs/private/development/testing.md` — Test coverage details for pointsService, viewService, and First Four
- `docs/private/development/contributing.md` — `buildLookupMaps` performance rules, batch write patterns
- `docs/features/espn-polling.md` — How game winners flow from ESPN into the DB
