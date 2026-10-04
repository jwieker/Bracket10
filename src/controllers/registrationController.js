import { randomBytes } from 'node:crypto';
import {
  getGroupRegistrationData,
  verifyGroupExists,
  createNewEntry,
  calculateMaxPossiblePoints,
  normalizeAndValidateEntryPicks,
  resolveConfirmedPickNames,
} from '../services/index.js';
import { APP_CONFIG, thisYear, isRegistrationOpen } from '../config/app.js';
import { teamRepository, conferenceRepository } from '../repositories/index.js';
import {
  controllerWrapper,
  homeErrorRedirect,
  saveSession,
  validateEntryTextField,
  MAX_ENTRY_TEXT_LEN,
  MAX_EMAIL_LEN,
} from '../utils/controllerUtils.js';
import { ValidationError } from '../utils/errors.js';
import { extractPicks } from '../utils/entryPicksUtils.js';

async function fetchRegistrationPageData(groupName) {
  const verifiedGroupName = await verifyGroupExists(groupName);
  if (!verifiedGroupName) return null;

  const [registrationData, allSchools, allConferences] = await Promise.all([
    getGroupRegistrationData(verifiedGroupName),
    teamRepository.getAllSchools(),
    conferenceRepository.getAllConferences(),
  ]);

  const confMap = {};
  allConferences.forEach((conf) => {
    confMap[conf.slug] = conf.shortName || conf.name;
  });

  const schoolConfMap = {};
  allSchools.forEach((school) => {
    schoolConfMap[school.sid] = school.confID;
  });

  const conferenceStats = {};
  // teamData is `[...seenSIDs.values(), ...combinedFFOptions]`, and the
  // seenSIDs values are references into the 300s `tournamentDetails_` cache —
  // shared by reference with every other concurrent request, including the
  // results page, which reads `conferenceName` off these same objects to build
  // its conferenceStats. Stamping the name on directly (the previous `team.
  // conferenceName = confName`) wrote per-request derived state onto shared
  // documents; copy before deriving instead, per addPickCount's invariant.
  //
  // The write itself is kept rather than dropped: conferenceName is already
  // denormalized onto school records, so it is redundant for ordinary teams —
  // but the combined First Four options are built by hand in
  // getGroupRegistrationData without one, so the registration page's
  // conference filter still depends on this line for those.
  registrationData.teamData = registrationData.teamData.map((team) => {
    const confID = schoolConfMap[team.sID];
    if (!confID) return team;

    const confName = confMap[confID] || confID;
    if (!conferenceStats[confName]) {
      conferenceStats[confName] = { total: 0, picked: 0 };
    }
    conferenceStats[confName].total++;
    return { ...team, conferenceName: confName };
  });

  return { verifiedGroupName, registrationData, conferenceStats };
}

const groupVerifyfornewEntry = controllerWrapper(async (req, res) => {
  // Unlike the self-service edit routes, this create path had no window check,
  // so a scripted POST could reach the registration page (and, via entryVerify
  // below, actually create an entry) after tourneyStartDate when entries are
  // meant to be locked (#334).
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const input = req.body['game'];
  // This was the one of the four group-name entry points with no guard at all,
  // so an omitted or repeated `game` field went straight into the repository
  // (#589). findGroupByName now rejects both, but check here too so the
  // rejection is this route's own decision rather than a side effect of
  // repository behaviour. Redirect rather than throw ValidationError: this is a
  // browser form POST, and controllerWrapper answers a ValidationError with a
  // JSON 400 body — the same wrong-content-type failure #549 fixed.
  if (!input || typeof input !== 'string' || !input.trim()) {
    return res.redirect(homeErrorRedirect('createError=true'));
  }

  const data = await fetchRegistrationPageData(input);
  if (!data) {
    return res.redirect(homeErrorRedirect('createError=true'));
  }

  res.render('registration', {
    teamData: data.registrationData.teamData,
    gameData: data.registrationData.gameData,
    name: data.verifiedGroupName,
    regions: data.registrationData.regions.map((r) => r.regionName),
    year: thisYear,
    conferenceStats: data.conferenceStats,
  });
}, 'groupVerifyfornewEntry');

const entryVerify = controllerWrapper(async (req, res) => {
  // Same window guard as groupVerifyfornewEntry above — this is the actual
  // create/write step, so closing only the upstream form page wasn't enough;
  // an attacker who already has form values can POST straight here (#334).
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const { name: personName, team, email, groupName } = req.body;

  const reRenderWithError = async (errorMessage) => {
    const data = await fetchRegistrationPageData(groupName);
    if (!data) return res.redirect(homeErrorRedirect('createError=true'));
    return res.render('registration', {
      teamData: data.registrationData.teamData,
      gameData: data.registrationData.gameData,
      name: data.verifiedGroupName,
      regions: data.registrationData.regions.map((r) => r.regionName),
      year: thisYear,
      conferenceStats: data.conferenceStats,
      errorMessage,
      formValues: {
        name: personName || '',
        team: team || '',
        email: email || '',
      },
    });
  };

  // Same rule as the self-service update path (#548 triage): type-check before
  // trimming, and cap the two publicly-rendered fields. The previous
  // `!x || !x.trim()` guards were a truthiness check standing in for a type
  // check — a repeated form key parses to a truthy *array* under
  // express.urlencoded({ extended: true }), so `.trim` threw a TypeError and
  // the branch whose whole job is "tell the user this field is wrong" answered
  // with a 500 JSON body instead (#549).
  //
  // Caught and re-rendered rather than allowed to throw: reRenderWithError is
  // this route's established shape (the user is looking at a form, not a fetch
  // response), matching how the extractPicks failure below is handled.
  let validName, validTeam, validEmail;
  try {
    validName = validateEntryTextField(personName, 'Name', MAX_ENTRY_TEXT_LEN);
    validTeam = validateEntryTextField(team, 'Team name', MAX_ENTRY_TEXT_LEN);
    validEmail = validateEntryTextField(email, 'Email', MAX_EMAIL_LEN);
  } catch (error) {
    if (error instanceof ValidationError) {
      return reRenderWithError(error.message);
    }
    throw error;
  }

  if (!groupName || typeof groupName !== 'string' || !groupName.trim())
    throw new ValidationError('Group name is required.');

  // #429: nothing downstream checks the group actually exists — pick
  // validation resolves against the tournament-wide team set, not the group,
  // so a nonexistent or case-variant groupName (e.g. "buddies" vs "Buddies")
  // otherwise passes straight through to a persisted entry that's invisible
  // to its group (every group read is byte-exact). Resolve to the canonical
  // name now so casing can't drift between what's validated and what's saved.
  //
  // Redirect directly rather than routing through reRenderWithError: that
  // helper rebuilds the registration page via fetchRegistrationPageData(groupName),
  // which re-resolves this same (already-invalid) groupName and always gets
  // null back too — so any errorMessage passed through it here would never
  // actually reach the user, just silently fall through to the generic
  // redirect anyway. Doing the redirect here directly says what actually
  // happens instead of routing through a call that can't do anything else.
  const verifiedGroupName = await verifyGroupExists(groupName);
  if (!verifiedGroupName)
    return res.redirect(homeErrorRedirect('createError=true'));

  let picksIds, picksNames;
  try {
    ({ picksIds, picksNames } = extractPicks(req.body));
  } catch (error) {
    if (error instanceof ValidationError) {
      return reRenderWithError(error.message);
    }
    throw error;
  }

  // #391: unlike the admin/self-service routes, this is an unauthenticated
  // create path — trusting req.body.year let anyone forge an entry into an
  // archived tournament while registration for the *current* year is open.
  // New entries only ever make sense for thisYear, so don't accept a year
  // from the client at all.
  const year = thisYear;

  // Normalize FF picks, enforce 10 unique picks, and validate team membership
  // in the service layer. Any rule violation surfaces as a ValidationError,
  // which we render back onto the registration page.
  let normalizedPicksIds;
  try {
    normalizedPicksIds = await normalizeAndValidateEntryPicks(
      picksIds,
      year,
      verifiedGroupName,
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return reRenderWithError(error.message);
    }
    throw error;
  }

  // #375: if normalization swapped a First Four pick's sID (stale form,
  // cached team list), show the persisted pick's name on the confirmation
  // page rather than echoing the submitted one.
  picksNames = await resolveConfirmedPickNames(
    picksIds,
    normalizedPicksIds,
    picksNames,
    year,
    verifiedGroupName,
  );

  // #159: never trust the client-supplied maxPoints. Recompute server-side from
  // the validated, normalized picks so a participant can't inflate their stored
  // possPoints (which drives the "Max" display, the standings sort key, and the
  // tournament-over check).
  const maxPoints = await calculateMaxPossiblePoints(normalizedPicksIds, year);

  // C7: stage the confirmation token + save the session BEFORE the DB write.
  // Order matters: a session.save() failure after createNewEntry leaves the
  // entry persisted in Firestore but the user gets a 500 with no token, and
  // a retry creates a duplicate. The pending payload is just an in-memory
  // TTL-bound nonce, so it's safe to write first; if the DB insert then fails
  // the user sees the error and the stale token expires in 10 minutes.
  const token = randomBytes(16).toString('hex');
  if (!req.session.pendingConfirmations) req.session.pendingConfirmations = {};

  // #592: expiry was written and checked but never enforced — entryConfirm only
  // deletes a token on a *successful* confirmation, so every abandoned
  // registration stranded ~200-300 bytes in the session document forever. The
  // session lives in Firestore and FirestoreStore.set() rewrites the whole doc
  // on every save, so dead payloads are re-serialized on every later request,
  // and enough of them walk the doc into the 1 MiB cap and make the session
  // unwritable. Sweep here rather than on a timer: this request is already
  // saving the session, so the sweep is free — the same lazy-sweep-on-write
  // shape as pruneExpired (cacheUtils.js) and sweepExpiredClients (rateLimit.js).
  // A payload with no expiresAt is swept too: it can only be a malformed or
  // pre-#511 leftover, and it would never expire on its own.
  const nowMs = Date.now();
  for (const [staleToken, payload] of Object.entries(
    req.session.pendingConfirmations,
  )) {
    if (!payload?.expiresAt || payload.expiresAt < nowMs) {
      delete req.session.pendingConfirmations[staleToken];
    }
  }

  req.session.pendingConfirmations[token] = {
    name: validName,
    team: validTeam,
    groupName: verifiedGroupName,
    picksNames,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  await saveSession(req);

  // Persist the validated (trimmed) values rather than re-reading req.body, so
  // what's stored is what was checked — and so create and update agree on the
  // stored shape now that applyEntryUpdate writes trimmed values too.
  await createNewEntry(
    validEmail,
    validTeam,
    validName,
    verifiedGroupName,
    normalizedPicksIds,
    year,
    maxPoints,
  );

  res.redirect(`/entryConfirm?token=${token}`);
}, 'entryVerify');

// Confirmation tokens are minted as randomBytes(16).toString('hex') above, so a
// real one is always 32 hex chars. Both halves of this guard are load-bearing
// (#511): the token is used as a raw object key, so `?token=__proto__` used to
// resolve to Object.prototype — truthy, with an `undefined` expiresAt that also
// slipped past `< Date.now()` — and the request fell through to render with an
// empty payload, 500ing in confirm.ejs instead of returning the intended 404.
const CONFIRM_TOKEN_RE = /^[0-9a-f]{32}$/;

const entryConfirm = controllerWrapper(async (req, res) => {
  const { token } = req.query;
  const pending = req.session.pendingConfirmations;
  const payload =
    typeof token === 'string' &&
    CONFIRM_TOKEN_RE.test(token) &&
    Object.prototype.hasOwnProperty.call(pending ?? {}, token)
      ? pending[token]
      : null;
  if (!payload || payload.expiresAt < Date.now()) {
    return res.status(404).render('confirmExpired');
  }
  delete req.session.pendingConfirmations[token];
  const collectorGroup = APP_CONFIG.tournament.paymentCollectorGroup;
  const isPaymentCollectorGroup =
    !!collectorGroup && payload.groupName === collectorGroup;
  res.render('confirm', {
    ...payload,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}, 'entryConfirm');

export { groupVerifyfornewEntry, entryVerify, entryConfirm };
