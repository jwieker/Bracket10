import { createHash, timingSafeEqual } from 'node:crypto';
import {
  getGroupRegistrationData,
  getEntriesForUser,
  calculateMaxPossiblePoints,
  normalizeAndValidateEntryPicks,
  resolveConfirmedPickNames,
} from '../services/index.js';
import { APP_CONFIG, thisYear, isRegistrationOpen } from '../config/app.js';
import { gameRepository } from '../repositories/index.js';
import {
  controllerWrapper,
  saveSession,
  regenerateSession,
  validateEntryId,
  validateEntryTextField,
  MAX_ENTRY_TEXT_LEN,
} from '../utils/controllerUtils.js';
import { ValidationError } from '../utils/errors.js';
import { reserveVerificationAttempt } from '../middleware/rateLimit.js';
import { extractPicks } from '../utils/entryPicksUtils.js';

// Reserve every attempt globally before reading credentials, including successes.
// Five attempts per entry per 15 minutes bounds guessing across IPs and instances.
// Exhaustion requires waiting for expiry or using Google sign-in instead.
const VERIFY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const VERIFY_MAX = 5;

// Constant-time, case-insensitive email equality. Both inputs are normalized
// (trim + lowercase, matching how emails are canonicalized on write) and hashed
// to fixed-length SHA-256 digests before comparison, so the check leaks neither
// the inputs' length nor the position of the first differing byte via timing.
// Used on the /my-entry/verify path so the endpoint can't be turned into a
// timing oracle while email remains the (interim) ownership factor (#166).
function emailsMatchConstantTime(a, b) {
  const normalize = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase();
  const da = createHash('sha256').update(normalize(a)).digest();
  const db = createHash('sha256').update(normalize(b)).digest();
  return timingSafeEqual(da, db);
}

const myEntryLookup = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }
  const { error, entryId = null, year = null } = req.query;
  res.render('myEntryLookup', {
    currentYear: thisYear,
    error: error || null,
    entryId,
    year,
  });
}, 'myEntryLookup');

const myEntryVerify = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const { entryId, year, email } = req.body;

  if (!entryId || !year || !email) {
    throw new ValidationError('Entry ID, year, and email are required.');
  }
  validateEntryId(entryId);

  const blocked = await reserveVerificationAttempt({
    key: `verify:${entryId}`,
    windowMs: VERIFY_WINDOW_MS,
    max: VERIFY_MAX,
  });
  if (blocked) {
    // Keep the 429 + Retry-After semantics, but render the styled lookup page
    // (like the other verify branches) instead of plain text for consistency.
    res.set('Retry-After', String(Math.ceil(VERIFY_WINDOW_MS / 1000)));
    return res.status(429).render('myEntryLookup', {
      currentYear: thisYear,
      error: 'ratelimited',
      entryId,
      year,
    });
  }

  const entryData = await gameRepository.getEntryById(entryId, year);
  // Constant-time comparison. Run the hash compare unconditionally (it normalizes
  // a missing stored email to '') so the not-found and email-mismatch paths do
  // identical work — no per-branch timing asymmetry. The `&& !!entryData?.email`
  // guard is required for correctness: emailsMatchConstantTime normalizes both
  // sides with trim+lowercase, so a whitespace-only submitted email (which passes
  // the non-empty check above but normalizes to '') would otherwise "match" an
  // entry whose stored email is empty/null. Requiring a non-empty *stored* email
  // closes that, and — because the short-circuit depends only on stored state,
  // not on attacker input — both failure branches stay byte-identical, so the
  // endpoint is not an existence oracle (#166). A soft-deleted entry (deletedAt
  // set) is treated the same as a stored-email mismatch, so a deleted entry
  // can't be verified back into edit access.
  const emailComparison = emailsMatchConstantTime(entryData?.email, email);
  const emailMatches =
    emailComparison && !!entryData?.email && !entryData?.deletedAt;

  if (!emailMatches) {
    const params = new URLSearchParams({ entryId, year, error: 'invalid' });
    return res.redirect(`/my-entry?${params}`);
  }

  // Preserve coexisting logins across session regeneration. The route's origin
  // guard rejects cross-site submissions without minting anonymous CSRF tokens.
  const existingSiteAdmin = req.session.siteAdmin;
  const existingAdminEmail = req.session.adminEmail;
  const existingUserEmail = req.session.userEmail;
  const existingCsrfToken = req.session.csrfToken;
  const existingMaxAge = req.session.cookie?.maxAge;

  await regenerateSession(req);

  if (existingSiteAdmin) {
    req.session.siteAdmin = existingSiteAdmin;
    req.session.adminEmail = existingAdminEmail;
  }
  if (existingUserEmail) req.session.userEmail = existingUserEmail;
  if (existingSiteAdmin || existingUserEmail) {
    // Keep the prior CSRF token so a form the victim already had open still
    // validates — rotating it would turn the forced logout into a forced
    // "invalid CSRF token" on their next submit, which is the same denial in a
    // different costume.
    if (existingCsrfToken) req.session.csrfToken = existingCsrfToken;
    // Restore the exact prior lifetime rather than letting the new session take
    // the 8h default, which would silently truncate a remember-me admin (30d)
    // or a signed-in participant (2 weeks). Restoring a snapshot can only
    // preserve, never extend, so #426's "participant coexistence must never
    // lengthen an admin session" still holds.
    if (existingMaxAge && req.session.cookie) {
      req.session.cookie.maxAge = existingMaxAge;
    }
  }

  if (!req.session.verifiedEntries) req.session.verifiedEntries = {};
  req.session.verifiedEntries[`${year}:${entryId}`] = true;
  await saveSession(req);

  const params = new URLSearchParams({ entryId, year });
  res.redirect(`/my-entry/edit?${params}`);
}, 'myEntryVerify');

// ─── Shared self-service edit helpers ─────────────────────────────
// Both the Entry-ID+email flow (/my-entry) and the Google-authenticated flow
// (/my-brackets) render the same editor and run the same update; only the
// authorization differs. These helpers hold the shared rendering/write logic so
// the two flows stay in lockstep.

/** Renders the bracket editor for an already-authorized entry. */
async function renderEntryEditor(res, entryData, year, updateAction) {
  if (!Array.isArray(entryData.groups)) {
    entryData.groups = entryData.group ? [entryData.group] : [];
  }

  const lookupGroup =
    APP_CONFIG.tournament.paymentCollectorGroup ||
    APP_CONFIG.tournament.defaultGroup;
  const registrationData = await getGroupRegistrationData(
    lookupGroup,
    Number(year),
  );
  const regions = registrationData.regions?.map((r) => r.regionName) ?? [];

  res.render('myEditEntry', {
    entryData,
    teamData: registrationData.teamData,
    gameData: registrationData.gameData,
    regions,
    year,
    updateAction,
  });
}

/** Parses the submitted picks for an already-authorized entry, persists the
 *  update (preserving stored groups/payment fields), and renders confirmation. */
async function applyEntryUpdate(req, res, storedEntry, year) {
  // Validate the two free-text fields FIRST, ahead of pick parsing and the
  // service calls below. #548's sketch put this just before the payload is
  // built, but by then normalizeAndValidateEntryPicks, resolveConfirmedPickNames
  // and calculateMaxPossiblePoints have all run and burned their Firestore reads
  // on a request that was always going to be rejected — and the $0 cost contract
  // is the reason to spend the check here instead.
  const teamName = validateEntryTextField(
    req.body['team'],
    'Team name',
    MAX_ENTRY_TEXT_LEN,
  );
  const person = validateEntryTextField(
    req.body['name'],
    'Name',
    MAX_ENTRY_TEXT_LEN,
  );

  const { picksIds, picksNames } = extractPicks(req.body);

  const storedGroups = Array.isArray(storedEntry.groups)
    ? storedEntry.groups
    : [storedEntry.group].filter(Boolean);

  const validationGroup = storedGroups[0] || APP_CONFIG.tournament.defaultGroup;

  // Normalize FF picks, enforce 10 unique picks, and validate team membership
  // against the stored entry's group (service layer; throws ValidationError).
  const normalizedPicksIds = await normalizeAndValidateEntryPicks(
    picksIds,
    year,
    validationGroup,
  );

  // #375: normalization may have swapped a First Four pick's sID; the
  // confirmation page must show the name of the pick actually persisted,
  // not the one submitted from a possibly-stale form.
  const confirmedPicksNames = await resolveConfirmedPickNames(
    picksIds,
    normalizedPicksIds,
    picksNames,
    year,
    validationGroup,
  );

  // #159: recompute possPoints server-side from the validated picks; the
  // participant-submitted maxPoints is never persisted.
  const maxPoints = await calculateMaxPossiblePoints(normalizedPicksIds, year);

  const entryPayload = {
    id: storedEntry.id,
    email: storedEntry.email,
    year,
    teamName,
    person,
    groups: storedGroups,
    hasPaid: storedEntry.hasPaid,
    paymentNote: storedEntry.paymentNote,
    payByCheck: storedEntry.payByCheck,
    emailSent: storedEntry.emailSent,
    picks: normalizedPicksIds,
    possPoints: maxPoints,
  };

  await gameRepository.updateEntry(entryPayload);

  const collectorGroup = APP_CONFIG.tournament.paymentCollectorGroup;
  const isPaymentCollectorGroup =
    !!collectorGroup && entryPayload.groups.includes(collectorGroup);

  res.render('confirm', {
    name: entryPayload.person,
    team: entryPayload.teamName,
    groupName: entryPayload.groups.join(', '),
    picksNames: confirmedPicksNames,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}

const myEntryView = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.query;

  if (!entryId || !year) {
    throw new ValidationError('Entry ID and year are required.');
  }
  validateEntryId(entryId);

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  if (!req.session?.verifiedEntries?.[`${year}:${entryId}`]) {
    const params = new URLSearchParams({ entryId, year });
    return res.redirect(`/my-entry?${params}`);
  }

  const entryData = await gameRepository.getEntryById(entryId, year);

  if (!entryData || entryData.deletedAt) {
    return res.redirect(`/my-entry?error=notfound`);
  }

  await renderEntryEditor(res, entryData, year, '/my-entry/update');
}, 'myEntryView');

const myEntryUpdate = controllerWrapper(async (req, res) => {
  const entryId = req.body['entryId'];
  const year = req.body['year'];
  validateEntryId(entryId);

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  const sessionKey = `${year}:${entryId}`;

  if (!req.session?.verifiedEntries?.[sessionKey]) {
    return res.redirect(`/my-entry`);
  }

  const storedEntry = await gameRepository.getEntryById(entryId, year);
  if (!storedEntry || storedEntry.deletedAt) {
    return res.redirect('/my-entry?error=notfound');
  }

  await applyEntryUpdate(req, res, storedEntry, year);
}, 'myEntryUpdate');

// ─── Google-authenticated "My Brackets" flow ──────────────────────

/** Dashboard: every entry matching the signed-in Google email, across years. */
const myBrackets = controllerWrapper(async (req, res) => {
  const userEmail = req.session.userEmail; // guaranteed by requireUser
  const entries = await getEntriesForUser(userEmail);
  res.render('myBrackets', {
    userEmail,
    entries,
    editWindowOpen: isRegistrationOpen(),
    thisYear,
  });
}, 'myBrackets');

/** True when the stored entry belongs to the signed-in user (case-insensitive). */
function ownsEntry(req, entry) {
  const sessionEmail = req.session?.userEmail?.toLowerCase();
  return !!sessionEmail && entry?.email?.toLowerCase() === sessionEmail;
}

/** Editing is allowed only for the current tournament year, within the window. */
function canEditYear(year) {
  return isRegistrationOpen() && Number(year) === thisYear;
}

const userEntryView = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.query;
  if (!entryId || !year) {
    throw new ValidationError('Entry ID and year are required.');
  }
  validateEntryId(entryId);

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  const entryData = await gameRepository.getEntryById(entryId, year);
  if (!entryData || entryData.deletedAt) {
    return res.redirect('/my-brackets');
  }

  // Authorize by email ownership (replaces the verifiedEntries token).
  if (!ownsEntry(req, entryData)) {
    return res.status(403).render('myEntryClosed');
  }

  await renderEntryEditor(res, entryData, year, '/my-brackets/update');
}, 'userEntryView');

const userEntryUpdate = controllerWrapper(async (req, res) => {
  const entryId = req.body['entryId'];
  const year = req.body['year'];
  validateEntryId(entryId);

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  const storedEntry = await gameRepository.getEntryById(entryId, year);
  if (!storedEntry || storedEntry.deletedAt) {
    return res.redirect('/my-brackets');
  }

  // Re-verify ownership against the stored email — never trust the posted form.
  if (!ownsEntry(req, storedEntry)) {
    return res.status(403).render('myEntryClosed');
  }

  await applyEntryUpdate(req, res, storedEntry, year);
}, 'userEntryUpdate');

export {
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
};
