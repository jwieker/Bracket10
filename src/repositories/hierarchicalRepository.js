import { db } from "../config/firestore.js";
import { thisYear, APP_CONFIG } from "../config/app.js";

// Entries whose only group is in this list are filtered out of standard listings.
// Historically "Bad" was a sandbox group whose entries shouldn't appear in pick
// counts, rankings, or all-entries reads. Configure via APP_CONFIG.tournament.excludedGroups.
const EXCLUDED_GROUPS = new Set(APP_CONFIG.tournament.excludedGroups || []);
function isExcludedOnlyGroup(groups) {
    return groups.length === 1 && EXCLUDED_GROUPS.has(groups[0]);
}
import Logger from "../utils/logger.js";
import { cacheGet, cacheSet, cacheDel, invalidateCache } from "../utils/cacheUtils.js";

// ─── Path helpers ─────────────────────────────────────────────────

const toNum = (v) => (v == null ? v : Number(v));

/** Returns a subcollection ref under tournaments/{year} */
function yearCol(year, sub) {
    return db.collection('tournaments').doc(String(toNum(year))).collection(sub);
}

/** Direct doc ref inside a year-scoped subcollection */
function yearDoc(year, sub, docId) {
    return yearCol(year, sub).doc(String(docId));
}

// ─── EntryRepository ──────────────────────────────────────────────

export class EntryRepository {
    /**
     * Update points for multiple entries.
     */
    async updateMultipleEntryPoints(pointsChunk, year = thisYear) {
        Logger.debug('DB CALL: H.EntryRepository.updateMultipleEntryPoints');
        try {
            const batch = db.batch();
            for (const { entryID, points, possPoints } of pointsChunk) {
                const ref = yearDoc(year, 'entries', toNum(entryID));
                batch.update(ref, { totalPoints: points, possPoints });
            }
            await batch.commit();
        } catch (error) {
            Logger.error("Error in updateMultipleEntryPoints:", error);
            throw error;
        }
    }

    async createEntry(id, email, teamName, picks, groupName, personName, created_at, year = thisYear, maxPoints = 0) {
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
            totalPoints: 0
        });
        groups.forEach(g => {
            cacheDel(`groupTeams_${g}_${year}`);
            cacheDel(`entriesForGroup_${g}_${year}`);
            cacheDel(`gameViewData_${year}_${g}`);
        });
        cacheDel(`allEntries_${year}`);
    }

    async findEntriesByName(name, year = thisYear) {
        Logger.debug('DB CALL: H.EntryRepository.findEntriesByName');
        // No year filter needed — scoped by path
        const snapshot = await yearCol(year, 'entries').get();
        const lowerName = name.toLowerCase();
        return snapshot.docs
            .map(doc => doc.data())
            .filter(data =>
                (data.person && data.person.toLowerCase().includes(lowerName)) ||
                (data.teamName && data.teamName.toLowerCase().includes(lowerName))
            )
            .map(data => ({
                id: data.id,
                teamName: data.teamName,
                person: data.person,
                year: toNum(year),
                groups: data.groups || [data.group].filter(Boolean),
                hasPaid: data.hasPaid || false,
                paymentNote: data.paymentNote || '',
                payByCheck: data.payByCheck || false
            }));
    }

    async getUnpaidEntriesForGroup(groupName, year = thisYear) {
        Logger.debug('DB CALL: H.EntryRepository.getUnpaidEntriesForGroup');
        const snapshot = await yearCol(year, 'entries')
            .where('groups', 'array-contains', groupName)
            .get();
        return snapshot.docs
            .map(doc => doc.data())
            .filter(data => !data.hasPaid && !data.payByCheck)
            .map(data => ({
                id: data.id,
                teamName: data.teamName,
                person: data.person,
                year: toNum(year),
                groups: data.groups || [data.group].filter(Boolean),
                hasPaid: false,
                paymentNote: data.paymentNote || ''
            }));
    }

    async deleteEntry(entryId, year = thisYear) {
        Logger.debug('DB CALL: H.EntryRepository.deleteEntry');
        await yearDoc(year, 'entries', entryId).delete();
        invalidateCache('groupTeams_');
        invalidateCache('entriesForGroup_');
        cacheDel(`allEntries_${year}`);
    }

    async updateEntryPicks(entryId, newPicks, year) {
        Logger.debug('DB CALL: H.EntryRepository.updateEntryPicks');
        await yearDoc(year, 'entries', entryId).update({ picks: newPicks });
        invalidateCache('entriesForGroup_');
        cacheDel(`allEntries_${year}`);
    }

    async updateMultipleEntryPicks(updates, year) {
        Logger.debug('DB CALL: H.EntryRepository.updateMultipleEntryPicks');
        if (updates.length === 0) return;
        const BATCH_SIZE = 500;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const chunk = updates.slice(i, i + BATCH_SIZE);
            const batch = db.batch();
            for (const { entryId, picks } of chunk) {
                batch.update(yearDoc(year, 'entries', entryId), { picks });
            }
            await batch.commit();
        }
        invalidateCache('entriesForGroup_');
        cacheDel(`allEntries_${year}`);
    }

    async getUnsentEmailEntries(groupName, year = thisYear) {
        Logger.debug('DB CALL: H.EntryRepository.getUnsentEmailEntries');
        const snapshot = await yearCol(year, 'entries')
            .where('groups', 'array-contains', groupName)
            .get();
        return snapshot.docs
            .map(doc => doc.data())
            .filter(data => !data.emailSent)
            .map(data => ({
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
        const batch = db.batch();
        for (const entryId of entryIds) {
            const ref = yearDoc(year, 'entries', entryId);
            batch.update(ref, { emailSent: true });
        }
        await batch.commit();
    }
}

// ─── ViewRepository ───────────────────────────────────────────────

export class ViewRepository {
    /**
     * Groups stay top-level — same as flat repo.
     */
    async findGroupByName(name) {
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
        // Fall back to case-insensitive search
        const snapshot = await db.collection('groups').get();
        const lowerName = name.toLowerCase();
        const found = snapshot.docs.find(d => d.data().name && d.data().name.toLowerCase() === lowerName);
        const result = found ? found.data().name : null;
        cacheSet(cacheKey, result, 86400);
        return result;
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
        const result = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: data.id,
                teamName: data.teamName,
                picks: data.picks,
                totalPoints: data.totalPoints,
                person: data.person,
                possPoints: data.possPoints
            };
        });
        cacheSet(cacheKey, result, 300);
        return result;
    }

    async getMaxGroupId() {
        Logger.debug('DB CALL: H.ViewRepository.getMaxGroupId');
        const snapshot = await db.collection('groups').orderBy('id', 'desc').limit(1).get();
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
        const cacheKey = 'allGroups';
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await db.collection('groups').orderBy('name', 'asc').get();
        const result = snapshot.docs.map(doc => doc.data().name);

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
    }
}

// ─── GameRepository ───────────────────────────────────────────────

export class GameRepository {
    async updateWinner(gameID, winner, year = thisYear) {
        Logger.debug('DB CALL: H.GameRepository.updateWinner');
        await yearDoc(year, 'games', gameID).update({ winner });
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`activeGames_${year}`);
        cacheDel(`activeFutureGames_${year}`);
        invalidateCache(`gameViewData_${year}_`);
    }

    async updateNextGameTeam(nextGame, nextGameSpot, winner, year = thisYear) {
        Logger.debug('DB CALL: H.GameRepository.updateNextGameTeam');
        const prefix = nextGameSpot === 1 ? "team1" : "team2";

        let teamName = null;
        let teamSeed = null;
        if (winner) {
            const recSnap = await yearCol(year, 'schoolRecords').where('sID', '==', winner).limit(1).get();
            if (!recSnap.empty) {
                const recData = recSnap.docs[0].data();
                teamName = recData.nameNick || recData.schoolName || null;
                teamSeed = recData.seed ?? null;
            }
        }

        await yearDoc(year, 'games', nextGame).update({
            [`${prefix}ID`]: winner,
            [`${prefix}Name`]: teamName,
            [`${prefix}Seed`]: teamSeed
        });
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`activeGames_${year}`);
        cacheDel(`activeFutureGames_${year}`);
        invalidateCache(`gameViewData_${year}_`);

    }

    async getActiveAndFutureGames(year = thisYear) {
        Logger.debug('DB CALL: H.GameRepository.getActiveAndFutureGames');
        const cacheKey = `activeFutureGames_${year}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        // No year filter needed — path-scoped; only return unresolved games
        const snapshot = await yearCol(year, 'games').where('winner', '==', null).get();
        const result = snapshot.docs.map(doc => ({ ...doc.data(), year: toNum(year) }))
            .sort((a, b) => a.gameID - b.gameID);

        cacheSet(cacheKey, result, 300);
        return result;
    }

    async deleteGamesByYear(year) {
        Logger.debug('DB CALL: H.GameRepository.deleteGamesByYear');
        const snapshot = await yearCol(year, 'games').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    async deleteSchoolRecordsByYear(year) {
        Logger.debug('DB CALL: H.GameRepository.deleteSchoolRecordsByYear');
        const snapshot = await yearCol(year, 'schoolRecords').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    async getEntriesContainingTeams(year, teamSIDs) {
        Logger.debug('DB CALL: H.GameRepository.getEntriesContainingTeams');
        const snapshot = await yearCol(year, 'entries')
            .where('picks', 'array-contains-any', teamSIDs.map(Number))
            .get();
        return snapshot.docs
            .map(doc => doc.data())
            .filter(data => {
                const groups = data.groups || (data.group ? [data.group] : []);
                return !isExcludedOnlyGroup(groups);
            })
            .map(data => ({
                id: data.id, teamName: data.teamName, picks: data.picks,
                totalPoints: data.totalPoints, person: data.person,
                groups: data.groups || (data.group ? [data.group] : [])
            }));
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
            .map(doc => doc.data())
            .sort((a, b) => a.id - b.id)
            .map(data => ({
                id: data.id, teamName: data.teamName, picks: data.picks,
                totalPoints: data.totalPoints, person: data.person,
                groups: data.groups || (data.group ? [data.group] : [])
            }));

        cacheSet(cacheKey, result); // Default TTL; busted by clearAllCache after point updates
        return result;
    }

    async getAllEntries(year = thisYear) {
        Logger.debug('DB CALL: H.GameRepository.getAllEntries');
        const cacheKey = `allEntries_${year}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await yearCol(year, 'entries').get();
        const result = snapshot.docs
            .map(doc => doc.data())
            .filter(data => {
                const groups = data.groups || (data.group ? [data.group] : []);
                return !isExcludedOnlyGroup(groups);
            })
            .sort((a, b) => a.id - b.id)
            .map(data => ({
                id: data.id, teamName: data.teamName, picks: data.picks,
                totalPoints: data.totalPoints, person: data.person,
                groups: data.groups || (data.group ? [data.group] : [])
            }));

        cacheSet(cacheKey, result); // Default TTL; busted by clearAllCache after point updates
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
            .map(doc => {
                const sR = doc.data();
                return {
                    seed: sR.seed,
                    sID: sR.sID,
                    points: sR.points,
                    name: sR.schoolName || null,
                    mascot: sR.mascot || null,
                    nameNick: sR.nameNick || null,
                    regionName: sR.regionName || '',
                    gameStatus: sR.gameStatus
                };
            })
            .sort((a, b) => {
                if (a.seed !== b.seed) return a.seed - b.seed;
                return (a.regionName || '').localeCompare(b.regionName || '');
            });

        cacheSet(cacheKey, result, 86400);
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
        regionsSnap.docs.forEach(doc => {
            const data = doc.data();
            regionsMap.set(data.regionID, data);
        });

        // Build sID → { nameNick, seed } so games missing denormalized fields still show names
        const schoolMap = new Map();
        recordsSnap.docs.forEach(doc => {
            const d = doc.data();
            schoolMap.set(d.sID, { nameNick: d.nameNick || null, seed: d.seed ?? null });
        });

        const result = gamesSnap.docs
            .map(doc => ({ ...doc.data(), year: toNum(year) }))
            .filter(g => g.team1ID !== null && g.team2ID !== null)
            .map(g => {
                const t1 = schoolMap.get(g.team1ID) || {};
                const t2 = schoolMap.get(g.team2ID) || {};
                return {
                    ...g,
                    ...(regionsMap.get(g.regionID) || {}),
                    team1Name: g.team1Name ?? t1.nameNick,
                    team1Seed: g.team1Seed ?? t1.seed,
                    team2Name: g.team2Name ?? t2.nameNick,
                    team2Seed: g.team2Seed ?? t2.seed,
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
        regionsSnap.docs.forEach(doc => {
            const d = doc.data();
            regionsMap.set(d.regionID, d);
        });

        // All games sorted by gameID
        const allGames = gamesSnap.docs
            .map(doc => ({ ...doc.data(), year: toNum(year) }))
            .sort((a, b) => a.gameID - b.gameID);

        // Active games (both slots filled) with regionName merged in, sorted as before
        const activeGames = allGames
            .filter(g => g.team1ID !== null && g.team2ID !== null)
            .map(g => ({ ...g, ...(regionsMap.get(g.regionID) || {}) }))
            .sort((a, b) => {
                const aWinner = a.winner === null ? -Infinity : a.winner;
                const bWinner = b.winner === null ? -Infinity : b.winner;
                if (aWinner !== bWinner) return aWinner - bWinner;
                return a.gameID - b.gameID;
            });

        // Teams — same shape as getTournamentTeams, plus denormalized ESPN/conference fields
        const teams = recordsSnap.docs
            .map(doc => {
                const sR = doc.data();
                return {
                    seed: sR.seed, sID: sR.sID, points: sR.points,
                    name: sR.schoolName || null, mascot: sR.mascot || null,
                    nameNick: sR.nameNick || null, regionName: sR.regionName || '',
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

        // The 4 bracket quadrant regions — pulled directly from the DB map in insertion order.
        const regions = Array.from(regionsMap.values());

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
        // Run two queries: one for the new `groups` array field and one for
        // the old singular `group` string field (legacy entries).
        await Promise.all(tournamentsSnap.docs.map(async (doc) => {
            const year = doc.id;
            const [newSnap, legacySnap] = await Promise.all([
                yearCol(year, 'entries')
                    .where('groups', 'array-contains', groupName)
                    .limit(1)
                    .get(),
                yearCol(year, 'entries')
                    .where('group', '==', groupName)
                    .limit(1)
                    .get(),
            ]);
            if (!newSnap.empty || !legacySnap.empty) {
                years.push(toNum(year));
            }
        }));

        const result = years.sort((a, b) => b - a).map(year => ({ year }));
        cacheSet(cacheKey, result, 31536000); // 365 days — busted by clearAllCache on writes
        return result;
    }

    /**
     * getRegionsForYear — now a local derivation from allGames.
     * Kept for backward compatibility with any callers not yet migrated.
     * Prefer getAllTournamentDetails which already computes this.
     */
    async getRegionsForYear(year = thisYear) {
        Logger.debug('DB CALL: H.GameRepository.getRegionsForYear');
        const { allGames } = await this.getAllTournamentDetails(year);
        return allGames
            .sort((a, b) => a.gameID - b.gameID)
            .map(g => ({ regionID: g.regionID, gameID: g.gameID }));
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
            groups: Array.isArray(entry.groups) ? entry.groups : [entry.groups].filter(Boolean),
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
        invalidateCache('entriesForGroup_');
        cacheDel(`allEntries_${entry.year}`);
    }
}

// ─── TourneyRepository ────────────────────────────────────────────

export class TourneyRepository {
    async getAllRegions(year = thisYear) {
        Logger.debug('DB CALL: H.TourneyRepository.getAllRegions');
        const cacheKey = `allRegions_${year}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await yearCol(year, 'regions').orderBy('__name__', 'asc').get();
        const result = snapshot.docs.map(doc => doc.data());

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
    }

    async getAllRegionTypes() {
        Logger.debug('DB CALL: H.TourneyRepository.getAllRegionTypes');
        const cacheKey = 'allRegionTypes';
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await db.collection('regionID').orderBy('regionID', 'asc').get();
        const result = snapshot.docs.map(doc => doc.data());

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
    }

    async insertRegionsForYear(year, regionIDs) {
        Logger.debug('DB CALL: H.TourneyRepository.insertRegionsForYear');
        // Load master region definitions
        const masterSnap = await db.collection('regionID').get();
        const masterMap = new Map();
        masterSnap.docs.forEach(doc => {
            const d = doc.data();
            masterMap.set(Number(d.regionID), d);
        });
        const batch = db.batch();
        // Doc name is the 1-based position ("1"–"6"), which doubles as sort key.
        regionIDs.forEach((id, index) => {
            const region = masterMap.get(Number(id));
            if (region) {
                batch.set(yearDoc(year, 'regions', String(index + 1)), {
                    ...region,
                });
            }
        });
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
    }

    async getAllTeams() {
        Logger.debug('DB CALL: H.TourneyRepository.getAllTeams');
        const cacheKey = 'allSchools';
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        // Schools stay top-level
        const snapshot = await db.collection('school').orderBy('name', 'asc').get();
        const result = snapshot.docs.map(doc => doc.data());

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
    }

    async getSchoolRecordsForYear(year) {
        Logger.debug('DB CALL: H.TourneyRepository.getSchoolRecordsForYear');
        const snapshot = await yearCol(year, 'schoolRecords').get();
        return snapshot.docs
            .map(doc => {
                const d = doc.data();
                return { sID: d.sID, year: toNum(year), seed: d.seed, regionID: d.regionID };
            })
            .sort((a, b) => a.seed !== b.seed ? a.seed - b.seed : a.regionID - b.regionID);
    }

    async deleteGamesByYear(year) {
        Logger.debug('DB CALL: H.TourneyRepository.deleteGamesByYear');
        const snapshot = await yearCol(year, 'games').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`activeGames_${year}`);
        cacheDel(`activeFutureGames_${year}`);
    }

    async deleteSchoolRecordsByYear(year) {
        Logger.debug('DB CALL: H.TourneyRepository.deleteSchoolRecordsByYear');
        const snapshot = await yearCol(year, 'schoolRecords').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`allTeamNames_${year}`);
    }

    async deleteRegionsByYear(year) {
        Logger.debug('DB CALL: H.TourneyRepository.deleteRegionsByYear');
        const snapshot = await yearCol(year, 'regions').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
    }

    async deleteTournamentDoc(year) {
        Logger.debug('DB CALL: H.TourneyRepository.deleteTournamentDoc');
        await db.collection('tournaments').doc(String(year)).delete();
    }

    async upsertTournamentDoc(year, options = {}) {
        Logger.debug('DB CALL: H.TourneyRepository.upsertTournamentDoc');
        const data = { year: Number(year) };
        if (options.hasFirstFour !== undefined) data.hasFirstFour = options.hasFirstFour;
        if (options.firstFourGameCount !== undefined) data.firstFourGameCount = options.firstFourGameCount;
        await db.collection('tournaments').doc(String(year)).set(data, { merge: true });
    }

    async insertFirstFourGames(games, year) {
        Logger.debug('DB CALL: H.TourneyRepository.insertFirstFourGames');
        if (games.length === 0) return;

        const schoolsSnap = await db.collection('school').get();
        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => schoolsMap.set(String(doc.data().sid), doc.data()));

        const batch = db.batch();
        for (const game of games) {
            const school1 = schoolsMap.get(String(game.team1ID)) || {};
            const school2 = schoolsMap.get(String(game.team2ID)) || {};
            batch.set(yearDoc(year, 'games', game.gameID), {
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
            });
        }
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`activeGames_${year}`);
        cacheDel(`activeFutureGames_${year}`);
    }

    async insertFirstFourSchoolRecords(records, year) {
        Logger.debug('DB CALL: H.TourneyRepository.insertFirstFourSchoolRecords');
        if (records.length === 0) return;

        const [schoolsSnap, regionsSnap, conferencesSnap] = await Promise.all([
            db.collection('school').get(),
            yearCol(year, 'regions').get(),
            db.collection('conferences').get(),
        ]);

        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => {
            const d = doc.data();
            schoolsMap.set(String(d.sid), d);
        });

        const regionsMap = new Map();
        regionsSnap.docs.forEach(doc => {
            const d = doc.data();
            regionsMap.set(String(d.regionID), d.regionName);
        });

        const confNameMap = new Map();
        conferencesSnap.docs.forEach(doc => {
            const d = doc.data();
            confNameMap.set(doc.id, d.shortName || d.name || null);
        });

        const batch = db.batch();
        for (const record of records) {
            const school = schoolsMap.get(String(record.sID)) || {};
            const espn = school.espn || {};
            const regionName = regionsMap.get(String(record.r1RegionID)) || null;
            const docId = `ff_${record.gameID}_${record.slot}`;
            batch.set(yearDoc(year, 'schoolRecords', docId), {
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
            });
        }
        await batch.commit();
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`allTeamNames_${year}`);
    }

    async insertMultipleGamesWithoutTeams(gamesWithoutTeams) {
        Logger.debug('DB CALL: H.TourneyRepository.insertMultipleGamesWithoutTeams');
        if (gamesWithoutTeams.length === 0) return;

        const yearStr = String(gamesWithoutTeams[0][2]);

        const batch = db.batch();
        // Ensure the tournament parent doc exists so years are queryable
        batch.set(db.collection('tournaments').doc(yearStr), { year: Number(yearStr) }, { merge: true });

        for (const game of gamesWithoutTeams) {
            const [gameID, regionID, year, , , , round, nextGameID, nextGameSpot] = game;
            batch.set(yearDoc(year, 'games', gameID), {
                gameID, regionID, round,
                team1ID: null,
                team2ID: null,
                winner: null,
                nextGameID: nextGameID ?? null,
                nextGameSpot: nextGameSpot ?? null
            });
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

        const yearStr = String(gamesWithTeams[0][2]);

        const schoolsSnap = await db.collection('school').get();
        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => schoolsMap.set(String(doc.data().sid), doc.data()));

        const batch = db.batch();
        // Ensure the tournament parent doc exists so years queryable
        batch.set(db.collection('tournaments').doc(yearStr), { year: Number(yearStr) }, { merge: true });

        for (const game of gamesWithTeams) {
            const [gameID, regionID, year, team1ID, team2ID, , round, nextGameID, nextGameSpot, seed1, seed2] = game;

            const school1 = team1ID != null ? (schoolsMap.get(String(team1ID)) || {}) : {};
            const school2 = team2ID != null ? (schoolsMap.get(String(team2ID)) || {}) : {};

            batch.set(yearDoc(year, 'games', gameID), {
                gameID, regionID, team1ID: team1ID ?? null, team2ID: team2ID ?? null, round,
                team1Name: school1.nameNick || school1.name || null,
                team1Seed: seed1 ?? null,
                team2Name: school2.nameNick || school2.name || null,
                team2Seed: seed2 ?? null,
                winner: null,
                nextGameID: nextGameID ?? null,
                nextGameSpot: nextGameSpot ?? null
            });
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

        const schoolsSnap = await db.collection('school').get();
        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => schoolsMap.set(String(doc.data().sid), doc.data()));

        const batch = db.batch();
        for (const game of gamesWithTeams) {
            const [gameID, regionID, year, team1ID, team2ID, , round, nextGameID, nextGameSpot, seed1, seed2] = game;

            const school1 = team1ID != null ? (schoolsMap.get(String(team1ID)) || {}) : {};
            const school2 = team2ID != null ? (schoolsMap.get(String(team2ID)) || {}) : {};

            const ref = yearDoc(year, 'games', gameID);
            batch.set(ref, {
                team1ID: team1ID ?? null, team2ID: team2ID ?? null,
                team1Name: school1.nameNick || school1.name || null,
                team1Seed: seed1 ?? null,
                team2Name: school2.nameNick || school2.name || null,
                team2Seed: seed2 ?? null
            }, { merge: true });
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

        // Fetch school data, region names, and conferences in parallel to denormalize
        const [schoolsSnap, regionsSnap, conferencesSnap] = await Promise.all([
            db.collection('school').get(),
            yearCol(schoolRecords[0].year, 'regions').get(),
            db.collection('conferences').get(),
        ]);

        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => {
            const d = doc.data();
            schoolsMap.set(String(d.sid), d);
        });

        const regionsMap = new Map();
        regionsSnap.docs.forEach(doc => {
            const d = doc.data();
            regionsMap.set(String(d.regionID), d.regionName);
        });

        // Map conference slug → display name (prefer shortName)
        const confNameMap = new Map();
        conferencesSnap.docs.forEach(doc => {
            const d = doc.data();
            confNameMap.set(doc.id, d.shortName || d.name || null);
        });

        const batch = db.batch();
        for (const record of schoolRecords) {
            const school = schoolsMap.get(String(record.sID)) || {};
            const regionName = regionsMap.get(String(record.regionID)) || null;
            // ESPN data is stored nested under school.espn by enrichEspnData.js
            const espn = school.espn || {};
            batch.set(yearDoc(record.year, 'schoolRecords', `${record.regionID}_${record.seed}`), {
                sID: toNum(record.sID),
                seed: record.seed,
                regionID: record.regionID,
                points: null,
                gameStatus: [],
                // Denormalized school identity
                schoolName: school.name || null,
                nameNick: school.nameNick || null,
                mascot: school.mascot || null,
                regionName,
                // Denormalized ESPN / conference fields (eliminates allSchools + allConferences
                // fetches from the game view render path)
                espnID: espn.espnID ?? null,
                logoUrl: espn.logoURL ?? null,        // ESPN stores as logoURL; normalize to logoUrl
                primaryColor: espn.primaryColor ?? null,
                conferenceName: confNameMap.get(school.confID) ?? null,
            });
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

        // Look up school data and conferences to keep all denormalized fields fresh
        const [schoolsSnap, conferencesSnap] = await Promise.all([
            db.collection('school').get(),
            db.collection('conferences').get(),
        ]);

        const schoolsMap = new Map();
        schoolsSnap.docs.forEach(doc => {
            const d = doc.data();
            schoolsMap.set(String(d.sid), d);
        });

        const confNameMap = new Map();
        conferencesSnap.docs.forEach(doc => {
            const d = doc.data();
            confNameMap.set(doc.id, d.shortName || d.name || null);
        });

        const batch = db.batch();
        for (const record of schoolRecords) {
            const school = schoolsMap.get(String(record.sID)) || {};
            const espn = school.espn || {};
            const ref = yearDoc(record.year, 'schoolRecords', `${record.regionID}_${record.seed}`);
            batch.set(ref, {
                sID: toNum(record.sID),
                schoolName: school.name || null,
                nameNick: school.nameNick || null,
                mascot: school.mascot || null,
                espnID: espn.espnID ?? null,
                logoUrl: espn.logoURL ?? null,
                primaryColor: espn.primaryColor ?? null,
                conferenceName: confNameMap.get(school.confID) ?? null,
            }, { merge: true });
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
        const snapshot = await yearCol(year, 'schoolRecords')
            .where('sID', '==', toNum(schoolId))
            .get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.update(doc.ref, { points: null, gameStatus: [] }));
            await batch.commit();
            cacheDel(`allTeamNames_${year}`);
            cacheDel(`tournamentDetails_${year}`);
        }
    }

    async updateTeamRecord(schoolId, points, gameStatus, year = thisYear) {
        Logger.debug('DB CALL: H.TeamRepository.updateTeamRecord');
        const snapshot = await yearCol(year, 'schoolRecords')
            .where('sID', '==', toNum(schoolId))
            .get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.update(doc.ref, { points, gameStatus }));
            await batch.commit();
            cacheDel(`allTeamNames_${year}`);
            cacheDel(`tournamentDetails_${year}`);
        }
    }

    async createCanonicalSchoolRecord(winnerSID, year = thisYear) {
        Logger.debug('DB CALL: H.TeamRepository.createCanonicalSchoolRecord');
        const snapshot = await yearCol(year, 'schoolRecords')
            .where('sID', '==', toNum(winnerSID))
            .limit(1)
            .get();
        if (snapshot.empty) return;
        const data = snapshot.docs[0].data();
        const docId = data.canonicalDocId;
        if (!docId) return;
        // Strip ff_-only fields so the canonical doc is indistinguishable from a regular school record
        const { canonicalDocId: _cid, ...canonicalData } = data;
        await yearDoc(year, 'schoolRecords', docId).set(canonicalData);
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`allTeamNames_${year}`);
        cacheDel(`activeGames_${year}`);
    }

    async deleteCanonicalSchoolRecord(winnerSID, year = thisYear) {
        Logger.debug('DB CALL: H.TeamRepository.deleteCanonicalSchoolRecord');
        const snapshot = await yearCol(year, 'schoolRecords')
            .where('sID', '==', toNum(winnerSID))
            .limit(1)
            .get();
        if (snapshot.empty) return;
        const data = snapshot.docs[0].data();
        const docId = data.canonicalDocId;
        if (!docId) return;
        await yearDoc(year, 'schoolRecords', docId).delete();
        cacheDel(`tournamentDetails_${year}`);
        cacheDel(`allTeamNames_${year}`);
        cacheDel(`activeGames_${year}`);
    }

    async getAllSchools() {
        Logger.debug('DB CALL: H.TeamRepository.getAllSchools');
        const cacheKey = 'allSchools';
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await db.collection('school').get();
        const result = snapshot.docs.map(doc => doc.data());

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
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
        await db.collection('school').doc(String(sid)).update({ name, mascot, nameNick, confID });
        cacheDel('allSchools');
    }

    async updateSchoolConferenceHistory(sid, conferenceHistory) {
        Logger.debug('DB CALL: H.TeamRepository.updateSchoolConferenceHistory');
        await db.collection('school').doc(String(sid)).update({ conferenceHistory });
    }

    async updateSchoolEspn(sid, espn) {
        Logger.debug('DB CALL: H.TeamRepository.updateSchoolEspn');
        await db.collection('school').doc(String(sid)).update({ espn });
        cacheDel('allSchools');
    }

    async findSchoolsByName(name) {
        Logger.debug('DB CALL: H.TeamRepository.findSchoolsByName');
        const snapshot = await db.collection('school').get();
        const lowerName = name.toLowerCase();
        return snapshot.docs
            .map(doc => doc.data())
            .filter(data =>
                (data.name && data.name.toLowerCase().includes(lowerName)) ||
                (data.mascot && data.mascot.toLowerCase().includes(lowerName)) ||
                (data.nameNick && data.nameNick.toLowerCase().includes(lowerName))
            )
            .map(({ sid, name, mascot, nameNick, confID }) => ({ sid, name, mascot, nameNick, confID }));
    }

    async getMaxSchoolId() {
        Logger.debug('DB CALL: H.TeamRepository.getMaxSchoolId');
        const snapshot = await db.collection('school').orderBy('sid', 'desc').limit(1).get();
        if (snapshot.empty) return 0;
        return snapshot.docs[0].data().sid;
    }

    async insertSchool({ sid, name, mascot, nameNick, confID, conferenceHistory }) {
        Logger.debug('DB CALL: H.TeamRepository.insertSchool');
        // confID is a string slug; bootstrap conferenceHistory if not provided
        const history = conferenceHistory ?? (confID ? [{ confID, startYear: null, endYear: null }] : []);
        await db.collection('school').doc(String(sid)).set({ sid, name, mascot, nameNick, confID, conferenceHistory: history });
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
        const cacheKey = `allConferences`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        const snapshot = await db.collection('conferences').orderBy('name', 'asc').get();
        const result = snapshot.docs.map(doc => ({ slug: doc.id, ...doc.data() }));

        cacheSet(cacheKey, result, 86400); // 24 hours
        return result;
    }

    async getConferenceBySlug(slug) {
        Logger.debug('DB CALL: H.ConferenceRepository.getConferenceBySlug');
        const doc = await db.collection('conferences').doc(slug).get();
        return doc.exists ? { slug: doc.id, ...doc.data() } : null;
    }

    async insertConference({ slug, name, shortName, division, active }) {
        Logger.debug('DB CALL: H.ConferenceRepository.insertConference');
        await db.collection('conferences').doc(slug).set({ name, shortName, division: division || 'I', active: active ?? true });
        cacheDel('allConferences');
    }

    async updateConference(slug, { name, shortName, division, active }) {
        Logger.debug('DB CALL: H.ConferenceRepository.updateConference');
        await db.collection('conferences').doc(slug).update({ name, shortName, division, active });
        cacheDel('allConferences');
    }
}
