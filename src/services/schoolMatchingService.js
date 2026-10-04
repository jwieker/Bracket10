const TBD_NAMES = new Set(['tbd', 'tba', '']);

function isPlaceholder(displayName) {
  return !displayName || TBD_NAMES.has(displayName.trim().toLowerCase());
}

/**
 * @typedef {Object} MatchedTeam
 * @property {string|null} espnId
 * @property {string|null} displayName
 * @property {number|null} seed
 * @property {number|null} sID - resolved internal school id, or null
 * @property {'espnId'|'nameMap'|'placeholder'|'unresolved'|'conflict'} matchMethod
 */

/**
 * Resolves a normalized ESPN team (from fetchNormalizedTournamentEvents) to
 * an internal school sID. Pure — takes already-fetched reference data, so it
 * needs no repository/module mocking to test. Priority: a unique
 * `school.espn.espnID` match, then an exact `espnTeamMap.json` name match. A
 * TBD/blank name is a play-in destination placeholder, never "unresolved". A
 * disagreement between the two match methods — or an espnID claimed by more
 * than one school — is a conflict requiring admin review, not a silent pick.
 * @param {{espnId: string|null, displayName: string|null, seed: number|null}} team
 * @param {Array<{sid: number, espn?: {espnID?: number|null}}>} allSchools
 * @param {Object<string, number>} teamMap - espnTeamMap.json (displayName -> sID)
 * @returns {MatchedTeam}
 */
export function matchTeam(team, allSchools, teamMap) {
  if (isPlaceholder(team?.displayName)) {
    return { ...team, sID: null, matchMethod: 'placeholder' };
  }

  const numericEspnId =
    team.espnId != null && team.espnId !== '' ? Number(team.espnId) : null;
  const espnIdMatches = numericEspnId
    ? allSchools.filter((s) => s.espn?.espnID === numericEspnId)
    : [];

  const nameMapSid = teamMap?.[team.displayName] ?? null;
  const nameMapSidExists =
    nameMapSid != null && allSchools.some((s) => s.sid === nameMapSid);

  if (espnIdMatches.length > 1) {
    return { ...team, sID: null, matchMethod: 'conflict' };
  }

  if (espnIdMatches.length === 1) {
    const sid = espnIdMatches[0].sid;
    if (nameMapSidExists && nameMapSid !== sid) {
      return { ...team, sID: null, matchMethod: 'conflict' };
    }
    return { ...team, sID: sid, matchMethod: 'espnId' };
  }

  if (nameMapSidExists) {
    return { ...team, sID: nameMapSid, matchMethod: 'nameMap' };
  }

  return { ...team, sID: null, matchMethod: 'unresolved' };
}

/**
 * Matches every team1/team2 (and winner, when present) across a set of
 * normalized events, and collects diagnostics for anything an admin needs to
 * resolve. Fetching `allSchools` and `teamMap` is the caller's job (e.g. via
 * `teamRepository.getAllSchools()` and `loadTeamMap()`) — this function does
 * no I/O so it stays testable without mocking the repository.
 * @param {Array} normalizedEvents - the `events` array from
 *   `fetchNormalizedTournamentEvents`
 * @param {Array} allSchools
 * @param {Object} teamMap
 * @returns {{events: Array, diagnostics: Array<{espnEventId: string, reason: string}>}}
 */
export function matchSchoolsForEvents(normalizedEvents, allSchools, teamMap) {
  const diagnostics = [];

  const events = normalizedEvents.map((event) => {
    const team1 = matchTeam(event.team1, allSchools, teamMap);
    const team2 = matchTeam(event.team2, allSchools, teamMap);
    const winner = event.winner
      ? matchTeam(event.winner, allSchools, teamMap)
      : null;

    for (const [label, team] of [
      ['team1', team1],
      ['team2', team2],
    ]) {
      if (team.matchMethod === 'unresolved') {
        diagnostics.push({
          espnEventId: event.espnEventId,
          reason: `${label} "${team.displayName}" did not match an existing school by ESPN id or name map`,
        });
      }
      if (team.matchMethod === 'conflict') {
        diagnostics.push({
          espnEventId: event.espnEventId,
          reason: `${label} "${team.displayName}" has conflicting school matches and needs admin review`,
        });
      }
    }

    return { ...event, team1, team2, winner };
  });

  return { events, diagnostics };
}
