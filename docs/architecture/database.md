---
tags: [database, firestore, schema]
updated: 2026-04-12
---

# Database: Firestore Schema & Structure

The application uses Google Cloud Firestore.

## Database Backups & Restore

### Database Backups
To take a full backup of all Firestore collections, run:

```bash
GCP_PROJECT_ID=$GCP_PROJECT_ID node scripts/backup-db.mjs
```

This exports every collection to timestamped NDJSON files in `/databasebackup/` (e.g. `Mar11-2026_school.json`). Covers: `school`, `conferences`, `groups`, `regionID`, legacy flat collections (`entry`, `games`, `schoolRecord`), and all hierarchical `tournaments/{year}/*` subcollections. Email fields are present but blanked (`""`) in all exports.

### Database Restore & Seeding
To restore the core root reference collections (`school`, `conferences`, `regionID`, `groups`) from the latest backups in `/databasebackup/`, run:

```bash
GCP_PROJECT_ID=$GCP_PROJECT_ID node scripts/restore-db.mjs
```

**Supported Options:**
- `--dry-run`: Performs a dry run, parsing the backup files and listing the document count without performing any database writes.
- `--only=<collection>`: Restores only a specific collection (e.g., `--only=school`).

**Local Emulator Restore:**
To restore production backup files to a local emulator, prepend `FIRESTORE_EMULATOR_HOST`:
```bash
FIRESTORE_EMULATOR_HOST=localhost:8085 GCP_PROJECT_ID=local-dev node scripts/restore-db.mjs
```

### Local Emulator Seeding
For a fresh environment clone where `databasebackup/` is missing (due to gitignore), you can seed your local Firestore emulator using `scripts/seed-emulator.mjs`:

```bash
# Option A: Seed real NCAA D-I baseline data (from data/seed/ committed in Git)
node scripts/seed-emulator.mjs

# Option B: Seed synthetic integration test fixtures (from datafortests/ committed in Git)
node scripts/seed-emulator.mjs --test
```



## Database Schema Reference and Test Data Creation

To understand the exact structure, fields, and data types of each Firestore collection, refer to the exports in the `/databasebackup` directory. Files follow the naming pattern `{Date}_{collection}.json` with one JSON object per line. When creating mock data or writing tests, read the relevant backup file to accurately reflect the schema and data types used in production.

## Firestore Data Structure

The application supports two data structures, controlled by `APP_CONFIG.database.structure` in `/src/config/app.js` (or the `DB_STRUCTURE` environment variable):

### Hierarchical Structure (`'hierarchical'` — current default)

Year-scoped data lives under `tournaments/{year}` subcollections:

*   `tournaments/{year}` — Tournament-level document (year, timestamps, `hasFirstFour`, `firstFourGameCount`)
    *   `tournaments/{year}/regions/{regionID}` — Region info (regionID, regionName)
    *   `tournaments/{year}/games/{gameID}` — Game data (teams, winner, round, nextGameID)
    *   `tournaments/{year}/entries/{entryId}` — User entries (picks, groups, points)
    *   `tournaments/{year}/schoolRecords/{DocID}` — School records **fully denormalized** — see below for doc IDs
*   `school/{sid}` — Static school reference data (name, mascot, nameNick, confID, espn nested map)
*   `groups/{groupName}` — User-created groups (spans all years)
*   `conferences/{conferenceId}` — Conference reference data (name, shortName, active, slug)

Key benefits: no `where('year', '==', ...)` filters needed, `getTournamentTeams` is a single subcollection read (no 3-way join), and the game view render requires no joins at all.

#### `schoolRecords` fields

| Field | Source | Notes |
|---|---|---|
| `sID` | setup input | numeric school ID |
| `seed` | setup input | 1–16 |
| `regionID` | setup input | 1–6 |
| `points` | game scoring | null until first win |
| `gameStatus` | game scoring | array of `'W'`/`'L'` |
| `schoolName` | `school.name` | denormalized at setup |
| `nameNick` | `school.nameNick` | denormalized at setup |
| `mascot` | `school.mascot` | denormalized at setup |
| `regionName` | `regions/{regionID}` | denormalized at setup |
| `espnID` | `school.espn.espnID` | denormalized at setup — used for logo CDN URLs |
| `logoUrl` | `school.espn.logoURL` | denormalized at setup — note: ESPN source field is `logoURL` (capital), stored here as `logoUrl` |
| `primaryColor` | `school.espn.primaryColor` | denormalized at setup — hex without leading `#` |
| `conferenceName` | `conferences/{school.confID}.shortName` | denormalized at setup |

`insertMultipleSchoolRecords` and `updateMultipleSchoolRecords` in `TourneyRepository` write all of these in one shot by reading schools, regions, and conferences in parallel at tournament setup time. Those joins go through the shared `_getCachedSchools` / `_getCachedConferences` / `_getCachedRegions` helpers — same 24h cache keys as `getAllSchools` / `getAllConferences` / `getAllRegions`, so already-warmed reference data is reused for free. The game view render path (`buildGameViewData`) therefore needs no joins and no separate `allSchools`/`allConferences` fetches.

#### `schoolRecords` Document IDs
- **Canonical:** `{regionID}_{seed}` (e.g. `1_16`).
- **First Four:** `ff_{gameID}_{slot}` (e.g. `ff_64_1`). FF docs also have a `canonicalDocId` field (e.g. `1_16`) used to promote the winner to a canonical record upon resolution.

Repository: `/src/repositories/hierarchicalRepository.js`
*(Note: All repository methods emit `Logger.debug('DB CALL: ...')` traces. Visible only when `NODE_ENV=development` or `NODE_ENV=test`.)*

### Flat Structure (`'flat'` — legacy)

All data in top-level collections with year as a field:

*   `entry` — Doc ID: `{year}_{id}`
*   `games` — Doc ID: `{year}_{gameID}`
*   `schoolRecord` — Doc ID: `{year}_{regionID}_{seed}`
*   `school` — Doc ID: `{sid}`
*   `groups` — Doc ID: `{groupName}`
*   `regionID` — Region lookup table

Repository: `/src/repositories/firestoreRepository.js`

### Migration

To migrate from flat to hierarchical: `node databasebackup/migrate-to-hierarchical.mjs` (supports `--dry-run`). The script reads from flat collections and writes to the hierarchical structure without modifying old data.

## ESPN School Data Schema

Each `school/{sID}` document has an `espn` nested map once enriched by `scripts/enrichEspnData.js`:

```
school/{sID} {
  // ... existing fields (name, nameNick, mascot, confID, etc.)
  espn: {
    espnID:           8,
    espnSlug:         "arkansas-razorbacks",
    espnAbbreviation: "ARK",
    espnShortName:    "Arkansas",
    primaryColor:     "a32136",         // hex, no leading #
    alternateColor:   "ffffff",
    logoURL:          "https://a.espncdn.com/i/teamlogos/ncaa/500/8.png",
    fetchedAt:        "2026-03-18T..."
  }
}
```

**Important — field access path:** ESPN fields are nested under `school.espn.*`, not at the top level of the school document. Always access as `school.espn?.espnID`, `school.espn?.logoURL`, `school.espn?.primaryColor`. The field in the `espn` object is `logoURL` (capital URL), which is normalized to `logoUrl` when written into `schoolRecords`.

**Logo URL pattern:** `https://a.espncdn.com/i/teamlogos/ncaa/500/{espnID}.png` — stable CDN URLs. Dark variants at `.../500-dark/{espnID}.png`.

**ESPN conference group ID** does **not** map to our `legacyNumericID` on the conferences collection. They are separate numbering systems.

## Database Query Optimization Patterns

The repository layer enforces three patterns to keep DB cost low and avoid race conditions under heavy load.

### 1. Cached reference-data reads
Bulk setup / migration methods (`insertFirstFourGames`, `insertFirstFourSchoolRecords`, `insertMultipleSchoolRecords`, `updateMultipleSchoolRecords`, `insertMultipleGamesWithTeams`, `updateMultipleGamesWithTeams`, `insertRegionsForYear`) and admin typeaheads (`findSchoolsByName`, `findGroupByName` fallback, `findEntriesByName`) must not call `db.collection('school' | 'conferences' | 'regionID' | 'groups').get()` directly. They read through the module-private helpers in `hierarchicalRepository.js` — `_getCachedSchools`, `_getCachedConferences`, `_getCachedRegions`, `_getCachedGroupNames` — which share the same 24h cache keys as `getAllSchools` / `getAllConferences` / `getAllRegions` / `getAllGroups`, so an already-warmed cache yields zero DB reads. See `docs/architecture/caching.md` for the full cached-method table.

### 2. Atomic Firestore transactions on read-then-write
Any method that reads a record and writes back based on what it read must use `db.runTransaction` so concurrent writers (e.g. parallel ESPN poll resolutions) can't race. Methods using this pattern today:
- `GameRepository.updateNextGameTeam` — reads winner's `schoolRecords` row, writes the next game's team1/team2 slot.
- `TeamRepository.updateTeamRecord` and `updateTeamRecordWithNulls` — read all `schoolRecords` matching `sID`, write points/gameStatus.
- `TeamRepository.createCanonicalSchoolRecord` and `deleteCanonicalSchoolRecord` — read the ff_ doc's `canonicalDocId`, write/delete the canonical record.

Cache invalidation is gated on whether the transaction actually wrote (`if (updated)`) to avoid invalidation storms when nothing matched.

### 3. `array-contains-any` chunking
Firestore caps `array-contains-any` at 30 disjuncts. `GameRepository.getEntriesContainingTeams` can be called with more than 30 affected team sIDs after a bulk ESPN resolution, so it chunks the sID list into batches of 30, fires the queries in parallel, then dedupes results by entry id. Any future method that filters on an unbounded sID/value array must follow the same chunking pattern.

## Related Files

- `docs/domain.md` — Core terminology (Entry, Group, Game, School, picks array)
- `docs/features/espn-polling.md` — `scripts/enrichEspnData.js` populates the `school.espn` map
- `docs/architecture/caching.md` — Which queries are cached and at what TTLs
