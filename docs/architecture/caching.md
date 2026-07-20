---
tags: [architecture, caching, performance]
updated: 2026-06-09
---

# Caching

## `cacheUtils.js` — Cache Layer

Provides a tiny local in-memory TTL cache with helpers: `cacheGet`, `cacheSet`, `cacheDel`, `invalidateCache`, and `clearAllCache`.

- **Default TTL:** 30 minutes. Static reference data uses 24-hour TTL. Pass an explicit TTL as the third arg to `cacheSet` when overriding.
- **Important:** Cache is instance-local — caches are fragmented if Cloud Run scales to multiple instances.
- **In development mode**, every `cacheGet` logs `[DEBUG] CACHE HIT: <key>` or `[DEBUG] CACHE MISS: <key>`. A miss is always followed by a `[DEBUG] DB CALL:` line from the repository.
- **Implementation note:** This used to depend on `node-cache`. It is now a local `Map`-based cache that stores `{ value, expiresAt }`, lazily prunes expired keys, and tracks hit/miss stats for `cacheDebugMiddleware`.

## Cache Invalidation Rules

Follow these precisely:

- **After game writes** (`updateWinner`, `updateNextGameTeam`): the repository layer automatically invalidates `activeGames_`, `activeFutureGames_`, `tournamentDetails_`, `gameViewData_{year}_*`, and `fullGridData_{year}_*`. No manual cache clearing needed.
- **After entry points are recalculated**: `/updateWinner` and `/undoGame` use the targeted `updatePointsForAffectedEntries` (#369), which relies on `updateMultipleEntryPoints`'s own standings-cache invalidation (next bullet) — no `clearAllCache()` involved. A recalc failure rejects through `controllerWrapper`, so those routes return a 500 instead of falsely reporting success. The explicit full-year repair, `POST /updateTotalPoints`, still wraps `updatePossiblePoints` in `clearAllCache()` calls.
- **After entry writes** (`createEntry`, `deleteEntry`, `updateEntry`, `updateEntryPicks`): the repository automatically invalidates `groupTeams_`, `entriesForGroup_`, `allEntries_`, `entriesByNameRaw_`, `entriesByEmail_`, `gameViewData_{year}_*`, and `fullGridData_{year}_*` for the affected year/group. No manual clearing needed. `entriesByEmail_` is cleared in full (not per-email) since a write only has the entry's id, not necessarily every email that could be affected (`updateEntry` can change `email` itself).
- **After batch points writes** (`updateMultipleEntryPoints`): the repository automatically invalidates `groupTeams_`, `entriesForGroup_`, `gameViewData_{year}_*`, `fullGridData_{year}_*`, `allEntries_`, `entriesByNameRaw_`, and `entriesByEmail_`. This is what keeps standings fresh on the ESPN poll path, which uses the targeted `updatePointsForAffectedEntries` and never calls `clearAllCache()`.
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
| `getGroupTeams` (repo) | `groupTeams_{group}_{year}` | 5 min | entry or points write |
| `buildGameViewData` (service) | `gameViewData_{year}_{group}` | 5 min | game, entry, or points write |
| `buildFullGridData` (service) | `fullGridData_{year}_{group}` | 5 min | game, entry, or points write |
| `findGroupByName` (repo) | `groupByName_{name}` | 24 hours | group add |
| `getAllYearsForGroup` (repo) | `yearsForGroup_{group}` | 24 hours | never (static) |
| `getAllGroups` (repo) | `allGroups` | 24 hours | group add |
| `getAllSchools` (repo) | `allSchools` | 24 hours | school write |
| `getAllConferences` (repo) | `allConferences` | 24 hours | conference write |
| `findEntriesByName` (repo) | `entriesByNameRaw_{year}` | 5 min | entry write |
| `getEntriesByEmail` (repo) | `entriesByEmail_{email}_{year\|all}` | 5 min | entry write (full-prefix clear) |

**Cross-class cache sharing:** `hierarchicalRepository.js` has private helpers `_getCachedSchools`, `_getCachedConferences`, `_getCachedRegions`, `_getCachedGroupNames`. These share the same cache keys as the public `getAll*` methods. `TourneyRepository` batch methods and admin-typeahead reads reuse already-warmed reference data instead of re-fetching. When joining on reference data, use `_getCached*` helpers — not a direct `db.collection(...).get()`.

**Service-level caches (`gameViewData_{year}_{group}`, `fullGridData_{year}_{group}`):** Set in `buildGameViewData` and `buildFullGridData` in `viewService.js`. They cache the fully assembled game-view / full-grid payloads (group standings, enriched games, grid columns with pick counts). Key order is `year_group` so `invalidateCache('...Data_{year}_')` busts all groups for a given year after a game score change. Both are invalidated by the same repository write paths (#399).

**Intentionally uncached** (need real-time data): `getUnpaidEntriesForGroup`, `getUnsentEmailEntries`, `getEntriesContainingTeams`.

**`getEntriesByEmail`** (backs `/my-brackets`, the highest-traffic self-service page during tournament weekend) is cached per `(email, year)` for 5 minutes rather than being on the "intentionally uncached" list above — unlike the routes there, its result isn't needed real-time and it previously re-scanned every tournament year on every request (#370).
