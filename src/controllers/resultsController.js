import {
  calculateMaxPossiblePoints,
  verifyGroupExists,
  getEntryIdsForUserInGroup,
  buildFullGridData,
  buildGameViewData,
} from '../services/index.js';
import { APP_CONFIG, thisYear } from '../config/app.js';
import {
  controllerWrapper,
  homeErrorRedirect,
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

  // This is the only entry point into the points engine that takes a
  // caller-supplied pick list directly — every other path is bounded to
  // maxPicksPerEntry by normalizeAndValidateEntryPicks or extractPicks. Without
  // a cap here, one anonymous request can drive a synchronous per-pick bracket
  // walk (calculateEntryPointsAndPaths → getNextFutureGame → getFuturePoints)
  // over thousands of elements and block the event loop for every other request
  // on the instance; publicLimiter bounds the request rate, not the cost of one.
  // Both browser callers only fire at exactly 10 picks (public/js/registration.js,
  // public/js/editEntry.js), so the config cap rejects nothing legitimate.
  if (teamSIDs.length > APP_CONFIG.tournament.maxPicksPerEntry) {
    throw new ValidationError(
      `teamSIDs must contain at most ${APP_CONFIG.tournament.maxPicksPerEntry} entries`,
      'teamSIDs',
    );
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
  // Both callers (results.ejs, playground.ejs) always post gameName/gameYear, so
  // a missing one means a hand-rolled request. Validate here — as getPlayground
  // already does — instead of letting undefined params reach Firestore and
  // surface as a generic 500 (#479). parseYear covers both missing and
  // malformed years, and normalizes to a Number so the fullGridData_ cache key
  // stays identical to the one the repository invalidation paths build.
  if (!groupName) {
    throw new ValidationError('Group name is required', 'gameName');
  }
  const gameYear = parseYear(req.body['gameYear']);

  // Resolve to the stored group name before reading, the same way gameView
  // does (#515). verifyGroupExists is the canonicalizer here, not an access
  // check — group grids are public either way — so this is about not silently
  // rendering an empty grid for a case variant (`default` vs `Default`), and
  // about keeping callers on one `fullGridData_` cache key instead of minting
  // a separate entry per casing. findGroupByName caches for 24h, so this adds
  // no Firestore read on the common path.
  const verifiedGroupName = await verifyGroupExists(groupName);
  if (!verifiedGroupName) {
    throw new ValidationError('Group not found', 'gameName');
  }

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(
    verifiedGroupName,
    gameYear,
  );

  res.set('Cache-Control', 'private, max-age=300');
  res.render('fullGrid', {
    groupName: verifiedGroupName,
    groupData: groupData,
    allTeams: allTeamsWithPickCounts,
    gameYear: gameYear,
  });
}, 'getFullGrid');

const getFullGridCSV = controllerWrapper(async (req, res) => {
  const groupName = req.query['gameName'];
  // Same guard as getFullGrid: without it a missing gameName reaches the
  // `groupName.replace(...)` filename step below as undefined and 500s (#479).
  if (!groupName) {
    throw new ValidationError('Group name is required', 'gameName');
  }
  const gameYear = parseYear(req.query['gameYear']);

  // Canonicalize before reading — same reasoning as getFullGrid above (#515).
  const verifiedGroupName = await verifyGroupExists(groupName);
  if (!verifiedGroupName) {
    throw new ValidationError('Group not found', 'gameName');
  }

  const { groupData, allTeamsWithPickCounts } = await buildFullGridData(
    verifiedGroupName,
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
  // Sanitizer unchanged (it is a separate defense); it just runs on the
  // canonical name now, so the filename matches the data in the file.
  const safeGroupName = verifiedGroupName.replace(/[^a-zA-Z0-9\-_]/g, '_');
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
    return res.redirect(homeErrorRedirect('error=true'));
  }

  const verifiedGroupName = await verifyGroupExists(groupNameInput);
  if (!verifiedGroupName) {
    return res.redirect(homeErrorRedirect('error=true'));
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
