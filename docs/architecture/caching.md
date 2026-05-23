---
tags: [architecture, caching, performance]
updated: 2026-05-09
---

# Caching

## `cacheUtils.js` — Cache Layer

Provides a tiny local in-memory TTL cache with helpers: `cacheGet`, `cacheSet`, `cacheDel`, `invalidateCache`, `clearAllCache`, and `cacheMiddleware`.

- **Default TTL:** 30 minutes. Static reference data uses 24-hour TTL. Pass an explicit TTL as the third arg to `cacheSet` when overriding.
- **Important:** Cache is instance-local — caches are fragmented if Cloud Run scales to multiple instances.
- **In development mode**, every `cacheGet` logs `[DEBUG] CACHE HIT: <key>` or `[DEBUG] CACHE MISS: <key>`. A miss is always followed by a `[DEBUG] DB CALL:` line from the repository.
- **Implementation note:** This used to depend on `node-cache`. It is now a local `Map`-based cache that stores `{ value, expiresAt }`, lazily prunes expired keys, and tracks hit/miss stats for `cacheDebugMiddleware`.

## Cache Invalidation Rules

Follow these precisely:

- **After game writes** (`updateWinner`, `updateNextGameTeam`): the repository layer automatically invalidates `activeGames_`, `activeFutureGames_`, `tournamentDetails_`, and `gameViewData_{year}_*`. No manual cache clearing needed.
- **After entry points are recalculated** (`updateTotalPointsJustYear`): call `clearAllCache()` once **after** `updatePossiblePoints` finishes. Do NOT call it before — game/team caches are still needed for reads inside `updatePossiblePoints`.
- **After entry writes** (`createEntry`, `deleteEntry`, `updateEntry`, `updateEntryPicks`): the repository automatically invalidates `groupTeams_`, `entriesForGroup_`, and `allEntries_` for the affected year/group. No manual clearing needed.
- **`clearAllCache()`** is a broad nuke — only use it after bulk write operations (point recalculation, tournament reset). Do not call it before reads.

## Cached Methods Reference

| Method / Layer | Cache key pattern | TTL | Invalidated by |
|---|---|---|---|
| `getActiveGames` (repo) | `activeGames_{year}` | 5 min | game write |
| `getActiveAndFutureGames` (repo) | `activeFutureGames_{year}` | 5 min | game write |
| `getAllTournamentDetails` (repo) | `tournamentDetails_{year}` | 5 min | game write |
| `getTournamentTeams` (repo) | `allTeamNames_{year}` | 24 hours | schoolRecord write |
| `getAllEntries` (repo) | `allEntries_{year}` | 30 min | entry write |
| `getEntriesForGroup` (repo) | `entriesForGroup_{group}_{year}` | 30 min | entry write |
| `getGroupTeams` (repo) | `groupTeams_{group}_{year}` | 5 min | entry write |
| `buildGameViewData` (service) | `gameViewData_{year}_{group}` | 5 min | game write or entry write |
| `findGroupByName` (repo) | `groupByName_{name}` | 24 hours | group add |
| `getAllYearsForGroup` (repo) | `yearsForGroup_{group}` | 24 hours | never (static) |
| `getAllGroups` (repo) | `allGroups` | 24 hours | group add |
| `getAllSchools` (repo) | `allSchools` | 24 hours | school write |
| `getAllConferences` (repo) | `allConferences` | 24 hours | conference write |

**Service-level cache (`gameViewData_{year}_{group}`):** Set in `buildGameViewData` in `viewService.js`. Caches the fully assembled game view payload (group standings, enriched games, team data). Key order is `year_group` so `invalidateCache('gameViewData_{year}_')` busts all groups for a given year after a game score change.

**Intentionally uncached** (need real-time data): `getUnpaidEntriesForGroup`, `getUnsentEmailEntries`.

## Related Files

- `docs/architecture/utilities.md` — Logger and error utilities used throughout the cache layer
- `docs/architecture/deployment.md` — Cloud Run multi-instance caveat (cache fragmentation)
