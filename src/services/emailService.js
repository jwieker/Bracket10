import { entryRepository } from '../repositories/index.js';
import { thisYear, APP_CONFIG } from '../config/app.js';
import { db } from '../config/firestore.js';
import Logger from '../utils/logger.js';

/** Returns the schoolRecords subcollection ref for a given year */
function schoolRecordsCol(year) {
    return db.collection('tournaments').doc(String(Number(year))).collection('schoolRecords');
}

const EMAIL_GROUP = APP_CONFIG.tournament.emailGroup;

/**
 * Returns entries in the configured EMAIL_GROUP that haven't been emailed yet,
 * with picks enriched with team names.
 * An entry is considered "unsent" if its emailSent field is missing or false.
 */
export async function getUnsentEmailEntries(year = thisYear) {
    const [entries, schoolRecordsSnap] = await Promise.all([
        entryRepository.getUnsentEmailEntries(EMAIL_GROUP, year),
        schoolRecordsCol(year).get(),
    ]);

    // Build sID → team name map from schoolRecords
    const teamMap = new Map();
    schoolRecordsSnap.docs.forEach(doc => {
        const d = doc.data();
        teamMap.set(d.sID, d.nameNick || d.schoolName || `Team ${d.sID}`);
    });

    return entries.map(entry => ({
        ...entry,
        pickNames: (entry.picks || []).map(sID => teamMap.get(sID) || `Team ${sID}`),
    }));
}

/**
 * Marks a list of entry IDs as emailSent: true.
 * Call this after drafts have been sent from Gmail.
 */
export async function markEmailsSent(entryIds, year = thisYear) {
    await entryRepository.markEmailsSent(entryIds, year);
    Logger.info(`Marked ${entryIds.length} entries as emailSent for year ${year}`);
}
