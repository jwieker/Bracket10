import { Filter, FieldValue, Firestore } from '@google-cloud/firestore';
import { db } from '../config/firestore.js';
import { thisYear, APP_CONFIG } from '../config/app.js';
import Logger from '../utils/logger.js';
import {
  cacheGet,
  cacheSet,
  cacheDel,
  invalidateCache,
} from '../utils/cacheUtils.js';
import { ValidationError } from '../utils/errors.js';

// Entries whose only group is in this list are filtered out of standard listings.
// Historically "Bad" was a sandbox group whose entries shouldn't appear in pick
// counts, rankings, or all-entries reads. Configure via APP_CONFIG.tournament.excludedGroups.
const EXCLUDED_GROUPS = new Set(APP_CONFIG.tournament.excludedGroups || []);
function isExcludedOnlyGroup(groups) {
  return groups.length === 1 && EXCLUDED_GROUPS.has(groups[0]);
}
export const _isExcludedOnlyGroupForTests = isExcludedOnlyGroup;

// Soft-deleted entries (see EntryRepository.deleteEntry) carry a `deletedAt`
// timestamp instead of being removed from Firestore. Every user-facing read
// filters them out with this helper so a deleted entry disappears from
// rankings, pick counts, group views, and name search while the document
// (and its picks) stays intact for admin restore/purge.
function isDeletedEntry(data) {
  return !!data.deletedAt;
}

// School ids 999990–999999 are reserved for live-E2E fixtures (see
// docs/private/development/testing.md § Data safety). Real schools are never
// allocated into this block — see getMaxSchoolId.
const RESERVED_TEST_SID_MIN = 999990;

// Years 9988+ are reserved for live-E2E fixtures (see
// docs/private/development/testing.md § Data safety), mirroring the reserved
// SID block above. `parseYear` caps a real season at currentYear + 1, so the
// two ranges can never overlap — which is what makes the reserved block
// structurally safe rather than safe-by-coincidence. Seeding a live test into
// a real-looking year is safe only for as long as that year stays empty.
const RESERVED_TEST_YEAR_MIN = 9988;

// True only under vitest or an explicitly flagged live-E2E run. Never set in
// the deployed app, which is what makes it usable as a safety boundary.
const isTestContext = () =>
  process.env.NODE_ENV === 'test' || process.env.LIVE_E2E === 'true';

// ─── Path helpers ─────────────────────────────────────────────────

const toNum = (v) => (v == null ? v : Number(v));

/**
 * Validates a year and returns its `tournaments/{year}` path segment.
 *
 * Rejects any year that isn't a positive integer (#477, #598). The original
 * guard tested only `Number.isNaN`, which caught "abc" but let through the
 * shapes a forgetful caller actually produces: `''` coerces to **0**, and
 * `undefined`/`null` pass `toNum` unchanged and fail `Number.isNaN`. All of
 * them build a real path — `tournaments/0`, `tournaments/undefined`,
 * `tournaments/null` — because `String(x)` is a valid segment for every one.
 * Reads then return [] and the caller reports "nothing here"; writes land in
 * a junk document; and any cache bust on the same call targets
 * `allEntries_0` / `allEntries_undefined`, leaving the real year's cache stale.
 *
 * **Every `tournaments/{year}` path must be built through this**, not just the
 * subcollection helper below. The doc-level callers (pendingRecalcSIDs, the
 * tournament-doc upsert/delete, the parent-doc batch writes) address that path
 * directly, so a guard that lived only in `yearCol` left the writes among them
 * unprotected — `upsertTournamentDoc(undefined)` would *create* a real
 * `tournaments/undefined` document rather than merely read an empty one.
 *
 * Deliberately *narrower* than `parseYear`: this checks "is this a usable path
 * segment", not "is this a plausible season". `parseYear` bounds the year to
 * 1980..currentYear+1 at the controller boundary, and that range must NOT be
 * mirrored here — the live E2E suites address reserved years (9996/9997/9999)
 * through this layer, so a season-range check would reject them. Controllers
 * stay the first line of defense; this backstops the ones that forget.
 */
function yearSegment(year) {
  const n = toNum(year);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`Invalid year: ${year}.`, 'year');
  }
  // The reserved block is addressable only from a test context, so a bug or a
  // hostile input in the deployed app can never read or write the sentinel
  // years the live suites depend on being theirs alone.
  if (n >= RESERVED_TEST_YEAR_MIN && !isTestContext()) {
    throw new ValidationError(
      `Invalid year: ${year}. Years ${RESERVED_TEST_YEAR_MIN}+ are reserved for tests.`,
      'year',
    );
  }
  return String(n);
}

/**
 * Validates a year for a **bulk, year-scoped delete** — the operations that
 * wipe every document for a year rather than the ones a caller created.
 *
 * Production deletes real years legitimately (the admin delete-tournament
 * flow), so the real-year restriction applies only under a live-E2E run. That
 * inverts the reserved block for exactly the destructive calls: in a live test,
 * these may target the reserved years and nothing else. It turns
 * testing.md's written rule — "never pass a real tournament year to them" —
 * into something enforced, instead of a convention each new live test has to
 * remember. A live suite pointed at a real season now fails loudly before the
 * first delete rather than emptying that season's collections.
 */
function bulkDeleteYearSegment(year) {
  const seg = yearSegment(year);
  if (process.env.LIVE_E2E === 'true' && Number(seg) < RESERVED_TEST_YEAR_MIN) {
    throw new ValidationError(
      `Refusing a year-scoped delete of ${seg} during a live-E2E run: only years ${RESERVED_TEST_YEAR_MIN}+ are deletable in tests.`,
      'year',
    );
  }
  return seg;
}

/**
 * True if a doc id read out of the `tournaments` collection is safe to fan out
 * on. A stored id is data-hygiene input, not caller input: a bad one is a row
 * to skip and log, never a reason to fail the caller's page. Both enumeration
 * sites wrap their per-year work in `Promise.all`, so one leftover
 * `tournaments/9999` (or a legacy `tournaments/0`) would otherwise reject the
 * whole call and answer every signed-in user a 400.
 *
 * Delegates to `yearSegment` rather than restating its bounds so the two can
 * never drift — including the reserved block staying addressable from a test
 * context, which the live suite depends on (it asserts getAllYearsForGroup
 * *returns* 9988/9989 under LIVE_E2E). `yearSegment` itself stays exactly as
 * strict as it is for caller-supplied years.
 */
function isEnumerableYearId(id) {
  try {
    yearSegment(id);
    return true;
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    Logger.warn(`Skipping unusable tournaments doc id: ${id}`);
    return false;
  }
}

/** Returns a subcollection ref under tournaments/{year} */
function yearCol(year, sub) {
  return db.collection('tournaments').doc(yearSegment(year)).collection(sub);
}

/** Direct doc ref inside a year-scoped subcollection */
function yearDoc(year, sub, docId) {
  return yearCol(year, sub).doc(String(docId));
}

/**
 * Orders entries by registration time. Entry ids used to be timestamp-based,
 * so sorting by `a.id - b.id` happened to yield registration order. Ids are now
 * cryptographically random (and unordered), so sort by the `created_at` field
 * instead, with the id as a stable tiebreaker for any legacy rows missing it.
 */
function byRegistrationOrder(a, b) {
  // created_at is normally an ISO string, but tolerate native Date and
  // Firestore Timestamp values (which expose .toDate()) for legacy/admin rows.
  const toMs = (val) => {
    if (!val) return 0;
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (val instanceof Date) return val.getTime();
    return Date.parse(val) || 0;
  };
  const ta = toMs(a.created_at);
  const tb = toMs(b.created_at);
  if (ta !== tb) return ta - tb;
  // Stable tiebreaker (relational compare works for numeric and string ids).
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ─── Cached reference-data helpers ────────────────────────────────
// These share cache keys with the public TeamRepository.getAllSchools,
// ConferenceRepository.getAllConferences, TourneyRepository.getAllRegions, and
// ViewRepository.getAllGroups methods (24h TTL, invalidated by the same writes),
// so any code path that has already warmed those caches makes subsequent calls
// here free. Used internally by batch insert/update methods that previously
// re-fetched the full school / conference / region collections on every call.

async function _getCachedSchools() {
  const cacheKey = 'allSchools';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  Logger.debug('DB CALL: H._getCachedSchools');
  // Order by name asc so the admin tournament-setup <select> dropdowns
  // (newTourneyComplete.ejs / editTourneyGames.ejs / newTourneyGames.ejs)
  // render in alphabetical order. Previously getAllTeams sorted but
  // getAllSchools did not — both share the allSchools cache, so order
  // depended on whichever warmed the cache first.
  const snap = await db.collection('school').orderBy('name', 'asc').get();
  const result = snap.docs.map((doc) => doc.data());
  cacheSet(cacheKey, result, 86400);
  return result;
}

async function _getCachedConferences() {
  const cacheKey = 'allConferences';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  Logger.debug('DB CALL: H._getCachedConferences');
  const snap = await db.collection('conferences').orderBy('name', 'asc').get();
  const result = snap.docs.map((doc) => ({ slug: doc.id, ...doc.data() }));
  cacheSet(cacheKey, result, 86400);
  return result;
}

async function _getCachedRegions(year) {
  const cacheKey = `allRegions_${year}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  Logger.debug('DB CALL: H._getCachedRegions');
  const snap = await yearCol(year, 'regions').orderBy('__name__', 'asc').get();
  const result = snap.docs.map((doc) => doc.data());
  cacheSet(cacheKey, result, 86400);
  return result;
}

// Map builders over the cached arrays — kept inline-like so callsites don't
// rebuild the same Map shape over and over inside the same request.
function _buildSchoolsBySid(schools) {
  const m = new Map();
  for (const s of schools) m.set(String(s.sid), s);
  return m;
}

function _buildConfNameMap(conferences) {
  const m = new Map();
  for (const c of conferences) m.set(c.slug, c.shortName || c.name || null);
  return m;
}

function _buildRegionNameMap(regions) {
  const m = new Map();
  for (const r of regions) m.set(String(r.regionID), r.regionName);
  return m;
}

// ─── Bracket-creation document builders ───────────────────────────
// Pure "shape the doc" functions, factored out of the insert* methods below
// so createBracketAtomic can share the exact same document construction
// instead of duplicating it. None of these read or write Firestore.

function _buildRegionDoc(region) {
  return { ...region };
}

function _buildGameWithoutTeamsDoc(game) {
  const [gameID, regionID, , , , , round, nextGameID, nextGameSpot] = game;
  return {
    gameID,
    regionID,
    round,
    team1ID: null,
    team2ID: null,
    winner: null,
    nextGameID: nextGameID ?? null,
    nextGameSpot: nextGameSpot ?? null,
  };
}

function _buildGameWithTeamsDoc(game, schoolsMap) {
  const [
    gameID,
    regionID,
    ,
    team1ID,
    team2ID,
    ,
    round,
    nextGameID,
    nextGameSpot,
    seed1,
    seed2,
  ] = game;
  const school1 = team1ID != null ? schoolsMap.get(String(team1ID)) || {} : {};
  const school2 = team2ID != null ? schoolsMap.get(String(team2ID)) || {} : {};
  return {
    gameID,
    regionID,
    team1ID: team1ID ?? null,
    team2ID: team2ID ?? null,
    round,
    team1Name: school1.nameNick || school1.name || null,
    team1Seed: seed1 ?? null,
    team2Name: school2.nameNick || school2.name || null,
    team2Seed: seed2 ?? null,
    winner: null,
    nextGameID: nextGameID ?? null,
    nextGameSpot: nextGameSpot ?? null,
  };
}

function _buildSchoolRecordDoc(record, schoolsMap, regionsMap, confNameMap) {
  const school = schoolsMap.get(String(record.sID)) || {};
  const regionName = regionsMap.get(String(record.regionID)) || null;
  const espn = school.espn || {};
  return {
    sID: toNum(record.sID),
    seed: record.seed,
    regionID: record.regionID,
    points: null,
    gameStatus: [],
    schoolName: school.name || null,
    nameNick: school.nameNick || null,
    mascot: school.mascot || null,
    regionName,
    espnID: espn.espnID ?? null,
    logoUrl: espn.logoURL ?? null,
    primaryColor: espn.primaryColor ?? null,
    conferenceName: confNameMap.get(school.confID) ?? null,
  };
}

function _buildFirstFourGameDoc(game, schoolsMap) {
  const school1 = schoolsMap.get(String(game.team1ID)) || {};
  const school2 = schoolsMap.get(String(game.team2ID)) || {};
  return {
    gameID: game.gameID,
    regionID: 7,
    round: 0,
    team1ID: game.team1ID,
    team1Name: school1.nameNick || school1.name || null,
    team1Seed: game.seed ?? null,
    team2ID: game.team2ID,
    team2Name: school2.nameNick || school2.name || null,
    team2Seed: game.seed ?? null,
    winner: null,
    nextGameID: game.nextGameID,
    nextGameSpot: game.nextGameSpot,
  };
}

function _buildFirstFourSchoolRecordDoc(
  record,
  schoolsMap,
  regionsMap,
  confNameMap,
) {
  const school = schoolsMap.get(String(record.sID)) || {};
  const espn = school.espn || {};
  const regionName = regionsMap.get(String(record.r1RegionID)) || null;
  return {
    sID: toNum(record.sID),
    seed: record.seed,
    regionID: record.r1RegionID,
    canonicalDocId: `${record.r1RegionID}_${record.seed}`,
    points: null,
    gameStatus: [],
    schoolName: school.name || null,
    nameNick: school.nameNick || null,
    mascot: school.mascot || null,
    regionName,
    espnID: espn.espnID ?? null,
    logoUrl: espn.logoURL ?? null,
    primaryColor: espn.primaryColor ?? null,
    conferenceName: confNameMap.get(school.confID) ?? null,
  };
}

async function _getCachedGroupNames() {
  const cacheKey = 'allGroups';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  Logger.debug('DB CALL: H._getCachedGroupNames');
  const snap = await db.collection('groups').orderBy('name', 'asc').get();
  const result = snap.docs.map((doc) => doc.data().name);
  cacheSet(cacheKey, result, 86400);
  return result;
}

// ─── EntryRepository ──────────────────────────────────────────────

export class EntryRepository {
  /**
   * Update points for multiple entries.
   */
  async updateMultipleEntryPoints(pointsChunk, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.updateMultipleEntryPoints');
    try {
      try {
        const batch = db.batch();
        for (let i = 0; i < pointsChunk.length; i++) {
          const { entryID, points, possPoints } = pointsChunk[i];
          const ref = yearDoc(year, 'entries', toNum(entryID));
          batch.update(ref, { totalPoints: points, possPoints });
        }
        await batch.commit();
      } catch (error) {
        // Firestore batches are atomic: one missing doc (an entry deleted
        // between the caller's read and this commit) fails all ≤500 updates
        // in the chunk. Retry with only the docs that still exist so a
        // single deletion can't leave a whole chunk's standings stale.
        Logger.warn(
          `updateMultipleEntryPoints: batch commit failed (${error.message}); retrying with existence check`,
        );
        const refs = pointsChunk.map(({ entryID }) =>
          yearDoc(year, 'entries', toNum(entryID)),
        );
        const snapshots = await db.getAll(...refs);
        const retryBatch = db.batch();
        let retried = 0;
        snapshots.forEach((snap, i) => {
          if (snap.exists) {
            const { points, possPoints } = pointsChunk[i];
            retryBatch.update(refs[i], { totalPoints: points, possPoints });
            retried++;
          }
        });
        if (retried > 0) await retryBatch.commit();
        Logger.info(
          `updateMultipleEntryPoints: retried ${retried}/${pointsChunk.length} entries (skipped ${pointsChunk.length - retried} missing)`,
        );
      }
      // Bust standings caches so targeted points updates (ESPN poll path,
      // which never calls clearAllCache) are visible immediately on THIS
      // process. The poll job runs in its own container and web instances
      // each keep a private cache, so cross-process freshness is bounded
      // only by the cache TTLs (300s on all live-scoring keys).
      invalidateCache('groupTeams_');
      invalidateCache('entriesForGroup_');
      invalidateCache(`gameViewData_${year}_`);
      invalidateCache(`fullGridData_${year}_`);
      cacheDel(`allEntries_${year}`);
      cacheDel(`entriesByNameRaw_${year}`);
      invalidateCache('entriesByEmail_');
    } catch (error) {
      Logger.error('Error in updateMultipleEntryPoints:', error);
      throw error;
    }
  }

  async createEntry(
    id,
    email,
    teamName,
    picks,
    groupName,
    personName,
    created_at,
    year = thisYear,
    maxPoints = 0,
  ) {
    Logger.debug('DB CALL: H.EntryRepository.createEntry');
    const groups = Array.isArray(groupName) ? groupName : [groupName];
    await yearDoc(year, 'entries', id).set({
      id,
      email,
      teamName,
      picks,
      groups,
      person: personName,
      created_at,
      possPoints: maxPoints,
      totalPoints: 0,
    });
    groups.forEach((g) => {
      cacheDel(`groupTeams_${g}_${year}`);
      cacheDel(`entriesForGroup_${g}_${year}`);
      cacheDel(`gameViewData_${year}_${g}`);
      cacheDel(`fullGridData_${year}_${g}`);
      // A group's first entry of a new year must show up in its year
      // dropdown without waiting out the yearsForGroup_ TTL.
      cacheDel(`yearsForGroup_${g}`);
    });
    cacheDel(`allEntries_${year}`);
    cacheDel(`entriesByNameRaw_${year}`);
    invalidateCache('entriesByEmail_');
  }

  async findEntriesByName(name, year = thisYear) {
    // The admin typeahead hits this on every keystroke; without a shared
    // cache, an N-letter search costs N full reads of the year's entries
    // subcollection. Cache the unfiltered slim-shape list and filter in
    // memory. Cache is busted alongside allEntries_{year} on every entry
    // create/update/delete so it stays consistent.
    const cacheKey = `entriesByNameRaw_${year}`;
    let all = cacheGet(cacheKey);
    if (!all) {
      Logger.debug('DB CALL: H.EntryRepository.findEntriesByName');
      const snapshot = await yearCol(year, 'entries').get();
      all = snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => !isDeletedEntry(data))
        .map((data) => ({
          id: data.id,
          teamName: data.teamName,
          person: data.person,
          year: toNum(year),
          groups: data.groups || [data.group].filter(Boolean),
          hasPaid: data.hasPaid || false,
          paymentNote: data.paymentNote || '',
          payByCheck: data.payByCheck || false,
        }));
      cacheSet(cacheKey, all, 300);
    }
    const lowerName = name.toLowerCase();
    return all.filter(
      (e) =>
        (e.person && e.person.toLowerCase().includes(lowerName)) ||
        (e.teamName && e.teamName.toLowerCase().includes(lowerName)),
    );
  }

  async getUnpaidEntriesForGroup(groupName, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.getUnpaidEntriesForGroup');
    const snapshot = await yearCol(year, 'entries')
      .where('groups', 'array-contains', groupName)
      .get();
    return snapshot.docs
      .map((doc) => doc.data())
      .filter(
        (data) => !data.hasPaid && !data.payByCheck && !isDeletedEntry(data),
      )
      .map((data) => ({
        id: data.id,
        teamName: data.teamName,
        person: data.person,
        year: toNum(year),
        groups: data.groups || [data.group].filter(Boolean),
        hasPaid: false,
        paymentNote: data.paymentNote || '',
      }));
  }

  /**
   * Soft-deletes an entry: stamps `deletedAt` instead of removing the
   * document, so an admin can undo an accidental/disputed delete via
   * restoreEntry. Picks and points stay intact — only the read paths below
   * (and getGroupTeams/getEntriesForGroup/getAllEntries/getEntriesByEmail/
   * getEntriesContainingTeams) exclude it from user-facing surfaces.
   * Data-integrity writes are the exception: the pick-swap path reads with
   * getEntriesContainingTeams(..., { includeDeleted: true }) so a deleted
   * entry's picks keep getting normalized while it awaits restore (#388).
   *
   * Runs inside a transaction (read-then-write, like purgeEntry) rather than
   * a plain `.update()` for two reasons (#394): a missing doc must surface as
   * a clean ValidationError/4xx instead of Firestore's NOT_FOUND bubbling up
   * as a generic 500, and an already-deleted doc must be a no-op so a
   * double-submitted delete form doesn't restamp `deletedAt` with a new
   * timestamp (which would corrupt the "Deleted:" date shown in the Recently
   * Deleted modal and any future retention logic keyed on it).
   */
  async deleteEntry(entryId, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.deleteEntry');
    const ref = yearDoc(year, 'entries', entryId);
    const changed = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) {
        throw new ValidationError('Entry not found.', 'entryId');
      }
      if (doc.data().deletedAt) return false;
      transaction.update(ref, { deletedAt: new Date().toISOString() });
      return true;
    });
    if (!changed) return;
    invalidateCache('groupTeams_');
    // gameViewData_ also holds per-entry picks — without this bust the
    // results page keeps serving the deleted entry for a full TTL (#303).
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
    invalidateCache('entriesForGroup_');
    cacheDel(`allEntries_${year}`);
    cacheDel(`entriesByNameRaw_${year}`);
    cacheDel(`deletedEntries_${year}`);
    invalidateCache('entriesByEmail_');
  }

  /**
   * Undoes a soft delete, clearing `deletedAt` so the entry reappears
   * everywhere. Same transactional missing-doc/no-op guard as deleteEntry
   * (#394): a missing doc raises ValidationError instead of a generic 500,
   * and an already-live entry (no `deletedAt`) is a no-op instead of a
   * pointless write.
   */
  async restoreEntry(entryId, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.restoreEntry');
    const ref = yearDoc(year, 'entries', entryId);
    const changed = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) {
        throw new ValidationError('Entry not found.', 'entryId');
      }
      if (!doc.data().deletedAt) return false;
      transaction.update(ref, { deletedAt: FieldValue.delete() });
      return true;
    });
    if (!changed) return false;
    invalidateCache('groupTeams_');
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
    invalidateCache('entriesForGroup_');
    cacheDel(`allEntries_${year}`);
    cacheDel(`entriesByNameRaw_${year}`);
    cacheDel(`deletedEntries_${year}`);
    invalidateCache('entriesByEmail_');
    return true;
  }

  /**
   * Permanently removes an entry document. Only allowed once the entry has
   * already been soft-deleted (deletedAt set) — this is the second, explicit
   * step an admin takes after confirming a soft delete, not a shortcut around
   * it. The guard's read and the delete happen inside one transaction (not a
   * plain read-then-delete) so a concurrent restoreEntry racing between the
   * two can't leave a freshly-restored, live entry hard-deleted.
   */
  async purgeEntry(entryId, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.purgeEntry');
    const ref = yearDoc(year, 'entries', entryId);
    const deleted = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) return false;
      if (!doc.data().deletedAt) {
        throw new ValidationError(
          'Entry must be soft-deleted before it can be permanently deleted.',
          'entryId',
        );
      }
      transaction.delete(ref);
      return true;
    });
    if (!deleted) return;
    invalidateCache('groupTeams_');
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
    invalidateCache('entriesForGroup_');
    cacheDel(`allEntries_${year}`);
    cacheDel(`entriesByNameRaw_${year}`);
    cacheDel(`deletedEntries_${year}`);
    invalidateCache('entriesByEmail_');
  }

  /**
   * Lists soft-deleted entries for the admin "Recently Deleted" UI.
   *
   * Cached (300s, matching the sibling full-collection reads) because this
   * scans every entry in the year and filters for `deletedAt` in memory:
   * uncached, each open/refresh of the modal costs a full read of the year's
   * entries subcollection to surface the handful of deleted ones, so the cost
   * scales with total entries rather than deleted ones (#478). Unlike
   * findEntriesByName there's no per-call filter argument, so the finished
   * list is what gets cached rather than an unfiltered raw list.
   *
   * Busted by the paths that can change this list: delete/restore/purge
   * (membership) and updateEntry (the person/teamName/email/groups fields
   * rendered here). Pick/points writes don't appear in this shape, so they
   * deliberately leave it alone.
   */
  async getDeletedEntries(year = thisYear) {
    const cacheKey = `deletedEntries_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    Logger.debug('DB CALL: H.EntryRepository.getDeletedEntries');
    const snapshot = await yearCol(year, 'entries').get();
    const result = snapshot.docs
      .map((doc) => doc.data())
      .filter((data) => isDeletedEntry(data))
      .sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
      .map((data) => ({
        id: data.id,
        teamName: data.teamName,
        person: data.person,
        email: data.email,
        year: toNum(year),
        groups: data.groups || [data.group].filter(Boolean),
        deletedAt: data.deletedAt,
      }));
    cacheSet(cacheKey, result, 300);
    return result;
  }

  async updateEntryPicks(entryId, newPicks, year) {
    Logger.debug('DB CALL: H.EntryRepository.updateEntryPicks');
    await yearDoc(year, 'entries', entryId).update({ picks: newPicks });
    // groupTeams_/gameViewData_ also hold per-entry picks — without these
    // busts the results page keeps serving the old picks for a full TTL
    // on the very instance that processed the edit.
    invalidateCache('groupTeams_');
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
    invalidateCache('entriesForGroup_');
    cacheDel(`allEntries_${year}`);
    cacheDel(`entriesByNameRaw_${year}`);
    invalidateCache('entriesByEmail_');
  }

  async updateEntryPicksWithSwaps(entryIds, swaps, year) {
    Logger.debug('DB CALL: H.EntryRepository.updateEntryPicksWithSwaps');
    if (entryIds.length === 0) return;
    // One transaction per chunk (transactions cap at 500 writes), with a
    // single cache invalidation at the end — not one transaction plus a
    // full cache sweep per entry. The transactional getAll re-reads each
    // entry so swaps apply to fresh picks: a concurrent write (e.g. admin
    // /entryUpdate during live First Four play) makes Firestore retry the
    // transaction instead of being overwritten from the caller's stale
    // query snapshot. Entries deleted since the caller's query are
    // skipped rather than failing the whole chunk.
    const TXN_SIZE = 500;
    try {
      for (let i = 0; i < entryIds.length; i += TXN_SIZE) {
        const refs = entryIds
          .slice(i, i + TXN_SIZE)
          .map((entryId) => yearDoc(year, 'entries', entryId));
        await db.runTransaction(async (transaction) => {
          const docs = await transaction.getAll(...refs);
          for (const doc of docs) {
            if (!doc.exists) continue;
            let currentPicks = [...(doc.data().picks || [])];
            let hasChanged = false;
            for (const [addSID, removeSID] of swaps) {
              if (!removeSID) continue;
              if (currentPicks.includes(removeSID)) {
                currentPicks = currentPicks.map((pick) =>
                  pick === removeSID ? addSID : pick,
                );
                hasChanged = true;
              }
            }
            if (!hasChanged) continue;
            transaction.update(doc.ref, { picks: currentPicks.map(Number) });
          }
        });
      }
    } finally {
      // finally: bust caches even on partial commit failure so stale picks aren't served.
      invalidateCache('groupTeams_');
      invalidateCache(`gameViewData_${year}_`);
      invalidateCache(`fullGridData_${year}_`);
      invalidateCache('entriesForGroup_');
      cacheDel(`allEntries_${year}`);
      cacheDel(`entriesByNameRaw_${year}`);
      invalidateCache('entriesByEmail_');
    }
  }

  async updateMultipleEntryPicks(updates, year) {
    Logger.debug('DB CALL: H.EntryRepository.updateMultipleEntryPicks');
    if (updates.length === 0) return;
    const BATCH_SIZE = 500;
    const commitPromises = [];
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const chunk = updates.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const { entryId, picks } of chunk) {
        batch.update(yearDoc(year, 'entries', entryId), { picks });
      }
      commitPromises.push(batch.commit());
    }
    try {
      await Promise.all(commitPromises);
    } finally {
      // finally: bust caches even on partial commit failure so stale picks aren't served.
      invalidateCache('groupTeams_');
      invalidateCache(`gameViewData_${year}_`);
      invalidateCache(`fullGridData_${year}_`);
      invalidateCache('entriesForGroup_');
      cacheDel(`allEntries_${year}`);
      cacheDel(`entriesByNameRaw_${year}`);
      invalidateCache('entriesByEmail_');
    }
  }

  async getUnsentEmailEntries(groupName, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.getUnsentEmailEntries');
    const snapshot = await yearCol(year, 'entries')
      .where('groups', 'array-contains', groupName)
      .get();
    return snapshot.docs
      .map((doc) => doc.data())
      .filter((data) => !data.emailSent && !isDeletedEntry(data))
      .map((data) => ({
        id: data.id,
        email: data.email,
        person: data.person,
        teamName: data.teamName,
        picks: data.picks || [],
        groups: data.groups || [],
        year: toNum(year),
      }));
  }

  async markEmailsSent(entryIds, year = thisYear) {
    Logger.debug('DB CALL: H.EntryRepository.markEmailsSent');
    if (entryIds.length === 0) return;
    // Firestore batches cap at 500 ops; chunk like updateMultipleEntryPicks
    // so a large group (no code-enforced cap on entries per group) doesn't
    // reject the whole call once entryIds.length > 500 (#374).
    const BATCH_SIZE = 500;
    const commitPromises = [];
    for (let i = 0; i < entryIds.length; i += BATCH_SIZE) {
      const chunk = entryIds.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const entryId of chunk) {
        const ref = yearDoc(year, 'entries', entryId);
        batch.update(ref, { emailSent: true });
      }
      commitPromises.push(batch.commit());
    }
    await Promise.all(commitPromises);
  }
}

// ─── ViewRepository ───────────────────────────────────────────────

export class ViewRepository {
  /**
   * Groups stay top-level — same as flat repo.
   */
  async findGroupByName(name) {
    // Every caller reaches here with a raw, unauthenticated request param
    // (`req.body['game']`, `req.query['gameName']`) via verifyGroupExists, and
    // a caller-side `if (!name)` is not a type check: express.urlencoded parses
    // a repeated key to an array, which is truthy and has no `.toLowerCase`, so
    // it 500s on the cache-key line below (#589). Guard once at this shared
    // choke point instead of at each of the four call sites, and answer with
    // `null` — that is already this method's "not found" result, so every
    // caller's existing `if (!verifiedGroupName)` branch handles it correctly.
    if (typeof name !== 'string' || name.trim() === '') return null;

    Logger.debug('DB CALL: H.ViewRepository.findGroupByName');
    const cacheKey = `groupByName_${name.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const doc = await db.collection('groups').doc(name).get();
    if (doc.exists) {
      const result = doc.data().name;
      cacheSet(cacheKey, result, 86400); // 24 hours — group names never change
      return result;
    }
    // Fall back to case-insensitive search — reuse the cached groups list
    // (24h TTL, shared with getAllGroups) so this doesn't re-read the
    // groups collection on every miss.
    const allGroupNames = await _getCachedGroupNames();
    const lowerName = name.toLowerCase();
    const found =
      allGroupNames.find((n) => n && n.toLowerCase() === lowerName) || null;
    cacheSet(cacheKey, found, 86400);
    return found;
  }

  async getGroupTeams(groupName, year = thisYear) {
    const cacheKey = `groupTeams_${groupName}_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    Logger.debug('DB CALL: H.ViewRepository.getGroupTeams');
    // No year filter — path-scoped. Only need array-contains.
    const snapshot = await yearCol(year, 'entries')
      .where('groups', 'array-contains', groupName)
      .get();
    const result = snapshot.docs
      .map((doc) => doc.data())
      .filter((data) => !isDeletedEntry(data))
      .map((data) => ({
        id: data.id,
        teamName: data.teamName,
        picks: data.picks,
        totalPoints: data.totalPoints,
        person: data.person,
        possPoints: data.possPoints,
      }));
    cacheSet(cacheKey, result, 300);
    return result;
  }

  async getMaxGroupId() {
    Logger.debug('DB CALL: H.ViewRepository.getMaxGroupId');
    const snapshot = await db
      .collection('groups')
      .orderBy('id', 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) return 0;
    return snapshot.docs[0].data().id;
  }

  async addGroup(id, groupName) {
    Logger.debug('DB CALL: H.ViewRepository.addGroup');
    await db.collection('groups').doc(groupName).set({ id, name: groupName });
    cacheDel('allGroups');
    cacheDel(`groupByName_${groupName.toLowerCase()}`);
  }

  async getAllGroups() {
    Logger.debug('DB CALL: H.ViewRepository.getAllGroups');
    return _getCachedGroupNames();
  }
}

// ─── GameRepository ───────────────────────────────────────────────

export class GameRepository {
  async updateWinner(gameID, winner, year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.updateWinner');
    // Resolving a game always releases any manual hold so a poll-skipped
    // game can be brought back into play by recording its result.
    await yearDoc(year, 'games', gameID).update({ winner, manualHold: false });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  /**
   * Undo a game result. Clears the winner and sets manualHold in the same
   * document update so the ESPN poll (which still sees the game in its feed
   * for ~48h) cannot re-resolve it before an admin releases the hold.
   */
  async clearWinnerWithHold(gameID, year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.clearWinnerWithHold');
    await yearDoc(year, 'games', gameID).update({
      winner: null,
      manualHold: true,
    });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  /**
   * Atomically resolves a non-First-Four game: records the winner (releasing
   * any manual hold), fills the winner into the next round's slot, and writes
   * both teams' points/gameStatus — all in one Firestore transaction.
   *
   * These used to be four parallel independent writes; a partial failure
   * (winner recorded, points never credited) produced a torn state no later
   * poll run could see — resolved games drop out of the unresolved set — so
   * it persisted until manual intervention.
   */
  async resolveGame(
    {
      gameID,
      winner,
      loser,
      nextGame,
      nextGameSpot,
      winnerPoints,
      winnerStatus,
      loserPoints,
      loserStatus,
    },
    year = thisYear,
  ) {
    Logger.debug('DB CALL: H.GameRepository.resolveGame');
    await db.runTransaction(async (transaction) => {
      // All reads first (Firestore transaction contract). A team's sID can
      // match multiple schoolRecords docs (ff_ + canonical) — update all.
      const [winnerSnap, loserSnap] = await Promise.all([
        transaction.get(
          yearCol(year, 'schoolRecords').where('sID', '==', toNum(winner)),
        ),
        transaction.get(
          yearCol(year, 'schoolRecords').where('sID', '==', toNum(loser)),
        ),
      ]);

      transaction.update(yearDoc(year, 'games', gameID), {
        winner,
        manualHold: false,
      });

      if (nextGame) {
        let teamName = null;
        let teamSeed = null;
        if (!winnerSnap.empty) {
          const recData = winnerSnap.docs[0].data();
          teamName = recData.nameNick || recData.schoolName || null;
          teamSeed = recData.seed ?? null;
        }
        const prefix = nextGameSpot === 1 ? 'team1' : 'team2';
        transaction.update(yearDoc(year, 'games', nextGame), {
          [`${prefix}ID`]: winner,
          [`${prefix}Name`]: teamName,
          [`${prefix}Seed`]: teamSeed,
        });
      }

      winnerSnap.docs.forEach((doc) =>
        transaction.update(doc.ref, {
          points: winnerPoints,
          gameStatus: winnerStatus,
        }),
      );
      loserSnap.docs.forEach((doc) =>
        transaction.update(doc.ref, {
          points: loserPoints,
          gameStatus: loserStatus,
        }),
      );
    });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    cacheDel(`allTeamNames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  /**
   * Atomically undoes a non-First-Four game result: restores both teams'
   * pre-game points/gameStatus, clears the winner's next-round slot, and
   * clears the game's winner while setting manualHold (so the poll, whose
   * ESPN feed still lists the game as completed, can't re-apply the result).
   * Mirror of resolveGame — same single-transaction guarantee.
   */
  async undoResolvedGame(
    {
      gameID,
      winner,
      loser,
      nextGame,
      nextGameSpot,
      restorePoints,
      restoreStatus,
    },
    year = thisYear,
  ) {
    Logger.debug('DB CALL: H.GameRepository.undoResolvedGame');
    await db.runTransaction(async (transaction) => {
      const [winnerSnap, loserSnap] = await Promise.all([
        transaction.get(
          yearCol(year, 'schoolRecords').where('sID', '==', toNum(winner)),
        ),
        transaction.get(
          yearCol(year, 'schoolRecords').where('sID', '==', toNum(loser)),
        ),
      ]);

      transaction.update(yearDoc(year, 'games', gameID), {
        winner: null,
        manualHold: true,
      });

      if (nextGame) {
        const prefix = nextGameSpot === 1 ? 'team1' : 'team2';
        transaction.update(yearDoc(year, 'games', nextGame), {
          [`${prefix}ID`]: null,
          [`${prefix}Name`]: null,
          [`${prefix}Seed`]: null,
        });
      }

      for (const snap of [winnerSnap, loserSnap]) {
        snap.docs.forEach((doc) =>
          transaction.update(doc.ref, {
            points: restorePoints,
            gameStatus: restoreStatus,
          }),
        );
      }
    });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    cacheDel(`allTeamNames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  // ── Pending points-recalc marker ──────────────────────────────
  // Durable record (on tournaments/{year}) of team sIDs whose game results
  // have been written but whose entry-points recalc has not yet completed.
  // Without it, a recalc failure was never retried: resolved games drop out
  // of the poll's unresolved set, so standings stayed wrong until the next
  // unrelated game completed or an admin intervened.

  async addPendingRecalcSIDs(year, sIDs) {
    Logger.debug('DB CALL: H.GameRepository.addPendingRecalcSIDs');
    const numericSIDs = [...new Set(sIDs.map(Number))];
    if (numericSIDs.length === 0) return;
    await db
      .collection('tournaments')
      .doc(yearSegment(year))
      .set(
        { pendingRecalcSIDs: FieldValue.arrayUnion(...numericSIDs) },
        { merge: true },
      );
  }

  async getPendingRecalcSIDs(year) {
    Logger.debug('DB CALL: H.GameRepository.getPendingRecalcSIDs');
    const doc = await db.collection('tournaments').doc(yearSegment(year)).get();
    if (!doc.exists) return [];
    return (doc.data().pendingRecalcSIDs || []).map(Number);
  }

  async clearPendingRecalcSIDs(year, sIDs) {
    Logger.debug('DB CALL: H.GameRepository.clearPendingRecalcSIDs');
    const numericSIDs = [...new Set(sIDs.map(Number))];
    if (numericSIDs.length === 0) return;
    // arrayRemove (not a wholesale delete) so sIDs appended by a concurrent
    // run after our read survive for that run's own recalc.
    await db
      .collection('tournaments')
      .doc(yearSegment(year))
      .set(
        { pendingRecalcSIDs: FieldValue.arrayRemove(...numericSIDs) },
        { merge: true },
      );
  }

  async setGameManualHold(gameID, hold, year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.setGameManualHold');
    await yearDoc(year, 'games', gameID).update({ manualHold: !!hold });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  /**
   * Uncached read of the First Four (round 0) games. Used by write-time pick
   * normalization, which must see live winner state rather than the 300s
   * tournamentDetails cache.
   */
  async getFirstFourGames(year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getFirstFourGames');
    const snap = await yearCol(year, 'games').where('round', '==', 0).get();
    return snap.docs.map((doc) => doc.data());
  }

  async updateNextGameTeam(nextGame, nextGameSpot, winner, year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.updateNextGameTeam');
    const prefix = nextGameSpot === 1 ? 'team1' : 'team2';

    // Atomic so concurrent ESPN poll resolutions can't race on the
    // schoolRecord lookup + game update.
    await db.runTransaction(async (transaction) => {
      let teamName = null;
      let teamSeed = null;
      if (winner) {
        const recQuery = yearCol(year, 'schoolRecords')
          .where('sID', '==', toNum(winner))
          .limit(1);
        const recSnap = await transaction.get(recQuery);
        if (!recSnap.empty) {
          const recData = recSnap.docs[0].data();
          teamName = recData.nameNick || recData.schoolName || null;
          teamSeed = recData.seed ?? null;
        }
      }

      transaction.update(yearDoc(year, 'games', nextGame), {
        [`${prefix}ID`]: winner,
        [`${prefix}Name`]: teamName,
        [`${prefix}Seed`]: teamSeed,
      });
    });

    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    invalidateCache(`gameViewData_${year}_`);
    invalidateCache(`fullGridData_${year}_`);
  }

  async getActiveAndFutureGames(year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getActiveAndFutureGames');
    const cacheKey = `activeFutureGames_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // No year filter needed — path-scoped; only return unresolved games
    const snapshot = await yearCol(year, 'games')
      .where('winner', '==', null)
      .get();
    const result = snapshot.docs
      .map((doc) => ({ ...doc.data(), year: toNum(year) }))
      .sort((a, b) => a.gameID - b.gameID);

    cacheSet(cacheKey, result, 300);
    return result;
  }

  async deleteGamesByYear(year) {
    Logger.debug('DB CALL: H.GameRepository.deleteGamesByYear');
    const snapshot = await yearCol(bulkDeleteYearSegment(year), 'games').get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    // Matches TourneyRepository.deleteGamesByYear's cache busts (#432) — this
    // twin previously omitted them, so a deleted year could keep serving
    // stale cached games for up to 300s on the deleting instance.
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
  }

  async deleteSchoolRecordsByYear(year) {
    Logger.debug('DB CALL: H.GameRepository.deleteSchoolRecordsByYear');
    const snapshot = await yearCol(
      bulkDeleteYearSegment(year),
      'schoolRecords',
    ).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`allTeamNames_${year}`);
  }

  /**
   * Entries whose picks contain any of the given team sIDs.
   *
   * By default this is a user-facing read: soft-deleted entries and
   * excluded-only-group entries are filtered out (points recalcs must not
   * resurrect them in standings caches). Pass `includeDeleted: true` for
   * data-integrity WRITES — the First Four / bracket-correction pick-swap
   * path (updateEntrywithNewSchools) must reach every document holding the
   * old sID, or an entry that is soft-deleted when a swap runs and restored
   * afterwards permanently keeps the eliminated team as a pick (#388).
   *
   * Deliberately scoped to soft-deletes only: the excluded-only-group
   * filter stays in effect even with this flag. updatePointsForAffectedEntries
   * has no equivalent option and always excludes those entries, so lifting
   * the filter here too would normalize an excluded-only-group entry's
   * picks on a swap while leaving its totalPoints/possPoints stale —
   * trading one (consistent) staleness for another (inconsistent) one.
   */
  async getEntriesContainingTeams(
    year,
    teamSIDs,
    { includeDeleted = false } = {},
  ) {
    Logger.debug('DB CALL: H.GameRepository.getEntriesContainingTeams');
    // Firestore caps `array-contains-any` at 30 disjuncts. Bulk ESPN
    // resolutions can affect more than 30 teams (FF + multiple rounds),
    // so chunk into parallel sub-queries and dedupe by entry id.
    const numericSIDs = [...new Set(teamSIDs.map(Number))];
    if (numericSIDs.length === 0) return [];

    const ARRAY_CONTAINS_ANY_LIMIT = 30;
    const snapshots = await Promise.all(
      Array.from(
        { length: Math.ceil(numericSIDs.length / ARRAY_CONTAINS_ANY_LIMIT) },
        (_, i) => {
          const chunk = numericSIDs.slice(
            i * ARRAY_CONTAINS_ANY_LIMIT,
            (i + 1) * ARRAY_CONTAINS_ANY_LIMIT,
          );
          return yearCol(year, 'entries')
            .where('picks', 'array-contains-any', chunk)
            .get();
        },
      ),
    );

    const seenIds = new Set();
    const result = [];
    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        const data = doc.data();
        if (seenIds.has(data.id)) continue;
        seenIds.add(data.id);
        if (!includeDeleted && isDeletedEntry(data)) continue;
        const groups = data.groups || (data.group ? [data.group] : []);
        if (isExcludedOnlyGroup(groups)) continue;
        result.push({
          id: data.id,
          teamName: data.teamName,
          picks: data.picks,
          totalPoints: data.totalPoints,
          person: data.person,
          groups,
        });
      }
    }
    return result;
  }

  async getEntriesForGroup(year, groupName) {
    Logger.debug('DB CALL: H.GameRepository.getEntriesForGroup');
    const cacheKey = `entriesForGroup_${groupName}_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const snapshot = await yearCol(year, 'entries')
      .where('groups', 'array-contains', groupName)
      .get();
    const result = snapshot.docs
      .map((doc) => doc.data())
      .filter((data) => !isDeletedEntry(data))
      .sort(byRegistrationOrder)
      .map((data) => ({
        id: data.id,
        teamName: data.teamName,
        picks: data.picks,
        totalPoints: data.totalPoints,
        person: data.person,
        groups: data.groups || (data.group ? [data.group] : []),
      }));

    // 300s: holds live totalPoints. In-process busts (updateMultipleEntryPoints
    // et al.) don't reach the poll container or sibling web instances, so the
    // TTL is the real cross-process freshness bound.
    cacheSet(cacheKey, result, 300);
    return result;
  }

  async getAllEntries(year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getAllEntries');
    const cacheKey = `allEntries_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const snapshot = await yearCol(year, 'entries').get();
    const result = snapshot.docs
      .map((doc) => doc.data())
      .filter((data) => {
        if (isDeletedEntry(data)) return false;
        const groups = data.groups || (data.group ? [data.group] : []);
        return !isExcludedOnlyGroup(groups);
      })
      .sort(byRegistrationOrder)
      .map((data) => ({
        id: data.id,
        teamName: data.teamName,
        picks: data.picks,
        totalPoints: data.totalPoints,
        person: data.person,
        groups: data.groups || (data.group ? [data.group] : []),
      }));

    // 300s: holds live totalPoints — see getEntriesForGroup for why the TTL
    // (not cache busting) is the cross-process freshness bound.
    cacheSet(cacheKey, result, 300);
    return result;
  }

  /**
   * getTournamentTeams — now a single subcollection read since
   * schoolRecords are denormalized with school name/mascot/regionName.
   */
  async getTournamentTeams(inputYear = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getTournamentTeams');
    const cacheKey = `allTeamNames_${inputYear}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // Single read — denormalized data eliminates the 3-way join
    const recordsSnap = await yearCol(inputYear, 'schoolRecords').get();

    const result = recordsSnap.docs
      .map((doc) => {
        const sR = doc.data();
        return {
          seed: sR.seed,
          sID: sR.sID,
          points: sR.points,
          name: sR.schoolName || null,
          mascot: sR.mascot || null,
          nameNick: sR.nameNick || null,
          regionName: sR.regionName || '',
          gameStatus: sR.gameStatus,
        };
      })
      .sort((a, b) => {
        if (a.seed !== b.seed) return a.seed - b.seed;
        return (a.regionName || '').localeCompare(b.regionName || '');
      });

    // 300s, not 24h: points/gameStatus are live scoring data. The poll job
    // writes them from a separate container whose cache busts never reach
    // web instances, so a long TTL here let admin ranking views compute
    // from team records up to a day old.
    cacheSet(cacheKey, result, 300);
    return result;
  }

  async getActiveGames(year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getActiveGames');
    const cacheKey = `activeGames_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const [gamesSnap, regionsSnap, recordsSnap] = await Promise.all([
      yearCol(year, 'games').get(),
      yearCol(year, 'regions').get(),
      yearCol(year, 'schoolRecords').get(),
    ]);

    const regionsMap = new Map();
    regionsSnap.docs.forEach((doc) => {
      const data = doc.data();
      regionsMap.set(data.regionID, data);
    });

    // Build sID → { nameNick, seed, logoUrl } so games missing denormalized fields still show names
    const schoolMap = new Map();
    recordsSnap.docs.forEach((doc) => {
      const d = doc.data();
      schoolMap.set(d.sID, {
        nameNick: d.nameNick || null,
        seed: d.seed ?? null,
        logoUrl: d.logoUrl ?? null,
      });
    });

    const result = gamesSnap.docs
      .map((doc) => ({ ...doc.data(), year: toNum(year) }))
      .filter((g) => g.team1ID !== null && g.team2ID !== null)
      .map((g) => {
        const t1 = schoolMap.get(g.team1ID) || {};
        const t2 = schoolMap.get(g.team2ID) || {};
        return {
          ...g,
          ...(regionsMap.get(g.regionID) || {}),
          team1Name: g.team1Name ?? t1.nameNick,
          team1Seed: g.team1Seed ?? t1.seed,
          team2Name: g.team2Name ?? t2.nameNick,
          team2Seed: g.team2Seed ?? t2.seed,
          team1LogoUrl: t1.logoUrl ?? null,
          team2LogoUrl: t2.logoUrl ?? null,
        };
      })
      .sort((a, b) => {
        const aWinner = a.winner === null ? -Infinity : a.winner;
        const bWinner = b.winner === null ? -Infinity : b.winner;
        if (aWinner !== bWinner) return aWinner - bWinner;
        if (a.gameID !== b.gameID) return a.gameID - b.gameID;
        return a.year - b.year;
      });

    cacheSet(cacheKey, result, 300);
    return result;
  }

  /**
   * getAllTournamentDetails — single cached call that replaces getTournamentTeams +
   * getActiveGames + getActiveAndFutureGames + getRegionsForYear.
   * Returns:
   *   teams      — sorted school records (same shape as getTournamentTeams)
   *   allGames   — all games sorted by gameID (same as getActiveAndFutureGames)
   *   activeGames — games with both teams set, with regionName merged in
   *   regions    — array of { regionID, regionName } for the 4 bracket quadrants
   */
  async getAllTournamentDetails(year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getAllTournamentDetails');
    const cacheKey = `tournamentDetails_${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const [gamesSnap, recordsSnap, regionsSnap] = await Promise.all([
      yearCol(year, 'games').get(),
      yearCol(year, 'schoolRecords').get(),
      yearCol(year, 'regions').get(),
    ]);

    // Build a map of regionID → region data
    const regionsMap = new Map();
    regionsSnap.docs.forEach((doc) => {
      const d = doc.data();
      regionsMap.set(d.regionID, d);
    });

    // All games sorted by gameID
    const allGames = gamesSnap.docs
      .map((doc) => ({ ...doc.data(), year: toNum(year) }))
      .sort((a, b) => a.gameID - b.gameID);

    // Active games (both slots filled) with regionName merged in, sorted as before
    const activeGames = allGames
      .filter((g) => g.team1ID !== null && g.team2ID !== null)
      .map((g) => ({ ...g, ...(regionsMap.get(g.regionID) || {}) }))
      .sort((a, b) => {
        const aWinner = a.winner === null ? -Infinity : a.winner;
        const bWinner = b.winner === null ? -Infinity : b.winner;
        if (aWinner !== bWinner) return aWinner - bWinner;
        return a.gameID - b.gameID;
      });

    // Teams — same shape as getTournamentTeams, plus denormalized ESPN/conference fields
    const teams = recordsSnap.docs
      .map((doc) => {
        const sR = doc.data();
        return {
          seed: sR.seed,
          sID: sR.sID,
          points: sR.points,
          name: sR.schoolName || null,
          mascot: sR.mascot || null,
          nameNick: sR.nameNick || null,
          regionName: sR.regionName || '',
          gameStatus: sR.gameStatus,
          espnID: sR.espnID ?? null,
          logoUrl: sR.logoUrl ?? null,
          primaryColor: sR.primaryColor ?? null,
          conferenceName: sR.conferenceName ?? null,
          isFFDoc: sR.canonicalDocId != null, // true only on ff_ docs
        };
      })
      .sort((a, b) => {
        if (a.seed !== b.seed) return a.seed - b.seed;
        return (a.regionName || '').localeCompare(b.regionName || '');
      });

    // The 4 bracket quadrant regions — filter to only 1-4, excluding pseudo-regions 5, 6.
    const regions = Array.from(regionsMap.values()).filter(
      (r) => r.regionID >= 1 && r.regionID <= 4,
    );

    const result = { allGames, activeGames, teams, regions };
    // Cache for 5 minutes — same ttl as getActiveGames since it contains live game state
    cacheSet(cacheKey, result, 300);
    return result;
  }

  /**
   * getAllYearsForGroup — queries each tournament year's entries subcollection.
   * Avoids collectionGroup (which requires a manually-created collection group index)
   * by reading the small tournaments collection first, then checking each year.
   */
  async getAllYearsForGroup(groupName) {
    Logger.debug('DB CALL: H.GameRepository.getAllYearsForGroup');
    const cacheKey = `yearsForGroup_${groupName}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // Get all tournament years (tiny read — one doc per year)
    const tournamentsSnap = await db.collection('tournaments').get();
    const years = [];

    // Check each year in parallel for entries belonging to this group.
    // Run a single Filter.or query to check both the new `groups` array field
    // and the old singular `group` string field (legacy entries) in one pass.
    await Promise.all(
      tournamentsSnap.docs
        .map((doc) => doc.id)
        .filter(isEnumerableYearId)
        .map(async (year) => {
          const snap = await yearCol(year, 'entries')
            .where(
              Filter.or(
                Filter.where('groups', 'array-contains', groupName),
                Filter.where('group', '==', groupName),
              ),
            )
            .limit(1)
            .get();

          if (!snap.empty) {
            years.push(toNum(year));
          }
        }),
    );

    const result = years.sort((a, b) => b - a).map((year) => ({ year }));
    // 1h, not 365d: createEntry busts this key on the writing instance, but
    // other instances only converge via TTL — a year-long TTL could hide a
    // group's first entry of a new season from their dropdowns indefinitely.
    cacheSet(cacheKey, result, 3600);
    return result;
  }

  /**
   * getEntriesByEmail — returns every entry across all tournament years whose
   * `email` matches the given address (case-insensitive), tagged with its year
   * and sorted newest-year-first (registration order within a year).
   *
   * Mirrors getAllYearsForGroup: reads the small top-level `tournaments`
   * collection first, then queries each year's `entries` subcollection in
   * parallel — avoiding collectionGroup (and its manually-created index).
   * The `where('email','in',...)` query uses Firestore's automatic index.
   *
   * Firestore equality is byte-exact. New registrations are stored lowercased
   * (see createNewEntry), but to stay robust against any legacy un-normalized
   * rows we query both the raw input and its lowercased form, and filter in
   * memory as a final ownership guard.
   *
   * Pass `year` to scope to a single tournament year — this skips the
   * `tournaments` read and avoids scanning every year (used by the per-request
   * results-page highlight, which only needs one year).
   *
   * Cached per (email, year) for 300s, matching sibling read methods
   * (getGroupTeams, findEntriesByName) — this is the query backing
   * /my-brackets, which participants repeatedly refresh during tournament
   * weekend; uncached it re-scanned every tournament year on every request (#370).
   */
  async getEntriesByEmail(email, year = null) {
    const raw = String(email || '').trim();
    if (!raw) return [];
    const emailLower = raw.toLowerCase();

    const cacheKey = `entriesByEmail_${emailLower}_${year ?? 'all'}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    Logger.debug('DB CALL: H.GameRepository.getEntriesByEmail');

    const variants = [...new Set([raw, emailLower])];

    const years =
      year != null
        ? [String(year)]
        : (await db.collection('tournaments').get()).docs
            .map((doc) => doc.id)
            .filter(isEnumerableYearId);

    const perYear = await Promise.all(
      years.map(async (yr) => {
        const snap = await yearCol(yr, 'entries')
          .where('email', 'in', variants)
          .get();
        return snap.docs.map((d) => {
          const data = d.data();
          return { ...data, id: data.id ?? d.id, year: toNum(yr) };
        });
      }),
    );

    const result = perYear
      .flat()
      .filter(
        (e) => e.email?.toLowerCase() === emailLower && !isDeletedEntry(e),
      )
      .sort((a, b) =>
        a.year !== b.year ? b.year - a.year : byRegistrationOrder(a, b),
      );
    cacheSet(cacheKey, result, 300);
    return result;
  }

  async getEntryById(entryId, year = thisYear) {
    Logger.debug('DB CALL: H.GameRepository.getEntryById');
    const doc = await yearDoc(year, 'entries', entryId).get();
    if (!doc.exists) return null;
    return { ...doc.data(), year: toNum(year) };
  }

  async updateEntry(entry) {
    Logger.debug('DB CALL: H.GameRepository.updateEntry');
    const ref = yearDoc(entry.year, 'entries', entry.id);
    const updatePayload = {
      email: entry.email,
      teamName: entry.teamName,
      picks: entry.picks,
      person: entry.person,
      edited_at: new Date(),
      possPoints: entry.possPoints || 0,
      groups: Array.isArray(entry.groups)
        ? entry.groups
        : [entry.groups].filter(Boolean),
    };

    if (entry.hasPaid !== undefined) {
      updatePayload.hasPaid = entry.hasPaid;
      updatePayload.paymentNote = entry.paymentNote || '';
      updatePayload.payByCheck = entry.payByCheck || false;
    }

    if (entry.emailSent !== undefined) {
      updatePayload.emailSent = entry.emailSent;
    }

    await ref.update(updatePayload);
    invalidateCache('groupTeams_');
    invalidateCache(`gameViewData_${entry.year}_`);
    invalidateCache(`fullGridData_${entry.year}_`);
    invalidateCache('entriesForGroup_');
    cacheDel(`allEntries_${entry.year}`);
    cacheDel(`entriesByNameRaw_${entry.year}`);
    // An admin can edit an entry that is currently soft-deleted; the Recently
    // Deleted list renders person/teamName/email/groups, all writable here.
    cacheDel(`deletedEntries_${entry.year}`);
    // email can change here (updatePayload.email above), and we cache getEntriesByEmail
    // per-email — a per-key bust would need the OLD email too, which this method doesn't
    // read, so clear the whole entriesByEmail_ cache rather than risk serving either the
    // old or new owner a stale list (#370).
    invalidateCache('entriesByEmail_');
  }
}

// ─── TourneyRepository ────────────────────────────────────────────

export class TourneyRepository {
  async getAllRegions(year = thisYear) {
    Logger.debug('DB CALL: H.TourneyRepository.getAllRegions');
    return _getCachedRegions(year);
  }

  async getAllRegionTypes() {
    Logger.debug('DB CALL: H.TourneyRepository.getAllRegionTypes');
    const cacheKey = 'allRegionTypes';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const snapshot = await db
      .collection('regionID')
      .orderBy('regionID', 'asc')
      .get();
    const result = snapshot.docs.map((doc) => doc.data());

    cacheSet(cacheKey, result, 86400); // 24 hours
    return result;
  }

  async insertRegionsForYear(year, regionIDs) {
    Logger.debug('DB CALL: H.TourneyRepository.insertRegionsForYear');
    // Load master region definitions — reuse the 24h-cached allRegionTypes list.
    const masterList = await this.getAllRegionTypes();
    const masterMap = new Map();
    masterList.forEach((d) => {
      masterMap.set(Number(d.regionID), d);
    });
    const batch = db.batch();
    // Doc name is the 1-based position ("1"–"6"), which doubles as sort key.
    regionIDs.forEach((id, index) => {
      const region = masterMap.get(Number(id));
      if (region) {
        batch.set(
          yearDoc(year, 'regions', String(index + 1)),
          _buildRegionDoc(region),
        );
      }
    });
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    // Also bust the 24h getAllRegions/_getCachedRegions cache (#377) — otherwise
    // a prior read for this year keeps serving the stale pre-write region list.
    cacheDel(`allRegions_${year}`);
  }

  /**
   * Read-only precheck before an atomic bracket create. Checks the parent doc
   * AND every subcollection a prior partial/interrupted creation could have
   * left behind — a parent-less orphan (legacy or from a failure before this
   * atomic path existed) wouldn't be caught by createBracketAtomic's
   * batch.create() alone, since that only guards the specific doc paths it's
   * about to write, not the collection generally.
   */
  async getYearOccupancy(year) {
    Logger.debug('DB CALL: H.TourneyRepository.getYearOccupancy');
    const yearStr = yearSegment(year);
    const [parentSnap, gamesSnap, regionsSnap, schoolRecordsSnap, entriesSnap] =
      await Promise.all([
        db.collection('tournaments').doc(yearStr).get(),
        yearCol(year, 'games').limit(1).get(),
        yearCol(year, 'regions').limit(1).get(),
        yearCol(year, 'schoolRecords').limit(1).get(),
        yearCol(year, 'entries').limit(1).get(),
      ]);
    const hasParent = parentSnap.exists;
    const hasGames = !gamesSnap.empty;
    const hasRegions = !regionsSnap.empty;
    const hasSchoolRecords = !schoolRecordsSnap.empty;
    const hasEntries = !entriesSnap.empty;
    return {
      occupied:
        hasParent || hasGames || hasRegions || hasSchoolRecords || hasEntries,
      hasParent,
      hasGames,
      hasRegions,
      hasSchoolRecords,
      hasEntries,
    };
  }

  /**
   * Creates an entire bracket — regions, every game, every school record,
   * and (if given) First Four games/records — in one atomic Firestore batch.
   * Every document uses batch.create(), so if ANY target already exists the
   * whole commit is rejected and nothing partial is left behind; this is the
   * final race guard behind getYearOccupancy's earlier, friendlier check.
   *
   * Builds this year's region-name map from the in-memory `regionIDs` list
   * being written in *this* batch, never from a read of the year's own
   * `regions` subcollection (that would read back data this same batch
   * hasn't committed yet, so it would see nothing — see the plan doc's note
   * on the 24h-cache trap this specifically avoids).
   *
   * Callers (createNewBracket) build gamesWithoutTeams/gamesWithTeams via
   * createNewBracketStructure and firstFourGames/firstFourSchoolRecords with
   * the same shape createFirstFourGames uses for the existing
   * add-First-Four-to-an-existing-bracket path — this method shares document
   * construction with both via the _build*Doc helpers, not a third copy.
   */
  async createBracketAtomic({
    year,
    regionIDs,
    gamesWithoutTeams,
    gamesWithTeams,
    schoolRecords,
    firstFourGames = [],
    firstFourSchoolRecords = [],
    tournamentDocExtra = {},
  }) {
    Logger.debug('DB CALL: H.TourneyRepository.createBracketAtomic');
    const yearStr = yearSegment(year);

    const [schools, conferences, masterRegionTypes] = await Promise.all([
      _getCachedSchools(),
      _getCachedConferences(),
      this.getAllRegionTypes(),
    ]);
    const schoolsMap = _buildSchoolsBySid(schools);
    const confNameMap = _buildConfNameMap(conferences);

    const masterRegionMap = new Map(
      masterRegionTypes.map((r) => [Number(r.regionID), r]),
    );
    const yearRegions = regionIDs
      .map((id) => masterRegionMap.get(Number(id)))
      .filter(Boolean);
    const regionsMap = _buildRegionNameMap(yearRegions);

    const totalWrites =
      1 +
      yearRegions.length +
      gamesWithoutTeams.length +
      gamesWithTeams.length +
      schoolRecords.length +
      firstFourGames.length +
      firstFourSchoolRecords.length;
    // Firestore caps a batch at 500 operations. The plan's own count (134 +
    // 2N, 142-150 for N=4-8) stays far under that, so this should never
    // trip — it exists so a future change that adds more writes fails loudly
    // here instead of with a cryptic Firestore error mid-commit.
    if (totalWrites > 500) {
      throw new Error(
        `createBracketAtomic: ${totalWrites} writes exceeds Firestore's 500-operation batch limit for year ${year}`,
      );
    }

    const batch = db.batch();

    batch.create(db.collection('tournaments').doc(yearStr), {
      year: Number(yearStr),
      ...tournamentDocExtra,
    });

    regionIDs.forEach((id, index) => {
      const region = masterRegionMap.get(Number(id));
      if (region) {
        batch.create(
          yearDoc(year, 'regions', String(index + 1)),
          _buildRegionDoc(region),
        );
      }
    });

    for (const game of gamesWithoutTeams) {
      const [gameID] = game;
      batch.create(
        yearDoc(year, 'games', gameID),
        _buildGameWithoutTeamsDoc(game),
      );
    }
    for (const game of gamesWithTeams) {
      const [gameID] = game;
      batch.create(
        yearDoc(year, 'games', gameID),
        _buildGameWithTeamsDoc(game, schoolsMap),
      );
    }
    for (const record of schoolRecords) {
      batch.create(
        yearDoc(
          record.year,
          'schoolRecords',
          `${record.regionID}_${record.seed}`,
        ),
        _buildSchoolRecordDoc(record, schoolsMap, regionsMap, confNameMap),
      );
    }
    for (const game of firstFourGames) {
      batch.create(
        yearDoc(year, 'games', game.gameID),
        _buildFirstFourGameDoc(game, schoolsMap),
      );
    }
    for (const record of firstFourSchoolRecords) {
      const docId = `ff_${record.gameID}_${record.slot}`;
      batch.create(
        yearDoc(year, 'schoolRecords', docId),
        _buildFirstFourSchoolRecordDoc(
          record,
          schoolsMap,
          regionsMap,
          confNameMap,
        ),
      );
    }

    // Nothing below this line runs unless the commit fully succeeds — no
    // cache invalidation, no return — so a failed/rejected batch leaves
    // every cache exactly as it was, which is correct since Firestore itself
    // guarantees the batch wrote nothing either.
    await batch.commit();

    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
    cacheDel(`allTeamNames_${year}`);
    cacheDel(`allRegions_${year}`);

    return { writeCount: totalWrites };
  }

  async getAllTeams() {
    Logger.debug('DB CALL: H.TourneyRepository.getAllTeams');
    return _getCachedSchools();
  }

  /**
   * Returns every schoolRecords doc for a year — canonical R1 records
   * (doc id `${regionID}_${seed}`) and First Four/play-in records (doc id
   * `ff_{gameID}_{slot}`, carrying `canonicalDocId` back to the R1 slot they
   * feed) alike. Both `docId` and `canonicalDocId` are returned so a caller
   * that needs only canonical R1 records (updateBracket's balanced
   * add/remove diff) can partition on `docId` shape rather than treating
   * every record as an R1 slot occupant — see the plan doc's editor-
   * compatibility section for why that distinction matters.
   */
  async getSchoolRecordsForYear(year) {
    Logger.debug('DB CALL: H.TourneyRepository.getSchoolRecordsForYear');
    const snapshot = await yearCol(year, 'schoolRecords').get();
    return snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          sID: d.sID,
          year: toNum(year),
          seed: d.seed,
          regionID: d.regionID,
          docId: doc.id,
          canonicalDocId: d.canonicalDocId ?? null,
        };
      })
      .sort((a, b) =>
        a.seed !== b.seed ? a.seed - b.seed : a.regionID - b.regionID,
      );
  }

  async deleteGamesByYear(year) {
    Logger.debug('DB CALL: H.TourneyRepository.deleteGamesByYear');
    const snapshot = await yearCol(bulkDeleteYearSegment(year), 'games').get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
  }

  async deleteSchoolRecordsByYear(year) {
    Logger.debug('DB CALL: H.TourneyRepository.deleteSchoolRecordsByYear');
    const snapshot = await yearCol(
      bulkDeleteYearSegment(year),
      'schoolRecords',
    ).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`allTeamNames_${year}`);
  }

  async deleteRegionsByYear(year) {
    Logger.debug('DB CALL: H.TourneyRepository.deleteRegionsByYear');
    const snapshot = await yearCol(
      bulkDeleteYearSegment(year),
      'regions',
    ).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    // Also bust the 24h getAllRegions/_getCachedRegions cache (#377) — otherwise
    // a prior read for this year keeps serving the stale pre-delete region list.
    cacheDel(`allRegions_${year}`);
  }

  async deleteTournamentDoc(year) {
    Logger.debug('DB CALL: H.TourneyRepository.deleteTournamentDoc');
    await db
      .collection('tournaments')
      .doc(bulkDeleteYearSegment(year))
      .delete();
  }

  async upsertTournamentDoc(year, options = {}) {
    Logger.debug('DB CALL: H.TourneyRepository.upsertTournamentDoc');
    // Validate before building the payload: this is the one caller that
    // *creates* the tournament doc, so an unguarded year wrote a real
    // `tournaments/undefined` holding `{ year: NaN }`.
    const yearStr = yearSegment(year);
    const data = { year: Number(yearStr) };
    if (options.hasFirstFour !== undefined)
      data.hasFirstFour = options.hasFirstFour;
    if (options.firstFourGameCount !== undefined)
      data.firstFourGameCount = options.firstFourGameCount;
    await db.collection('tournaments').doc(yearStr).set(data, { merge: true });
  }

  async insertFirstFourGames(games, year) {
    Logger.debug('DB CALL: H.TourneyRepository.insertFirstFourGames');
    if (games.length === 0) return;

    const schoolsMap = _buildSchoolsBySid(await _getCachedSchools());

    const batch = db.batch();
    for (const game of games) {
      batch.set(
        yearDoc(year, 'games', game.gameID),
        _buildFirstFourGameDoc(game, schoolsMap),
      );
    }
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
  }

  async insertFirstFourSchoolRecords(records, year) {
    Logger.debug('DB CALL: H.TourneyRepository.insertFirstFourSchoolRecords');
    if (records.length === 0) return;

    // Reuse the 24h-cached reference data (allSchools, allRegions_{year},
    // allConferences). Previously this issued 3 full-collection reads on
    // every tournament setup.
    const [schools, regions, conferences] = await Promise.all([
      _getCachedSchools(),
      _getCachedRegions(year),
      _getCachedConferences(),
    ]);
    const schoolsMap = _buildSchoolsBySid(schools);
    const regionsMap = _buildRegionNameMap(regions);
    const confNameMap = _buildConfNameMap(conferences);

    const batch = db.batch();
    for (const record of records) {
      const docId = `ff_${record.gameID}_${record.slot}`;
      batch.set(
        yearDoc(year, 'schoolRecords', docId),
        _buildFirstFourSchoolRecordDoc(
          record,
          schoolsMap,
          regionsMap,
          confNameMap,
        ),
      );
    }
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`allTeamNames_${year}`);
  }

  /**
   * Compensating delete for the First Four game docs written by
   * insertFirstFourGames. Used to roll back when the paired school-records
   * write fails, so a partial First Four creation can't be left behind.
   */
  async deleteFirstFourGames(games, year) {
    Logger.debug('DB CALL: H.TourneyRepository.deleteFirstFourGames');
    if (games.length === 0) return;

    const batch = db.batch();
    for (const game of games) {
      batch.delete(yearDoc(year, 'games', game.gameID));
    }
    await batch.commit();
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`activeGames_${year}`);
    cacheDel(`activeFutureGames_${year}`);
  }

  async insertMultipleGamesWithoutTeams(gamesWithoutTeams) {
    Logger.debug(
      'DB CALL: H.TourneyRepository.insertMultipleGamesWithoutTeams',
    );
    if (gamesWithoutTeams.length === 0) return;

    const yearStr = yearSegment(gamesWithoutTeams[0][2]);

    const batch = db.batch();
    // Ensure the tournament parent doc exists so years are queryable
    batch.set(
      db.collection('tournaments').doc(yearStr),
      { year: Number(yearStr) },
      { merge: true },
    );

    for (const game of gamesWithoutTeams) {
      const [gameID, , year] = game;
      batch.set(
        yearDoc(year, 'games', gameID),
        _buildGameWithoutTeamsDoc(game),
      );
    }
    await batch.commit();
    if (gamesWithoutTeams.length > 0) {
      const year = gamesWithoutTeams[0][2];
      cacheDel(`tournamentDetails_${year}`);
      cacheDel(`activeGames_${year}`);
      cacheDel(`activeFutureGames_${year}`);
    }
  }

  async insertMultipleGamesWithTeams(gamesWithTeams) {
    Logger.debug('DB CALL: H.TourneyRepository.insertMultipleGamesWithTeams');
    if (gamesWithTeams.length === 0) return;

    const yearStr = yearSegment(gamesWithTeams[0][2]);

    const schoolsMap = _buildSchoolsBySid(await _getCachedSchools());

    const batch = db.batch();
    // Ensure the tournament parent doc exists so years queryable
    batch.set(
      db.collection('tournaments').doc(yearStr),
      { year: Number(yearStr) },
      { merge: true },
    );

    for (const game of gamesWithTeams) {
      const [gameID, , year] = game;
      batch.set(
        yearDoc(year, 'games', gameID),
        _buildGameWithTeamsDoc(game, schoolsMap),
      );
    }
    await batch.commit();
    if (gamesWithTeams.length > 0) {
      const year = gamesWithTeams[0][2];
      cacheDel(`tournamentDetails_${year}`);
      cacheDel(`activeGames_${year}`);
      cacheDel(`activeFutureGames_${year}`);
    }
  }

  async updateMultipleGamesWithTeams(gamesWithTeams) {
    Logger.debug('DB CALL: H.TourneyRepository.updateMultipleGamesWithTeams');
    if (gamesWithTeams.length === 0) return;

    const schoolsMap = _buildSchoolsBySid(await _getCachedSchools());

    const batch = db.batch();
    for (const game of gamesWithTeams) {
      const [
        gameID,
        _regionID,
        year,
        team1ID,
        team2ID,
        ,
        _round,
        _nextGameID,
        _nextGameSpot,
        seed1,
        seed2,
      ] = game;

      const school1 =
        team1ID != null ? schoolsMap.get(String(team1ID)) || {} : {};
      const school2 =
        team2ID != null ? schoolsMap.get(String(team2ID)) || {} : {};

      const ref = yearDoc(year, 'games', gameID);
      batch.set(
        ref,
        {
          team1ID: team1ID ?? null,
          team2ID: team2ID ?? null,
          team1Name: school1.nameNick || school1.name || null,
          team1Seed: seed1 ?? null,
          team2Name: school2.nameNick || school2.name || null,
          team2Seed: seed2 ?? null,
        },
        { merge: true },
      );
    }
    await batch.commit();
    if (gamesWithTeams.length > 0) {
      const year = gamesWithTeams[0][2];
      cacheDel(`tournamentDetails_${year}`);
      cacheDel(`activeGames_${year}`);
      cacheDel(`activeFutureGames_${year}`);
    }
  }

  async insertMultipleSchoolRecords(schoolRecords) {
    Logger.debug('DB CALL: H.TourneyRepository.insertMultipleSchoolRecords');
    if (schoolRecords.length === 0) return;

    // Reuse 24h-cached reference data (allSchools, allRegions_{year},
    // allConferences) for the denormalization joins. Previously this issued
    // 3 full-collection reads on every tournament setup.
    const [schools, regions, conferences] = await Promise.all([
      _getCachedSchools(),
      _getCachedRegions(schoolRecords[0].year),
      _getCachedConferences(),
    ]);
    const schoolsMap = _buildSchoolsBySid(schools);
    const regionsMap = _buildRegionNameMap(regions);
    const confNameMap = _buildConfNameMap(conferences);

    const batch = db.batch();
    for (const record of schoolRecords) {
      batch.set(
        yearDoc(
          record.year,
          'schoolRecords',
          `${record.regionID}_${record.seed}`,
        ),
        _buildSchoolRecordDoc(record, schoolsMap, regionsMap, confNameMap),
      );
    }
    await batch.commit();
    if (schoolRecords.length > 0) {
      const year = schoolRecords[0].year;
      cacheDel(`tournamentDetails_${year}`);
      cacheDel(`allTeamNames_${year}`);
    }
  }

  async updateMultipleSchoolRecords(schoolRecords) {
    Logger.debug('DB CALL: H.TourneyRepository.updateMultipleSchoolRecords');
    if (!schoolRecords || schoolRecords.length === 0) return;

    // Reuse the 24h-cached allSchools / allConferences lists to keep
    // denormalized fields fresh without re-reading both collections.
    const [schools, conferences] = await Promise.all([
      _getCachedSchools(),
      _getCachedConferences(),
    ]);
    const schoolsMap = _buildSchoolsBySid(schools);
    const confNameMap = _buildConfNameMap(conferences);

    const batch = db.batch();
    for (const record of schoolRecords) {
      const school = schoolsMap.get(String(record.sID)) || {};
      const espn = school.espn || {};
      const ref = yearDoc(
        record.year,
        'schoolRecords',
        `${record.regionID}_${record.seed}`,
      );
      batch.set(
        ref,
        {
          sID: toNum(record.sID),
          schoolName: school.name || null,
          nameNick: school.nameNick || null,
          mascot: school.mascot || null,
          espnID: espn.espnID ?? null,
          logoUrl: espn.logoURL ?? null,
          primaryColor: espn.primaryColor ?? null,
          conferenceName: confNameMap.get(school.confID) ?? null,
        },
        { merge: true },
      );
    }
    await batch.commit();
    if (schoolRecords.length > 0) {
      const year = schoolRecords[0].year;
      cacheDel(`tournamentDetails_${year}`);
      cacheDel(`allTeamNames_${year}`);
    }
  }
}

// ─── TeamRepository ───────────────────────────────────────────────

export class TeamRepository {
  async updateTeamRecordWithNulls(schoolId, year = thisYear) {
    Logger.debug('DB CALL: H.TeamRepository.updateTeamRecordWithNulls');
    // Atomic read-then-write; cache bust only fires on real updates.
    const updated = await db.runTransaction(async (transaction) => {
      const query = yearCol(year, 'schoolRecords').where(
        'sID',
        '==',
        toNum(schoolId),
      );
      const snapshot = await transaction.get(query);
      if (snapshot.empty) return false;
      snapshot.docs.forEach((doc) => {
        transaction.update(doc.ref, { points: null, gameStatus: [] });
      });
      return true;
    });
    if (updated) {
      cacheDel(`allTeamNames_${year}`);
      cacheDel(`tournamentDetails_${year}`);
    }
  }

  async updateTeamRecord(schoolId, points, gameStatus, year = thisYear) {
    Logger.debug('DB CALL: H.TeamRepository.updateTeamRecord');
    const updated = await db.runTransaction(async (transaction) => {
      const query = yearCol(year, 'schoolRecords').where(
        'sID',
        '==',
        toNum(schoolId),
      );
      const snapshot = await transaction.get(query);
      if (snapshot.empty) return false;
      snapshot.docs.forEach((doc) => {
        transaction.update(doc.ref, { points, gameStatus });
      });
      return true;
    });
    if (updated) {
      cacheDel(`allTeamNames_${year}`);
      cacheDel(`tournamentDetails_${year}`);
    }
  }

  // After a First Four game resolves, TWO schoolRecords docs share the
  // winner's sID: the original `ff_{gameID}_{slot}` doc (which carries
  // `canonicalDocId`) and the canonical `{regionID}_{seed}` clone (which has
  // that field stripped). An unordered `.limit(1)` query returned whichever
  // doc id sorts first — the canonical doc (digits sort before "ff_") — so
  // the `canonicalDocId` guard fired and the operation silently no-opped
  // (#373). Both methods below therefore read every sID match and select the
  // ff_ doc, the only one carrying `canonicalDocId`, explicitly.

  async createCanonicalSchoolRecord(winnerSID, year = thisYear) {
    Logger.debug('DB CALL: H.TeamRepository.createCanonicalSchoolRecord');
    await db.runTransaction(async (transaction) => {
      const query = yearCol(year, 'schoolRecords').where(
        'sID',
        '==',
        toNum(winnerSID),
      );
      const snapshot = await transaction.get(query);
      const ffDoc = snapshot.docs.find((doc) => doc.data().canonicalDocId);
      if (!ffDoc) return;
      const data = ffDoc.data();
      // Strip ff_-only fields so the canonical doc is indistinguishable from a regular school record
      const { canonicalDocId: docId, ...canonicalData } = data;
      transaction.set(yearDoc(year, 'schoolRecords', docId), canonicalData);
    });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`allTeamNames_${year}`);
    cacheDel(`activeGames_${year}`);
  }

  async deleteCanonicalSchoolRecord(winnerSID, year = thisYear) {
    Logger.debug('DB CALL: H.TeamRepository.deleteCanonicalSchoolRecord');
    await db.runTransaction(async (transaction) => {
      const query = yearCol(year, 'schoolRecords').where(
        'sID',
        '==',
        toNum(winnerSID),
      );
      const snapshot = await transaction.get(query);
      const ffDoc = snapshot.docs.find((doc) => doc.data().canonicalDocId);
      if (!ffDoc) return;
      const { canonicalDocId } = ffDoc.data();
      transaction.delete(yearDoc(year, 'schoolRecords', canonicalDocId));
    });
    cacheDel(`tournamentDetails_${year}`);
    cacheDel(`allTeamNames_${year}`);
    cacheDel(`activeGames_${year}`);
  }

  async getAllSchools() {
    Logger.debug('DB CALL: H.TeamRepository.getAllSchools');
    return _getCachedSchools();
  }

  /**
   * Schools stay top-level — same as flat repo.
   */
  async getSchoolById(sid) {
    Logger.debug('DB CALL: H.TeamRepository.getSchoolById');
    const doc = await db.collection('school').doc(String(sid)).get();
    return doc.exists ? doc.data() : null;
  }

  async updateSchool({ sid, name, mascot, nameNick, confID }) {
    Logger.debug('DB CALL: H.TeamRepository.updateSchool');
    // confID is now a string slug — store as-is
    await db
      .collection('school')
      .doc(String(sid))
      .update({ name, mascot, nameNick, confID });
    cacheDel('allSchools');
  }

  async updateSchoolConferenceHistory(sid, conferenceHistory) {
    Logger.debug('DB CALL: H.TeamRepository.updateSchoolConferenceHistory');
    await db
      .collection('school')
      .doc(String(sid))
      .update({ conferenceHistory });
  }

  async updateSchoolEspn(sid, espn) {
    Logger.debug('DB CALL: H.TeamRepository.updateSchoolEspn');
    await db.collection('school').doc(String(sid)).update({ espn });
    cacheDel('allSchools');
  }

  async findSchoolsByName(name) {
    Logger.debug('DB CALL: H.TeamRepository.findSchoolsByName');
    // Reuse the 24h-cached allSchools list — admin typeahead hits this
    // on every keystroke and previously did a full school collection
    // read each time.
    const allSchools = await _getCachedSchools();
    const lowerName = name.toLowerCase();
    return allSchools
      .filter(
        (data) =>
          (data.name && data.name.toLowerCase().includes(lowerName)) ||
          (data.mascot && data.mascot.toLowerCase().includes(lowerName)) ||
          (data.nameNick && data.nameNick.toLowerCase().includes(lowerName)),
      )
      .map(({ sid, name, mascot, nameNick, confID }) => ({
        sid,
        name,
        mascot,
        nameNick,
        confID,
      }));
  }

  async getMaxSchoolId() {
    Logger.debug('DB CALL: H.TeamRepository.getMaxSchoolId');
    // Ignore the reserved live-E2E block (#502): test schools are inserted into
    // this same global `school` collection, so a leaked fixture would otherwise
    // become the max and push the next real school to 1000000 — permanently, and
    // into a range a later test run could collide with. Bounding the read below
    // the block keeps test and production id space separate even when cleanup
    // fails. Range + orderBy on the same field, so no new index and still one read.
    const snapshot = await db
      .collection('school')
      .where('sid', '<', RESERVED_TEST_SID_MIN)
      .orderBy('sid', 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) return 0;
    return snapshot.docs[0].data().sid;
  }

  async insertSchool({
    sid,
    name,
    mascot,
    nameNick,
    confID,
    conferenceHistory,
  }) {
    Logger.debug('DB CALL: H.TeamRepository.insertSchool');
    // confID is a string slug; bootstrap conferenceHistory if not provided
    const history =
      conferenceHistory ??
      (confID ? [{ confID, startYear: null, endYear: null }] : []);
    await db
      .collection('school')
      .doc(String(sid))
      .set({ sid, name, mascot, nameNick, confID, conferenceHistory: history });
    cacheDel('allSchools');
  }

  async deleteSchool(sid) {
    Logger.debug('DB CALL: H.TeamRepository.deleteSchool');
    await db.collection('school').doc(String(sid)).delete();
    cacheDel('allSchools');
  }
}

// ─── ConferenceRepository ─────────────────────────────────────────

export class ConferenceRepository {
  async getAllConferences() {
    Logger.debug('DB CALL: H.ConferenceRepository.getAllConferences');
    return _getCachedConferences();
  }

  async getConferenceBySlug(slug) {
    Logger.debug('DB CALL: H.ConferenceRepository.getConferenceBySlug');
    const doc = await db.collection('conferences').doc(slug).get();
    return doc.exists ? { slug: doc.id, ...doc.data() } : null;
  }

  async insertConference({ slug, name, shortName, division, active }) {
    Logger.debug('DB CALL: H.ConferenceRepository.insertConference');
    await db
      .collection('conferences')
      .doc(slug)
      .set({
        name,
        shortName,
        division: division || 'I',
        active: active ?? true,
      });
    cacheDel('allConferences');
  }

  async updateConference(slug, { name, shortName, division, active }) {
    Logger.debug('DB CALL: H.ConferenceRepository.updateConference');
    await db
      .collection('conferences')
      .doc(slug)
      .update({ name, shortName, division, active });
    cacheDel('allConferences');
  }
}

// ─── SessionRepository ────────────────────────────────────────────

const SESSION_COLLECTION = 'express-sessions';

export class SessionRepository {
  /**
   * Read one session document. Returns the raw stored shape
   * (`{ session, expires }`) or null when the document is absent.
   *
   * The express-session store adapter (`FirestoreStore`) delegates here rather
   * than holding its own collection handle, so this class is the single owner
   * of the `express-sessions` collection — `clearAuthenticatedSessions` below
   * depends on the document shape, and two independent owners could drift.
   */
  async getSession(sid) {
    Logger.debug('DB CALL: H.SessionRepository.getSession');
    const doc = await db.collection(SESSION_COLLECTION).doc(sid).get();
    return doc.exists ? doc.data() : null;
  }

  /**
   * Write one session document. `expires` is an epoch-millis number; the
   * mirrored `expireAt` timestamp lets a Firestore TTL policy reap dead
   * sessions for free (same pattern as the rateLimits store).
   */
  async setSession(sid, { session, expires }) {
    Logger.debug('DB CALL: H.SessionRepository.setSession');
    await db
      .collection(SESSION_COLLECTION)
      .doc(sid)
      .set({
        session,
        expires,
        expireAt: Firestore.Timestamp.fromMillis(expires),
      });
  }

  /** Delete one session document. */
  async deleteSession(sid) {
    Logger.debug('DB CALL: H.SessionRepository.deleteSession');
    await db.collection(SESSION_COLLECTION).doc(sid).delete();
  }

  /**
   * Clears Google-authenticated sessions. Default scope (`includeAdmins: false`,
   * the "Clear Google Sign-Ins" admin button) deletes participant-only docs
   * outright but, for a doc that carries BOTH `userEmail` and `adminEmail`
   * (the two identities are merged onto one session doc by handleUserLogin /
   * handleAdminLogin — see docs/architecture/security.md), strips only the
   * `userEmail` field so the admin's own console session survives. Without this
   * split, an operator responding to a suspected participant compromise would
   * also destroy their own (or another admin's) active admin session — a
   * documented incident-response control silently deleting more than it says
   * (#428). Pure admin-only docs are left untouched by default. Pass
   * `{ includeAdmins: true }` for full incident response, which restores the
   * old OR-delete behavior (every doc with either field, merged or not).
   *
   * The session store keeps the express-session payload under a `session` field
   * (see `FirestoreStore.set`), so we inspect `data.session` rather than the
   * document root. Scans the whole collection because Firestore can't express an
   * "either field exists" filter; this runs only on a manual admin action, so the
   * read volume stays well inside the free tier.
   *
   * @param {{ includeAdmins?: boolean }} [options]
   * @returns {Promise<{ deleted: number, strippedAdminDocs: number }>} deleted
   *   is the count of session docs removed outright; strippedAdminDocs is the
   *   count of merged admin docs that had only their userEmail field cleared.
   */
  async clearAuthenticatedSessions({ includeAdmins = false } = {}) {
    Logger.debug('DB CALL: H.SessionRepository.clearAuthenticatedSessions');
    const snapshot = await db.collection(SESSION_COLLECTION).get();

    const toDelete = [];
    const toStripUserEmail = [];
    for (const doc of snapshot.docs) {
      const sess = (doc.data() || {}).session || {};
      const hasUser = !!sess.userEmail;
      const hasAdmin = !!sess.adminEmail;
      if (!hasUser && !hasAdmin) continue;

      if (hasAdmin && !includeAdmins) {
        // Admin identity present and full incident response wasn't requested:
        // never delete the doc. A merged doc still loses its participant half.
        if (hasUser) toStripUserEmail.push(doc);
      } else {
        toDelete.push(doc);
      }
    }

    const BATCH_SIZE = 450;
    const commitPromises = [];
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = db.batch();
      toDelete.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
      commitPromises.push(batch.commit());
    }
    for (let i = 0; i < toStripUserEmail.length; i += BATCH_SIZE) {
      const batch = db.batch();
      toStripUserEmail
        .slice(i, i + BATCH_SIZE)
        .forEach((doc) =>
          batch.update(doc.ref, { 'session.userEmail': FieldValue.delete() }),
        );
      commitPromises.push(batch.commit());
    }

    try {
      await Promise.all(commitPromises);
    } catch (error) {
      Logger.error('Error clearing some authenticated sessions', { error });
      // Log for visibility and rethrow so the caller (admin action) surfaces the failure;
      // sessions already deleted/stripped stay deleted/stripped.
      throw error;
    }

    return {
      deleted: toDelete.length,
      strippedAdminDocs: toStripUserEmail.length,
    };
  }
}

// ─── RateLimitRepository ──────────────────────────────────────────

const RATE_LIMIT_COLLECTION = 'rateLimits';

/**
 * Collapse a rate-limit bucket key to a safe Firestore document id.
 *
 * Firestore rejects ids containing `/` and caps them at 1500 bytes; callers
 * pass IP- or email-derived keys, so encode first and then truncate.
 */
function safeDocId(key) {
  return encodeURIComponent(String(key)).slice(0, 256);
}

export class RateLimitRepository {
  /**
   * Atomic fixed-window counter shared across all Cloud Run instances.
   *
   * Once the window count has reached `max`, the write is skipped: the request
   * is already blocked, the block decision needs no further state (resetTime is
   * fixed), and skipping avoids hammering a single doc past Firestore's
   * ~1 write/s soft limit.
   *
   * @param {{ key: string, windowMs: number, max: number, now?: number }} params
   * @returns {Promise<{ count: number, resetTime: number }>}
   */
  async incrementWindow({ key, windowMs, max, now = Date.now() }) {
    Logger.debug('DB CALL: H.RateLimitRepository.incrementWindow');
    const ref = db.collection(RATE_LIMIT_COLLECTION).doc(safeDocId(key));

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;

      let count;
      let resetTime;
      if (!data || data.resetTime <= now) {
        count = 1;
        resetTime = now + windowMs;
      } else {
        // Already at/over the cap: return a blocking count without writing.
        if (data.count >= max) {
          return { count: data.count + 1, resetTime: data.resetTime };
        }
        count = data.count + 1;
        resetTime = data.resetTime;
      }

      tx.set(ref, {
        count,
        resetTime,
        // Lets an optional Firestore TTL policy on `expireAt` reap abandoned keys
        // for free. Not required for correctness (windows reset in place).
        expireAt: Firestore.Timestamp.fromMillis(resetTime + windowMs),
      });

      return { count, resetTime };
    });
  }
}
