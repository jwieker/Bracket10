import {
  getGroupRegistrationData,
  findEntriesByName,
  addNewGroup,
  verifyGroupExists,
  calculateMaxPossiblePoints,
  normalizeFirstFourPicks,
  getUnsentEmailEntries,
  markEmailsSent,
} from "../services/index.js";
import { APP_CONFIG, thisYear } from "../config/app.js";
import { gameRepository, entryRepository, viewRepository } from "../repositories/index.js";
import { controllerWrapper, validateRequest, successResponse, parseYearOrDefault } from "../utils/controllerUtils.js";
import { ValidationError } from "../utils/errors.js";
import { extractPicks } from "../utils/entryPicksUtils.js";

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

export {
  viewEntry,
  entryUpdate,
  findEntry,
  getUnpaidEntries,
  addGroup,
  getUnsentEmails,
  markEmailsSentController,
  deleteEntry,
};
