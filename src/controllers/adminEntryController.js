import {
  getGroupRegistrationData,
  findEntriesByName,
  addNewGroup,
  verifyGroupExists,
  calculateMaxPossiblePoints,
  normalizeFirstFourPicks,
  getUnsentEmailEntries,
  markEmailsSent,
  updatePointsForAffectedEntries,
} from '../services/index.js';
import { APP_CONFIG, thisYear } from '../config/app.js';
import {
  gameRepository,
  entryRepository,
  viewRepository,
} from '../repositories/index.js';
import {
  controllerWrapper,
  validateRequest,
  successResponse,
  parseYearOrDefault,
  validateEntryId,
} from '../utils/controllerUtils.js';
import { ValidationError } from '../utils/errors.js';
import { extractPicks } from '../utils/entryPicksUtils.js';

const viewEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.query;
  validateEntryId(entryId);

  const nameFound =
    APP_CONFIG.tournament.paymentCollectorGroup ||
    APP_CONFIG.tournament.defaultGroup;

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
    ...PRIORITY_GROUPS.filter((g) => allGroupsSet.has(g)),
    // Use safeAllGroups (not allGroups) so the null/undefined fallback above
    // actually applies here too, instead of only to allGroupsSet (#378).
    ...safeAllGroups.filter((g) => !priorityGroupsSet.has(g)),
  ];

  if (!entryData) {
    return res.status(404).json({ error: 'Entry not found' });
  }

  // Normalise: ensure entryData.groups is always an array
  if (!Array.isArray(entryData.groups)) {
    entryData.groups = entryData.group ? [entryData.group] : [];
  }

  // regions comes pre-computed inside registrationData
  const regions = registrationData.regions?.map((r) => r.regionName) ?? [];
  const fromAdmin = req.query.fromAdmin === 'true';

  res.render('editEntry', {
    teamData: registrationData.teamData,
    gameData: registrationData.gameData,
    name: nameFound,
    entryData,
    regions,
    year,
    availableGroups,
    fromAdmin,
  });
}, 'viewEntry');

const entryUpdate = controllerWrapper(async (req, res) => {
  validateEntryId(req.body['entryId']);
  const { picksIds, picksNames } = extractPicks(req.body);

  const year = parseYearOrDefault(req.body['year'], thisYear);

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

  // Fetched before the update below overwrites picks — needed to detect
  // whether picks actually changed (#430). Read after validation so a
  // rejected request doesn't pay for it.
  const previousEntry = await gameRepository.getEntryById(
    req.body['entryId'],
    year,
  );

  // groups[] comes as an array from multi-checkbox form, or a single string as fallback
  let groups = req.body['groups'];
  if (!groups) {
    groups = [];
  } else if (!Array.isArray(groups)) {
    groups = [groups];
  }

  // #159: recompute possPoints server-side rather than trusting the form value.
  const maxPoints = await calculateMaxPossiblePoints(normalizedPicksIds, year);

  const entryPayload = {
    id: req.body['entryId'],
    email: req.body['email'],
    year: req.body['year'],
    teamName: req.body['team'],
    person: req.body['name'],
    groups,
    picks: normalizedPicksIds,
    possPoints: maxPoints,
  };

  if (req.body['paymentSectionRendered'] === 'true') {
    entryPayload.hasPaid = req.body['hasPaid'] === 'on';
    entryPayload.paymentNote = req.body['paymentNote'] || '';
    entryPayload.payByCheck = req.body['payByCheck'] === 'on';
  }

  if (req.body['emailSectionRendered'] === 'true') {
    entryPayload.emailSent = req.body['emailSent'] === 'on';
  }

  await gameRepository.updateEntry(entryPayload);

  // #430: updateEntry only writes picks/possPoints, not totalPoints — without
  // this, a pick repair leaves totalPoints reflecting the OLD picks until one
  // of the NEW picks happens to play again (same staleness class #390 fixed
  // for restoreEntry). Skip when the pick set is unchanged to avoid a
  // needless recompute on every routine (non-picks) edit.
  const previousPicksSet = new Set(previousEntry?.picks || []);
  const picksChanged =
    previousPicksSet.size !== normalizedPicksIds.length ||
    normalizedPicksIds.some((sID) => !previousPicksSet.has(sID));
  if (picksChanged) {
    if (normalizedPicksIds.length > 0) {
      await updatePointsForAffectedEntries(year, normalizedPicksIds);
    } else {
      // A repair that clears every pick is unreachable by the targeted
      // recompute (getEntriesContainingTeams matches on picks, and an empty
      // sID list matches nothing), so the old totalPoints would survive the
      // repair and keep the entry mis-ranked. Zero it directly instead.
      await entryRepository.updateMultipleEntryPoints(
        [{ entryID: Number(req.body['entryId']), points: 0, possPoints: 0 }],
        year,
      );
    }
  }

  const collectorGroup = APP_CONFIG.tournament.paymentCollectorGroup;
  const isPaymentCollectorGroup =
    !!collectorGroup && groups.includes(collectorGroup);

  res.render('confirm', {
    name: req.body['name'],
    team: req.body['team'],
    groupName: groups.join(', '),
    picksNames,
    isPaymentCollectorGroup,
    paymentCollectorGroup: collectorGroup,
    paymentCollector: APP_CONFIG.payments,
  });
}, 'entryUpdate');

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

  const group =
    APP_CONFIG.tournament.paymentCollectorGroup ||
    APP_CONFIG.tournament.defaultGroup;
  const entries = await entryRepository.getUnpaidEntriesForGroup(group, year);
  res.json(entries);
}, 'getUnpaidEntries');

const addGroup = controllerWrapper(async (req, res) => {
  const { groupName } = req.body;

  if (!groupName || typeof groupName !== 'string' || groupName.trim() === '') {
    return res.status(400).json({ error: 'Invalid group name.' });
  }

  // Check if the group already exists
  const existingGroup = await verifyGroupExists(groupName);
  if (existingGroup) {
    return res.status(409).json({ error: 'Group already exists.' });
  }

  // Add the new group to the database
  await addNewGroup(groupName.trim());

  res.status(201).json({ message: 'Group added successfully.' });
}, 'addGroup');

const getUnsentEmails = controllerWrapper(async (req, res) => {
  const { year } = req.query;
  if (!year) throw new ValidationError('Year is required.');
  const entries = await getUnsentEmailEntries(Number(year));
  return successResponse(
    res,
    { entries, count: entries.length },
    `Found ${entries.length} unsent emails`,
  );
}, 'getUnsentEmails');

const markEmailsSentController = controllerWrapper(async (req, res) => {
  validateRequest(req, ['year', 'entryIds']);
  const { year, entryIds } = req.body;
  if (!Array.isArray(entryIds))
    throw new ValidationError('entryIds must be an array.');
  // Unlike the query/body-driven sites above, these ids are the numeric
  // Firestore `id` field round-tripped through a JSON POST (adminEntries.ejs),
  // so they arrive as Numbers, not strings — coerce before validating shape (#335).
  entryIds.forEach((id) => validateEntryId(String(id)));
  await markEmailsSent(entryIds, Number(year));
  return successResponse(
    res,
    { marked: entryIds.length },
    `Marked ${entryIds.length} entries as email sent.`,
  );
}, 'markEmailsSent');

// Soft-deletes an entry (stamps deletedAt) and redirects to /updatescores
const deleteEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.body;
  if (!entryId || !year) {
    return res.status(400).send('Missing entryId or year');
  }
  await entryRepository.deleteEntry(Number(entryId), Number(year));
  res.redirect('/updates');
}, 'deleteEntry');

// Undoes a soft delete. Used both from the single-entry admin editor (plain
// form post, redirects back to the entry) and the "Recently Deleted" list on
// /admin/entries (fetch with an Accept: application/json request).
const restoreEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.body;
  if (!entryId || !year) {
    return res.status(400).send('Missing entryId or year');
  }
  const numericEntryId = Number(entryId);
  const numericYear = Number(year);
  const wasRestored = await entryRepository.restoreEntry(
    numericEntryId,
    numericYear,
  );
  // #390: while soft-deleted, the entry was excluded from both the poll's
  // targeted recalc and the full recompute, so totalPoints/possPoints froze
  // at their pre-delete values. Recompute now via the same targeted path the
  // poll uses, or the restored entry keeps showing stale (and possibly
  // wrong-ranking) numbers indefinitely. Skip entirely if the entry was
  // already live (double-submit/concurrent restore) — nothing changed.
  if (wasRestored) {
    const restoredEntry = await gameRepository.getEntryById(
      numericEntryId,
      numericYear,
    );
    if (restoredEntry?.picks?.length) {
      await updatePointsForAffectedEntries(numericYear, restoredEntry.picks);
    }
  }
  if (req.is('json')) {
    return successResponse(
      res,
      { entryId: numericEntryId, year: numericYear },
      'Entry restored.',
    );
  }
  res.redirect(`/viewEntry?entryId=${entryId}&year=${year}&fromAdmin=true`);
}, 'restoreEntry');

// Permanently deletes an entry that has already been soft-deleted. The
// repository rejects this for an entry that's still "live" (no deletedAt),
// so this can't be used to bypass the soft-delete step.
const purgeEntry = controllerWrapper(async (req, res) => {
  const { entryId, year } = req.body;
  if (!entryId || !year) {
    return res.status(400).send('Missing entryId or year');
  }
  await entryRepository.purgeEntry(Number(entryId), Number(year));
  if (req.is('json')) {
    return successResponse(
      res,
      { entryId: Number(entryId), year: Number(year) },
      'Entry permanently deleted.',
    );
  }
  res.redirect('/admin/entries');
}, 'purgeEntry');

const getDeletedEntriesController = controllerWrapper(async (req, res) => {
  const { year } = req.query;
  if (!year) {
    throw new ValidationError('Year is a required parameter.');
  }
  const entries = await entryRepository.getDeletedEntries(Number(year));
  res.json(entries);
}, 'getDeletedEntriesController');

export {
  viewEntry,
  entryUpdate,
  findEntry,
  getUnpaidEntries,
  addGroup,
  getUnsentEmails,
  markEmailsSentController,
  deleteEntry,
  restoreEntry,
  purgeEntry,
  getDeletedEntriesController,
};
