import { entryRepository, gameRepository } from '../repositories/index.js';
import { thisYear, APP_CONFIG } from '../config/app.js';
import Logger from '../utils/logger.js';

const EMAIL_GROUP = APP_CONFIG.tournament.emailGroup;

/**
 * Returns entries in the configured EMAIL_GROUP that haven't been emailed yet,
 * with picks enriched with team names.
 * An entry is considered "unsent" if its emailSent field is missing or false.
 */
export async function getUnsentEmailEntries(year = thisYear) {
  const [entries, teams] = await Promise.all([
    entryRepository.getUnsentEmailEntries(EMAIL_GROUP, year),
    // Reuses the repository's cached team read (300s TTL) instead of a
    // second, uncached schoolRecords scan — see AGENTS.md: only
    // src/repositories/* may touch Firestore directly.
    gameRepository.getTournamentTeams(year),
  ]);

  // Build sID → team name map from the tournament's teams
  const teamMap = new Map();
  teams.forEach((team) => {
    teamMap.set(team.sID, team.nameNick || team.name || `Team ${team.sID}`);
  });

  return entries.map((entry) => ({
    ...entry,
    pickNames: (entry.picks || []).map(
      (sID) => teamMap.get(sID) || `Team ${sID}`,
    ),
  }));
}

/**
 * Marks a list of entry IDs as emailSent: true.
 * Call this after drafts have been sent from Gmail.
 */
export async function markEmailsSent(entryIds, year = thisYear) {
  await entryRepository.markEmailsSent(entryIds, year);
  Logger.info(
    `Marked ${entryIds.length} entries as emailSent for year ${year}`,
  );
}
