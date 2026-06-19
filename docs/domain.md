---
tags: [domain, terminology]
updated: 2026-04-12
---

# Domain Terminology

Core concepts and vocabulary for the bracket application. Use these definitions when reading or writing about the codebase.

## Entities

* **Tournament (Bracket)**: Structured single-elimination competition. Typically 68 teams, 67 games, and 7 rounds. Tracks team advancement to a single champion.
* **Game**: Matchup between two Teams in a Tournament. One winner advances; one loser is eliminated. Stored at `tournaments/{year}/games/{gameID}`.
* **Team (School)**: Represented statically in `school` collection and dynamically in `tournaments/{year}/schoolRecords/{DocID}`. Doc IDs are canonical (`{regionID}_{seed}`) or First Four (`ff_{gameID}_{slot}`).
* **Entry**: Exactly **10 Teams** picked by a user. Stored at `tournaments/{year}/entries/{entryId}`.
* **Group**: Collection of Entries competing together. Stored in `groups` collection. Example: **"Bob"**.
* **Conference**: College athletic conference (e.g. SEC, ACC). Stored in `conferences` collection.

## Points System

Points are cumulative. A team reaching the Elite Eight earns 2+3+5+9 = 19 total points. The `points` field on `schoolRecord` stores this value. Round weights:

| Round | Teams Remaining | Points | round (int) |
|-------|----------------|--------|-------------|
| First Four | 68 → 64 | 0 | 0 |
| Round of 64 | 64 → 32 | 2 | 1 |
| Round of 32 | 32 → 16 | 3 | 2 |
| Sweet 16 | 16 → 8 | 5 | 3 |
| Elite Eight | 8 → 4 | 9 | 4 |
| Final Four | 4 → 2 | 17 | 5 |
| Championship | 2 → 1 | 33 | 6 |

**First Four pick lifecycle:** participants pick a First Four matchup as ONE
combined option ("Team A / Team B", stored as `team1ID`) worth 0 points win or
lose. When the FF game resolves, every entry holding that slot is auto-swapped
to the winner — whoever the user picked, they get the winner. Picks submitted
through any create/edit flow are normalized against live game state at write
time (`normalizeFirstFourPicks`). If an admin undoes an FF game, picks revert
to the combined value and the game is held from poll re-resolution until a
result is recorded or the hold is released.

## Tournament Structure

Divided into 4 quadrants before the Final Four:

| Region ID | Name |
|-----------|------|
| 1 | East |
| 2 | West |
| 3 | South |
| 4 | Midwest |
| 5 | Final Four (semi-finals) |
| 6 | Championship |
| 7 | First Four |

Each region has seeds 1–16. Game ID ranges: Region 1 (1–15), Region 2 (16–30), Region 3 (31–45), Region 4 (46–60). First Four starts at 64. Championship is game 63.

## Key Field Names

| Field | Location | Meaning |
|-------|----------|---------|
| `sID` | school, schoolRecord | Internal school ID (primary key for team lookups) |
| `gameID` | games | Unique game identifier |
| `nextGameID` | games | Destination game ID for the winner |
| `nextGameSpot` | games | Destination slot (`team1ID` or `team2ID`) in the next game |
| `gameStatus` | schoolRecord | Array of `"W"`/`"L"` tracking round results |
| `picks` | entry | Array of 10 picked `sID` values |
| `emailSent` | entry | `true` if confirmation email was sent |
| `round` | games | Round number (0–6) — stored as a number, check types in tests |
