## Live E2E V2 Test — Real 2022 Bracket Data (Firestore Hierarchical)

This guide explains how to run the V2 live end-to-end test. Unlike the original `e2e-2020.live.test.js`
(which uses a 4-game synthetic bracket), this test seeds year `2020` with the **full real 2022
NCAA tournament bracket** — 64 teams across 4 regions, 63 games total.

### What this test does

- Seeds year `2020` with the complete 2022 bracket via `createNewBracket` (64 teams, 63 games, 4 regions + Final Four + Championship).
- **Verifies bracket shape** via `getAllTournamentDetails`:
  - 64 school records with real school names denormalized
  - 63 total games; 32 active (round-1) games
  - 6 regions
- **Plays 4 round-1 games** using real 2022 team IDs (e.g. seed 1 region 1 vs seed 16, etc.).
- **Verifies winner propagation** — confirms the round-2 game's team slots are filled after round-1 winners are recorded.
- **Undoes one game** and verifies the winner reverts to `null` and the round-2 slot clears.
- **Creates an entry** with 10 real 2022 team IDs as picks under group `E2E-V2-Temp-2020`.
- **Verifies `getEntriesForGroup`** returns the new entry with the correct picks.
- **Updates the entry** (teamName change) and verifies the change persisted.
- **Runs `updatePossiblePoints(2020)`** and verifies `totalPoints` / `possPoints` are numeric.
- **Deletes the entry** and confirms it is gone.
- Cleans up all year-2020 data at the end: games, schoolRecords, regions (and any e2e entries).

Relevant source files:
- `tests/e2e-v2.live.test.js`
- `src/services/tourneyService.js`
- `src/services/gameService.js`
- `src/services/viewService.js`
- `src/services/pointsService.js`
- `src/repositories/hierarchicalRepository.js`

### Safety and scope

- Disabled by default — only runs when `LIVE_E2E=true` is set.
- Operates **exclusively on year `2020`**. No production data is touched.
- Performs a pre-clean and post-clean to guarantee a predictable state.

### Prerequisites

- Firestore credentials configured (`GOOGLE_APPLICATION_CREDENTIALS` or Workload Identity on GCP).
- All 2022 team IDs (67, 33, 116, 28, 55, 10, 73, 43, 58, 121, …) must exist in the top-level
  `school` collection — they do, as they are real historical schools.
- Node dependencies installed (`npm install`).

### How to run

```bash
npm run test:live-e2e-v2
```

Expected output: all assertions pass, no year-2020 data remains in the DB after the run.

To run alongside the original E2E:

```bash
npm run test:live-e2e       # original 4-game synthetic test
npm run test:live-e2e-v2    # this test — full 64-team 2022 bracket
```

### Data created (and removed)

| Collection | What is written | Cleaned up |
|---|---|---|
| `tournaments/2020/games` | 63 game docs | ✅ `deleteGamesByYear(2020)` |
| `tournaments/2020/schoolRecords` | 64 school record docs | ✅ `deleteSchoolRecordsByYear(2020)` |
| `tournaments/2020/regions` | 6 region docs | ✅ `deleteRegionsByYear(2020)` |
| `tournaments/2020/entries` | 1 temp entry | ✅ `deleteEntry(...)` then post-clean |

### What this covers beyond the original E2E

| Coverage | Original (4-game) | V2 (64-team 2022) |
|---|---|---|
| Full 63-game bracket topology | ❌ | ✅ |
| Real school name denormalization | ❌ | ✅ |
| `getAllTournamentDetails` shape assertions | ❌ | ✅ |
| Winner propagation check | ❌ | ✅ |
| `getEntriesForGroup` | ❌ | ✅ |
| Region cleanup (`deleteRegionsByYear`) | ❌ | ✅ |
| First Four game creation + resolution + undo | ❌ | ✅ |
| FF pick auto-swap (loser → winner) | ❌ | ✅ |
| FF possPoints: path starts at R1 (not FF game) | ❌ | ✅ |
| `getAllYearsForGroup` | ❌ | ✅ |
| `getEntriesContainingTeams` | ❌ | ✅ |
| `buildFullGridData` shape + entry points | ❌ | ✅ |

### Troubleshooting

- If the test fails mid-run, re-run it — the pre-clean step will remove any leftover year-2020 data.
- Ensure your credentials have `read/write/delete` on Firestore collections: `tournaments`, `school`, `groups`, `regionID`.
