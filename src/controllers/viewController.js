import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  getGroupTeamDetails,
  addTeamProgressforGroup,
  verifyGroupExists,
  getGroupRegistrationData,
  createNewEntry,
  addPickCount,
  calculateMaxPossiblePoints,
  getAllYearsforGroup,
  getEntriesForUser,
  getEntryIdsForUserInGroup,
  findEntriesByName,
  addNewGroup,
  normalizeFirstFourPicks,
  buildFullGridData,
  buildGameViewData,
  getUnsentEmailEntries,
  markEmailsSent,
} from "../services/index.js";
import { APP_CONFIG, thisYear, isRegistrationOpen } from "../config/app.js";
import { gameRepository, teamRepository, entryRepository, viewRepository, conferenceRepository } from "../repositories/index.js";
import { controllerWrapper, validateRequest, successResponse, errorResponse, parseYear, parseYearOrDefault, saveSession, regenerateSession } from "../utils/controllerUtils.js";
import { toCSVRow } from "../utils/csvUtils.js";
import { ValidationError } from "../utils/errors.js";
import { registerFailedAttempt } from "../middleware/rateLimit.js";

// Brute-force guard for /my-entry/verify. Counted per entryId (so it holds even
// when an attacker rotates IPs to defeat the per-IP publicLimiter), but only on
// FAILED verifications — a correct email never consumes the bucket, so an
// attacker can't lock the legitimate owner out with garbage attempts (#161).
// Tightened to 5 failures / 15 min as the interim hardening for the
// email-as-password weakness (#166) while the emailed one-time-link ("magic
// link") replacement remains pending email-delivery infrastructure.
const VERIFY_FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const VERIFY_FAIL_MAX = 5;

// Constant-time, case-insensitive email equality. Both inputs are normalized
// (trim + lowercase, matching how emails are canonicalized on write) and hashed
// to fixed-length SHA-256 digests before comparison, so the check leaks neither
// the inputs' length nor the position of the first differing byte via timing.
// Used on the /my-entry/verify path so the endpoint can't be turned into a
// timing oracle while email remains the (interim) ownership factor (#166).
function emailsMatchConstantTime(a, b) {
  const normalize = (v) => String(v ?? '').trim().toLowerCase();
  const da = createHash('sha256').update(normalize(a)).digest();
  const db = createHash('sha256').update(normalize(b)).digest();
  return timingSafeEqual(da, db);
}



const calculateMaxPoints = controllerWrapper(async (req, res) => {
  validateRequest(req, ['teamSIDs']);

  const { teamSIDs, year } = req.body;

  if (!Array.isArray(teamSIDs)) {
    throw new ValidationError('teamSIDs must be an array', 'teamSIDs');
  }

  const parsedYear = year ? parseYear(year) : undefined;
  const maxPoints = await calculateMaxPossiblePoints(teamSIDs, parsedYear);

  return successResponse(res, { maxPoints }, 'Maximum points calculated successfully');
}, 'calculateMaxPoints');

const getFullGrid = controllerWrapper(async (req, res) => {
  const groupName = req.body["gameName"];
  const gameYear = req.body["gameYear"];

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(
    groupName,
    gameYear
  );

  res.set('Cache-Control', 'private, max-age=300');
  res.render("fullGrid", {
    groupName,
    groupData: groupData,
    allTeams: allTeamsWithPickCounts,
    gameYear: gameYear,
  });
}, "getFullGrid");

const getFullGridCSV = controllerWrapper(async (req, res) => {
  const groupName = req.query["gameName"];
  const gameYear = parseYear(req.query["gameYear"]);

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(groupName, gameYear);

  const teamHeaders = allTeamsWithPickCounts.map((t) => `(${t.seed}) ${t.name}`);
  const headers = ["Rank", "Entry", "Team", "Points", "Teams Remaining", "Advanced", "Best Rank", "Max Score", ...teamHeaders];

  const wlRow = ["", "", "", "", "", "", "", "", ...allTeamsWithPickCounts.map((t) =>
    t.gameStatus && t.gameStatus.length > 0 ? t.gameStatus.join(", ") : ""
  )];

  const rows = groupData.map((group) => {
    const pickIndexMap = new Map(group.pickNames.map((p, i) => [p.sID, i + 1]));
    const teamCells = allTeamsWithPickCounts.map((team) => pickIndexMap.get(team.sID) ?? "");
    return [group.rank, group.person, group.teamName, group.totalPoints, group.teamsRemaining, group.teamsAdvanced || 0, group.highestPlace, group.possPoints, ...teamCells];
  });

  const csv = [headers, wlRow, ...rows].map(toCSVRow).join("\r\n");
  const safeGroupName = groupName.replace(/[^a-zA-Z0-9\-_]/g, "_");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="fullgrid-${safeGroupName}-${gameYear}.csv"`);
  res.send(csv);
}, "getFullGridCSV");

const gameView = controllerWrapper(async (req, res) => {
  const groupNameInput = req.body["game"];
  const requestedYear = req.body["year"] ? parseYear(req.body["year"]) : thisYear;

  if (!groupNameInput) {
    return res.redirect("/?error=true");
  }

  const verifiedGroupName = await verifyGroupExists(groupNameInput);
  if (!verifiedGroupName) {
    return res.redirect("/?error=true");
  }

  const {
    groupData,
    enrichedActiveGames,
    allTeamsRaw,
    allYears,
    regionNames,
    conferenceStats,
  } = await buildGameViewData(verifiedGroupName, requestedYear);

  // When someone is signed in, highlight their own entries on this public page.
  // Match the participant email (userEmail) or, if they're in the admin console
  // instead, their admin email. Matching happens on the server; only entry IDs
  // reach the view, so no email is ever exposed here. buildGameViewData stays
  // cached and user-agnostic — the per-user data is this separate ID list.
  const signedInEmail = req.session?.userEmail || req.session?.adminEmail;
  const myEntryIds = signedInEmail
    ? await getEntryIdsForUserInGroup(signedInEmail, verifiedGroupName, requestedYear)
    : [];

  res.set('Cache-Control', 'private, max-age=300');
  res.render("results", {
    name: verifiedGroupName,
    groupData,
    gameData: enrichedActiveGames,
    teamData: allTeamsRaw,
    currentYear: requestedYear,
    availableYears: allYears,
    regions: regionNames,
    requestedYear: requestedYear,
    conferenceStats: conferenceStats,
    myEntryIds,
  });
}, "gameView");

async function fetchRegistrationPageData(groupName) {
  const verifiedGroupName = await verifyGroupExists(groupName);
  if (!verifiedGroupName) return null;

  const [registrationData, allSchools, allConferences] = await Promise.all([
    getGroupRegistrationData(verifiedGroupName),
    teamRepository.getAllSchools(),
    conferenceRepository.getAllConferences(),
  ]);

  const confMap = {};
  allConferences.forEach(conf => {
    confMap[conf.slug] = conf.shortName || conf.name;
  });

  const schoolConfMap = {};
  allSchools.forEach(school => {
    schoolConfMap[school.sid] = school.confID;
  });

  const conferenceStats = {};
  registrationData.teamData.forEach(team => {
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
  const input = req.body["game"];

  const data = await fetchRegistrationPageData(input);
  if (!data) {
    return res.redirect("/?createError=true");
  }

  res.render("registration", {
    teamData: data.registrationData.teamData,
    gameData: data.registrationData.gameData,
    name: data.verifiedGroupName,
    regions: data.registrationData.regions.map((r) => r.regionName),
    year: thisYear,
    conferenceStats: data.conferenceStats,
  });
}, "groupVerifyfornewEntry");

const entryVerify = controllerWrapper(async (req, res) => {
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
      formValues: { name: personName || '', team: team || '', email: email || '' },
    });
  };

  if (!personName || !personName.trim()) return reRenderWithError('Name is required.');
  if (!team || !team.trim()) return reRenderWithError('Team name is required.');
  if (!email || !email.trim()) return reRenderWithError('Email is required.');
  if (!groupName || !groupName.trim()) throw new ValidationError('Group name is required.');


  let picksIds, picksNames;
  try {
    ({ picksIds, picksNames } = extractPicks(req.body));
  } catch (error) {
    if (error instanceof ValidationError) {
      return reRenderWithError(error.message);
    }
    throw error;
  }

  const year = parseYearOrDefault(req.body["year"], thisYear);

  // Map First Four picks to live game state (combined → team1ID, resolved →
  // winner) BEFORE the uniqueness check: a submission carrying both FF teams
  // of one game normalizes to the same sID and is correctly rejected as a
  // duplicate below.
  const normalizedPicksIds = await normalizeFirstFourPicks(picksIds, year);

  if (normalizedPicksIds.length !== 10) return reRenderWithError('Exactly 10 team picks are required.');

  const uniqueIds = new Set(normalizedPicksIds);
  if (uniqueIds.size !== 10) return reRenderWithError('Duplicate team picks are not allowed.');

  try {
    await validateEntryPicks(normalizedPicksIds, year, groupName);
  } catch (error) {
    if (error instanceof ValidationError) {
      return reRenderWithError(error.message);
    }
    throw error;
  }

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
    name: req.body["name"],
    team: req.body["team"],
    groupName: req.body["groupName"],
    picksNames,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  await saveSession(req);

  await createNewEntry(
    req.body["email"],
    req.body["team"],
    req.body["name"],
    req.body["groupName"],
    normalizedPicksIds,
    year,
    maxPoints
  );

  res.redirect(`/entryConfirm?token=${token}`);
}, "entryVerify");

const entryConfirm = controllerWrapper(async (req, res) => {
  const { token } = req.query;
  const payload = req.session.pendingConfirmations?.[token];
  if (!payload || payload.expiresAt < Date.now()) {
    return res.status(404).render('confirmExpired');
  }
  delete req.session.pendingConfirmations[token];
  const collectorGroup = APP_CONFIG.tournament.paymentCollectorGroup;
  const isPaymentCollectorGroup = !!collectorGroup && payload.groupName === collectorGroup;
  res.render("confirm", {
    ...payload,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}, 'entryConfirm');


const viewEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.query;

  const nameFound = APP_CONFIG.tournament.paymentCollectorGroup || APP_CONFIG.tournament.defaultGroup;

  const PRIORITY_GROUPS = APP_CONFIG.tournament.priorityGroups;
  const [entryData, registrationData, allGroups] = await Promise.all([
    gameRepository.getEntryById(entryId, year),
    getGroupRegistrationData(nameFound, Number(year)),
    viewRepository.getAllGroups(),
  ]);

  const safeAllGroups = allGroups || [];

  const allGroupsSet = new Set(safeAllGroups);
  const priorityGroupsSet = new Set(PRIORITY_GROUPS);

  const availableGroups = [
    ...PRIORITY_GROUPS.filter(g => allGroupsSet.has(g)),
    ...allGroups.filter(g => !priorityGroupsSet.has(g)),
  ];

  if (!entryData) {
    return res.status(404).json({ error: "Entry not found" });
  }

  // Normalise: ensure entryData.groups is always an array
  if (!Array.isArray(entryData.groups)) {
    entryData.groups = entryData.group ? [entryData.group] : [];
  }

  // regions comes pre-computed inside registrationData
  const regions = registrationData.regions?.map((r) => r.regionName) ?? [];
  const fromAdmin = req.query.fromAdmin === 'true';

  res.render("editEntry", {
    teamData: registrationData.teamData,
    gameData: registrationData.gameData,
    name: nameFound,
    entryData,
    regions,
    year,
    availableGroups,
    fromAdmin,
  });
}, "viewEntry");

const entryUpdate = controllerWrapper(async (req, res) => {
  const { picksIds, picksNames } = extractPicks(req.body);

  const year = parseYearOrDefault(req.body["year"], thisYear);

  // Admin edits skip the strict count check (deliberately, to allow repairing
  // unusual entries) but still normalize FF picks so an admin can't strand an
  // entry on an eliminated First Four team.
  const normalizedPicksIds = await normalizeFirstFourPicks(picksIds, year);

  // Duplicate picks are never a valid repair: they double-count cumulative
  // points and fabricate phantom "guaranteed" clashes in minPoints (#157).
  // Reject them while still permitting a non-10 pick count for admin fixes.
  if (new Set(normalizedPicksIds).size !== normalizedPicksIds.length) {
    throw new ValidationError('Duplicate team picks are not allowed.');
  }

  // groups[] comes as an array from multi-checkbox form, or a single string as fallback
  let groups = req.body["groups"];
  if (!groups) {
    groups = [];
  } else if (!Array.isArray(groups)) {
    groups = [groups];
  }

  // #159: recompute possPoints server-side rather than trusting the form value.
  const maxPoints = await calculateMaxPossiblePoints(normalizedPicksIds, year);

  const entryPayload = {
    id: req.body["entryId"],
    email: req.body["email"],
    year: req.body["year"],
    teamName: req.body["team"],
    person: req.body["name"],
    groups,
    picks: normalizedPicksIds,
    possPoints: maxPoints,
  };

  if (req.body["paymentSectionRendered"] === 'true') {
    entryPayload.hasPaid = req.body["hasPaid"] === 'on';
    entryPayload.paymentNote = req.body["paymentNote"] || '';
    entryPayload.payByCheck = req.body["payByCheck"] === 'on';
  }

  if (req.body["emailSectionRendered"] === 'true') {
    entryPayload.emailSent = req.body["emailSent"] === 'on';
  }

  await gameRepository.updateEntry(entryPayload);

  const collectorGroup = APP_CONFIG.tournament.paymentCollectorGroup;
  const isPaymentCollectorGroup = !!collectorGroup && groups.includes(collectorGroup);

  res.render("confirm", {
    name: req.body["name"],
    team: req.body["team"],
    groupName: groups.join(", "),
    picksNames,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}, "entryUpdate");

const findEntry = controllerWrapper(async (req, res) => {
  const { year, name } = req.query;

  if (!year || !name) {
    throw new ValidationError('Year and name are required parameters.');
  }

  const entries = await findEntriesByName(name, year);
  res.json(entries);
}, 'findEntry');

const getUnpaidEntries = controllerWrapper(async (req, res) => {
  const { year } = req.query;

  if (!year) {
    throw new ValidationError('Year is a required parameter.');
  }

  const group = APP_CONFIG.tournament.paymentCollectorGroup || APP_CONFIG.tournament.defaultGroup;
  const entries = await entryRepository.getUnpaidEntriesForGroup(group, year);
  res.json(entries);
}, 'getUnpaidEntries');

const addGroup = controllerWrapper(async (req, res) => {
  const { groupName } = req.body;

  if (
    !groupName ||
    typeof groupName !== "string" ||
    groupName.trim() === ""
  ) {
    return res.status(400).json({ error: "Invalid group name." });
  }

  // Check if the group already exists
  const existingGroup = await verifyGroupExists(groupName);
  if (existingGroup) {
    return res.status(409).json({ error: "Group already exists." });
  }

  // Add the new group to the database
  await addNewGroup(groupName.trim());

  res.status(201).json({ message: "Group added successfully." });
}, "addGroup");

// GET /viewTeam
const viewTeam = controllerWrapper(async (req, res) => {
  const { teamId } = req.query;
  if (!teamId) {
    return res.status(400).send("Missing teamId");
  }
  const [team, conferences] = await Promise.all([
    teamRepository.getSchoolById(Number(teamId)),
    conferenceRepository.getAllConferences(),
  ]);

  if (!team) {
    return res.status(404).send("School not found");
  }

  res.render("editTeam", { team, isNew: false, conferences });
}, "viewTeam");

// POST /updateTeam
const updateTeam = controllerWrapper(async (req, res) => {
  const { sid, name, mascot, nameNick, confID } = req.body;
  if (!sid || !name) {
    return res.status(400).send("Missing required fields");
  }

  // Parse conferenceHistory rows submitted from form:
  // confHistory[0][confID], confHistory[0][startYear], confHistory[0][endYear], ...
  const historyRaw = req.body.confHistory;
  let conferenceHistory;
  if (historyRaw && Array.isArray(historyRaw)) {
    conferenceHistory = historyRaw
      .filter(row => row.confID && row.confID.trim() !== '')
      .map(row => ({
        confID: row.confID.trim(),
        startYear: row.startYear ? Number(row.startYear) : null,
        endYear: row.endYear ? Number(row.endYear) : null,
      }));
  }

  // Parse ESPN fields from espn[field] form inputs (parsed as req.body.espn by body-parser)
  const espnRaw = req.body.espn;
  let espn;
  if (espnRaw && typeof espnRaw === 'object') {
    espn = {
      espnID: espnRaw.espnID ? Number(espnRaw.espnID) : null,
      espnSlug: espnRaw.espnSlug?.trim() || null,
      espnAbbreviation: espnRaw.espnAbbreviation?.trim() || null,
      espnShortName: espnRaw.espnShortName?.trim() || null,
      primaryColor: espnRaw.primaryColor?.trim() || null,
      alternateColor: espnRaw.alternateColor?.trim() || null,
      logoURL: espnRaw.logoURL?.trim() || null,
    };
  }

  await teamRepository.updateSchool({ sid: Number(sid), name, mascot, nameNick, confID });
  if (conferenceHistory) {
    await teamRepository.updateSchoolConferenceHistory(Number(sid), conferenceHistory);
  }
  if (espn) {
    await teamRepository.updateSchoolEspn(Number(sid), espn);
  }

  res.redirect(`/viewTeam?teamId=${sid}`);
}, "updateTeam");

// Add this controller for finding teams by name
const findTeam = controllerWrapper(async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }
  const teams = await teamRepository.findSchoolsByName(name);
  res.json(teams);
}, "findTeam");

const addTeamPage = controllerWrapper(async (req, res) => {
  const conferences = await conferenceRepository.getAllConferences();
  res.render("editTeam", {
    team: { sid: "", name: "", mascot: "", nameNick: "", confID: "", conferenceHistory: [] },
    isNew: true,
    conferences,
  });
}, "addTeamPage");

const addTeam = controllerWrapper(async (req, res) => {
  const { name, mascot, nameNick, confID } = req.body;
  if (!name) {
    return res.status(400).send("School name is required");
  }
  const maxSid = await teamRepository.getMaxSchoolId();
  const newSid = (maxSid || 0) + 1;
  await teamRepository.insertSchool({
    sid: newSid,
    name,
    mascot,
    nameNick,
    confID: confID || null,
  });
  res.redirect(`/viewTeam?teamId=${newSid}`);
}, "addTeam");

// JSON-returning version for AJAX use (e.g. inline add on newTourneyGames page)
const addTeamApi = controllerWrapper(async (req, res) => {
  const { name, mascot, nameNick, confID } = req.body;
  if (!name) {
    return res.status(400).json({ error: "School name is required" });
  }
  const maxSid = await teamRepository.getMaxSchoolId();
  const newSid = (maxSid || 0) + 1;
  await teamRepository.insertSchool({
    sid: newSid,
    name,
    mascot,
    nameNick,
    confID: confID || null,
  });
  res.status(201).json({ sid: newSid, name, mascot, nameNick, confID: confID || null });
}, "addTeamApi");

// Add this controller for deleting a team and redirecting to /updates
const deleteTeam = controllerWrapper(async (req, res) => {
  const { sid } = req.body;
  if (!sid) {
    return res.status(400).send("Missing team id");
  }
  await teamRepository.deleteSchool(Number(sid));
  res.redirect("/updates");
}, "deleteTeam");

const myEntryLookup = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }
  const { error, entryId = null, year = null } = req.query;
  res.render('myEntryLookup', { currentYear: thisYear, error: error || null, entryId, year });
}, 'myEntryLookup');

const myEntryVerify = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const { entryId, year, email } = req.body;

  if (!entryId || !year || !email) {
    throw new ValidationError('Entry ID, year, and email are required.');
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
  // endpoint is not an existence oracle (#166).
  const emailComparison = emailsMatchConstantTime(entryData?.email, email);
  const emailMatches = emailComparison && !!entryData?.email;

  if (!emailMatches) {
    // Count this failure toward the per-entryId window; block once exhausted.
    const blocked = await registerFailedAttempt(
      `verify:${entryId}`,
      VERIFY_FAIL_WINDOW_MS,
      VERIFY_FAIL_MAX
    );
    if (blocked) {
      // Keep the 429 + Retry-After semantics, but render the styled lookup page
      // (like the other verify branches) instead of plain text for consistency.
      res.set('Retry-After', String(Math.ceil(VERIFY_FAIL_WINDOW_MS / 1000)));
      return res.status(429).render('myEntryLookup', {
        currentYear: thisYear,
        error: 'ratelimited',
        entryId,
        year,
      });
    }
    const params = new URLSearchParams({ entryId, year, error: 'invalid' });
    return res.redirect(`/my-entry?${params}`);
  }

  await regenerateSession(req);
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

  const lookupGroup = APP_CONFIG.tournament.paymentCollectorGroup || APP_CONFIG.tournament.defaultGroup;
  const registrationData = await getGroupRegistrationData(lookupGroup, Number(year));
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
  const { picksIds, picksNames } = extractPicks(req.body);

  // Map First Four picks to live game state before the uniqueness check
  // (two FF teams of the same game normalize to one sID → duplicate error).
  const normalizedPicksIds = await normalizeFirstFourPicks(picksIds, year);

  if (normalizedPicksIds.length !== 10) {
    throw new ValidationError('Exactly 10 team picks are required.');
  }
  if (new Set(normalizedPicksIds).size !== 10) {
    throw new ValidationError('Duplicate team picks are not allowed.');
  }

  const storedGroups = Array.isArray(storedEntry.groups)
    ? storedEntry.groups
    : [storedEntry.group].filter(Boolean);

  await validateEntryPicks(normalizedPicksIds, year, storedGroups[0] || APP_CONFIG.tournament.defaultGroup);

  // #159: recompute possPoints server-side from the validated picks; the
  // participant-submitted maxPoints is never persisted.
  const maxPoints = await calculateMaxPossiblePoints(normalizedPicksIds, year);

  const entryPayload = {
    id: storedEntry.id,
    email: storedEntry.email,
    year,
    teamName: req.body['team'],
    person: req.body['name'],
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
  const isPaymentCollectorGroup = !!collectorGroup && entryPayload.groups.includes(collectorGroup);

  res.render('confirm', {
    name: entryPayload.person,
    team: entryPayload.teamName,
    groupName: entryPayload.groups.join(', '),
    picksNames,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}

const myEntryView = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const { entryId, year } = req.query;

  if (!entryId || !year) {
    throw new ValidationError('Entry ID and year are required.');
  }

  if (!req.session?.verifiedEntries?.[`${year}:${entryId}`]) {
    const params = new URLSearchParams({ entryId, year });
    return res.redirect(`/my-entry?${params}`);
  }

  const entryData = await gameRepository.getEntryById(entryId, year);

  if (!entryData) {
    return res.redirect(`/my-entry?error=notfound`);
  }

  await renderEntryEditor(res, entryData, year, '/my-entry/update');
}, 'myEntryView');

const myEntryUpdate = controllerWrapper(async (req, res) => {
  if (!isRegistrationOpen()) {
    return res.status(403).render('myEntryClosed');
  }

  const entryId = req.body['entryId'];
  const year = req.body['year'];
  const sessionKey = `${year}:${entryId}`;

  if (!req.session?.verifiedEntries?.[sessionKey]) {
    return res.redirect(`/my-entry`);
  }

  const storedEntry = await gameRepository.getEntryById(entryId, year);
  if (!storedEntry) {
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

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  const entryData = await gameRepository.getEntryById(entryId, year);
  if (!entryData) {
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

  if (!canEditYear(year)) {
    return res.status(403).render('myEntryClosed');
  }

  const storedEntry = await gameRepository.getEntryById(entryId, year);
  if (!storedEntry) {
    return res.redirect('/my-brackets');
  }

  // Re-verify ownership against the stored email — never trust the posted form.
  if (!ownsEntry(req, storedEntry)) {
    return res.status(403).render('myEntryClosed');
  }

  await applyEntryUpdate(req, res, storedEntry, year);
}, 'userEntryUpdate');

const getUnsentEmails = controllerWrapper(async (req, res) => {
  const { year } = req.query;
  if (!year) throw new ValidationError('Year is required.');
  const entries = await getUnsentEmailEntries(Number(year));
  return successResponse(res, { entries, count: entries.length }, `Found ${entries.length} unsent emails`);
}, 'getUnsentEmails');

const markEmailsSentController = controllerWrapper(async (req, res) => {
  validateRequest(req, ['year', 'entryIds']);
  const { year, entryIds } = req.body;
  if (!Array.isArray(entryIds)) throw new ValidationError('entryIds must be an array.');
  await markEmailsSent(entryIds, Number(year));
  return successResponse(res, { marked: entryIds.length }, `Marked ${entryIds.length} entries as email sent.`);
}, 'markEmailsSent');

// Add this controller for deleting an entry and redirecting to /updatescores
const deleteEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.body;
  if (!entryId || !year) {
    return res.status(400).send("Missing entryId or year");
  }
  await entryRepository.deleteEntry(Number(entryId), Number(year));
  res.redirect("/updates");
}, "deleteEntry");

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
    const parts = raw.split(", ").map((s) => s.trim());
    if (parts.length !== 2) {
      throw new ValidationError(`Pick ${i} is malformed. Please re-select the team.`, key);
    }
    const [idStr, name] = parts;
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

async function validateEntryPicks(picksIds, year, groupName) {
  const registrationData = await getGroupRegistrationData(groupName, year);
  if (!registrationData || !registrationData.teamData) {
    throw new ValidationError("Invalid tournament or group.");
  }
  const validSIDs = new Set(registrationData.teamData.map(t => t.sID));
  for (let i = 0; i < picksIds.length; i++) {
    const pickId = picksIds[i];
    if (!validSIDs.has(pickId)) {
      throw new ValidationError(`Pick ${i + 1} is not a valid team in this tournament.`);
    }
  }
}

export {
  calculateMaxPoints,
  getFullGrid,
  getFullGridCSV,
  gameView,
  groupVerifyfornewEntry,
  entryVerify,
  entryConfirm,
  viewEntry,
  entryUpdate,
  findEntry,
  addGroup,
  viewTeam,
  updateTeam,
  findTeam,
  addTeamPage,
  addTeam,
  addTeamApi,
  deleteTeam,
  deleteEntry,
  myEntryLookup,
  myEntryVerify,
  myEntryView,
  myEntryUpdate,
  myBrackets,
  userEntryView,
  userEntryUpdate,
  getUnpaidEntries,
  getUnsentEmails,
  markEmailsSentController,
};
