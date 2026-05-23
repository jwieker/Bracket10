---
tags: [domain, terminology]
updated: 2026-04-12
---

# Domain Terminology

Core concepts and vocabulary for the bracket application. Use these definitions when reading or writing about the codebase.

## Entities

**Tournament (Bracket)**
A structured single-elimination competition. Typically 68 teams, 67 games (4 play-ins + 63 main bracket), 7 rounds (including Round 0). The bracket represents the full sequence of games and how teams advance to one winner.

**Game**
A single matchup between two Teams within a Tournament. Results in one winner (who advances) and one loser (who is eliminated). Stored in `tournaments/{year}/games/{gameID}`.

**Team (School)**
A participating entity representing a university. Stored in the `school` collection (static reference data) and in `tournaments/{year}/schoolRecords/{DocID}` (denormalized with tournament-year data). Doc IDs are either canonical `{regionID}_{seed}` or First Four `ff_{gameID}_{slot}`.

**Entry**
A list of exactly **10 Teams** selected by a participant — their predictions for which teams will advance deepest. Stored in `tournaments/{year}/entries/{entryId}`.

**Group**
A collection of Entries competing together in a friendly competition. Stored in the `groups` collection (spans all years). Example group used in dev/testing: **"Bob"**.

**Conference**
A college basketball conference (e.g. SEC, ACC). Stored in the `conferences` collection.

## Points System

Points are awarded for each game a picked team wins, with increasing value per round:

| Round | Teams Remaining | Points | round (int) |
|-------|----------------|--------|-------------|
| First Four | 68 → 64 | 0 | 0 |
| Round of 64 | 64 → 32 | 2 | 1 |
| Round of 32 | 32 → 16 | 3 | 2 |
| Sweet 16 | 16 → 8 | 5 | 3 |
| Elite Eight | 8 → 4 | 9 | 4 |
| Final Four | 4 → 2 | 17 | 5 |
| Championship | 2 → 1 | 33 | 6 |

Points are cumulative: a team that reaches the Elite Eight has earned 2+3+5+9 = 19 total points. The `points` field on `schoolRecord` documents stores this cumulative value.

## Tournament Structure

The bracket is divided into 4 regional brackets before the Final Four:

| Region ID | Name |
|-----------|------|
| 1 | East |
| 2 | West |
| 3 | South |
| 4 | Midwest |
| 5 | Final Four (semi-finals) |
| 6 | Championship |
| 7 | First Four |

Each region has 16 teams seeded 1–16. Game ID blocks per region: Region 1 → games 1–15, Region 2 → games 16–30, Region 3 → games 31–45, Region 4 → games 46–60. First Four games start at 64. Championship is game 63.

## Key Field Names

| Field | Location | Meaning |
|-------|----------|---------|
| `sID` | school, schoolRecord | Internal school ID — primary key for team lookups |
| `gameID` | games | Internal game identifier |
| `nextGameID` | games | ID of the game the winner advances to |
| `nextGameSpot` | games | Whether winner goes to `team1ID` or `team2ID` of next game |
| `gameStatus` | schoolRecord | Array of `"W"`/`"L"` entries tracking a team's round-by-round result |
| `picks` | entry | Array of 10 `sID` values the participant selected |
| `emailSent` | entry | `true` if the bracket confirmation email has been sent |
| `round` | games | Stored as a **number** (e.g. `1` for Round 1) — check types in tests |

## Related Files

- `docs/architecture/database.md` — Firestore collection schemas and document IDs
- `docs/features/complex-features.md` — Scoring algorithms, max possible points logic
- `docs/private/development/testing.md` — Test data constraints (10 picks, 63 games, seed counts)
