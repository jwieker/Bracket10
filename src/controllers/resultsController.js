import {
  calculateMaxPossiblePoints,
  verifyGroupExists,
  getEntryIdsForUserInGroup,
  buildFullGridData,
  buildGameViewData,
} from '../services/index.js';
import { thisYear } from '../config/app.js';
import {
  controllerWrapper,
  validateRequest,
  successResponse,
  parseYear,
} from '../utils/controllerUtils.js';
import { toCSVRow } from '../utils/csvUtils.js';
import { ValidationError } from '../utils/errors.js';

const calculateMaxPoints = controllerWrapper(async (req, res) => {
  validateRequest(req, ['teamSIDs']);

  const { teamSIDs, year } = req.body;

  if (!Array.isArray(teamSIDs)) {
    throw new ValidationError('teamSIDs must be an array', 'teamSIDs');
  }

  const parsedYear = year ? parseYear(year) : undefined;
  const maxPoints = await calculateMaxPossiblePoints(teamSIDs, parsedYear);

  return successResponse(
    res,
    { maxPoints },
    'Maximum points calculated successfully',
  );
}, 'calculateMaxPoints');

const getFullGrid = controllerWrapper(async (req, res) => {
  const groupName = req.body['gameName'];
  const gameYear = req.body['gameYear'];

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(
    groupName,
    gameYear,
  );

  res.set('Cache-Control', 'private, max-age=300');
  res.render('fullGrid', {
    groupName,
    groupData: groupData,
    allTeams: allTeamsWithPickCounts,
    gameYear: gameYear,
  });
}, 'getFullGrid');

const getFullGridCSV = controllerWrapper(async (req, res) => {
  const groupName = req.query['gameName'];
  const gameYear = parseYear(req.query['gameYear']);

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(
    groupName,
    gameYear,
  );

  const teamHeaders = allTeamsWithPickCounts.map(
    (t) => `(${t.seed}) ${t.name}`,
  );
  const headers = [
    'Rank',
    'Entry',
    'Team',
    'Points',
    'Teams Remaining',
    'Advanced',
    'Best Rank',
    'Max Score',
    ...teamHeaders,
  ];

  const wlRow = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ...allTeamsWithPickCounts.map((t) =>
      t.gameStatus && t.gameStatus.length > 0 ? t.gameStatus.join(', ') : '',
    ),
  ];

  const rows = groupData.map((group) => {
    const pickIndexMap = new Map(group.pickNames.map((p, i) => [p.sID, i + 1]));
    const teamCells = allTeamsWithPickCounts.map(
      (team) => pickIndexMap.get(team.sID) ?? '',
    );
    return [
      group.rank,
      group.person,
      group.teamName,
      group.totalPoints,
      group.teamsRemaining,
      group.teamsAdvanced || 0,
      group.highestPlace,
      group.possPoints,
      ...teamCells,
    ];
  });

  const csv = [headers, wlRow, ...rows].map(toCSVRow).join('\r\n');
  const safeGroupName = groupName.replace(/[^a-zA-Z0-9\-_]/g, '_');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="fullgrid-${safeGroupName}-${gameYear}.csv"`,
  );
  res.send(csv);
}, 'getFullGridCSV');

const gameView = controllerWrapper(async (req, res) => {
  const groupNameInput = req.body['game'];
  const requestedYear = req.body['year']
    ? parseYear(req.body['year'])
    : thisYear;

  if (!groupNameInput) {
    return res.redirect('/?error=true');
  }

  const verifiedGroupName = await verifyGroupExists(groupNameInput);
  if (!verifiedGroupName) {
    return res.redirect('/?error=true');
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
    ? await getEntryIdsForUserInGroup(
        signedInEmail,
        verifiedGroupName,
        requestedYear,
      )
    : [];

  res.set('Cache-Control', 'private, max-age=300');
  res.render('results', {
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
}, 'gameView');

export { calculateMaxPoints, getFullGrid, getFullGridCSV, gameView };
