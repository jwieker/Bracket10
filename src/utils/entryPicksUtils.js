import { ValidationError } from './errors.js';

/**
 * Parses the 10 `teamSelect{i}` form fields ("sID, Team Name" shape) submitted
 * by the registration / edit forms into parallel arrays of pick IDs and names.
 * Pure request-shape parsing — no DB access, no tournament knowledge. Business
 * validation of the picks (count, uniqueness, team validity) lives in the
 * service layer (`normalizeAndValidateEntryPicks`).
 */
function extractPicks(body) {
  const picksIds = [];
  const picksNames = [];

  for (let i = 1; i <= 10; i++) {
    const key = `teamSelect${i}`;
    const raw = body[key];
    if (!raw) continue;
    if (typeof raw !== 'string') {
      throw new ValidationError(`Pick ${i} must be a string.`, key);
    }
    // The option value is `${schoolId}, ${schoolName}` and schoolId is always
    // numeric, so split on the FIRST ", " only. Splitting on every ", " (and
    // requiring exactly 2 parts) wrongly rejected a legitimate team name that
    // itself contains ", " as malformed.
    const sep = raw.indexOf(', ');
    // sep === -1: no separator at all. sep === 0: a leading ", " with no id
    // before it. Both are structurally malformed, so reject with the re-select
    // guidance rather than letting an empty idStr fall through to the
    // less-accurate "invalid team ID" message.
    if (sep <= 0) {
      throw new ValidationError(
        `Pick ${i} is malformed. Please re-select the team.`,
        key,
      );
    }
    const idStr = raw.slice(0, sep).trim();
    const name = raw.slice(sep + 2).trim();
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`Pick ${i} has an invalid team ID.`, key);
    }
    if (!name || name.length > 128) {
      throw new ValidationError(`Pick ${i} has an invalid team name.`, key);
    }
    picksIds.push(id);
    picksNames.push(name);
  }

  return { picksIds, picksNames };
}

export { extractPicks };
