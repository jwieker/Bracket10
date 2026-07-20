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
import { controllerWrapper, saveSession } from '../utils/controllerUtils.js';
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
  registrationData.teamData.forEach((team) => {
    const confID = schoolConfMap[team.sID];
    if (confID) {
      const confName = confMap[confID] || confID;
      team.conferenceName = confName;
      if (!conferenceStats[confName]) {
        conferenceStats[confName] = { total: 0, picked: 0 };
      }
      conferenceStats[confName].total++;
    }
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

  const data = await fetchRegistrationPageData(input);
  if (!data) {
    return res.redirect('/?createError=true');
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
    if (!data) return res.redirect('/?createError=true');
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

  if (!personName || !personName.trim())
    return reRenderWithError('Name is required.');
  if (!team || !team.trim()) return reRenderWithError('Team name is required.');
  if (!email || !email.trim()) return reRenderWithError('Email is required.');
  if (!groupName || !groupName.trim())
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
  if (!verifiedGroupName) return res.redirect('/?createError=true');

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
  req.session.pendingConfirmations[token] = {
    name: req.body['name'],
    team: req.body['team'],
    groupName: verifiedGroupName,
    picksNames,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  await saveSession(req);

  await createNewEntry(
    req.body['email'],
    req.body['team'],
    req.body['name'],
    verifiedGroupName,
    normalizedPicksIds,
    year,
    maxPoints,
  );

  res.redirect(`/entryConfirm?token=${token}`);
}, 'entryVerify');

const entryConfirm = controllerWrapper(async (req, res) => {
  const { token } = req.query;
  const payload = req.session.pendingConfirmations?.[token];
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
