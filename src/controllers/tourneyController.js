import {
  prepareRegionVerifyData,
  prepareNewTournamentData,
  createNewBracket,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
  buildEspnBracketPlan,
} from '../services/index.js';
import {
  fetchScheduledTournamentGames,
  loadTeamMap,
} from '../services/espnService.js';
import { gameRepository, tourneyRepository } from '../repositories/index.js';
import {
  controllerWrapper,
  parseYear,
  parseYearOrDefault,
  parsePositiveInt,
} from '../utils/controllerUtils.js';
import { ValidationError } from '../utils/errors.js';

const regionVerify = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const regions = [0, 1, 2, 3].map((i) => Number(req.body[`region${i}`]));
  const data = await prepareRegionVerifyData(regions, year);
  res.render('newTourneyGames', { year, ...data });
}, 'regionVerify');

const gamesVerify = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  // gamesVerify is the create flow's second step and the one remaining door
  // into createNewBracket, so it needs the same guard createTournament applies
  // to the identical list below: createNewBracketStructure fans out a fixed
  // block of future games per entry, so a short list writes an
  // incomplete bracket, a duplicated one writes a quadrant twice and another
  // never, and a non-numeric entry writes that quadrant's games under regionID
  // NaN — each with a 200, and NaN then fails every comparison used to find
  // the rows again. The admin form (newTourneyGames.ejs:66) posts the four
  // regionIDs regionVerify rendered, but a client-side form is not on this
  // path for a stale, replayed, or direct request.
  //
  // Reject rather than coerce: there is no correct default for "which quadrant
  // did they mean". Deliberately stricter than tournamentUpdate's
  // filter-then-count: the edit view legitimately posts the Final
  // Four/Championship pseudo-regions 5 and 6, the create flow never does —
  // createNewBracketStructure appends those itself (tourneyService.js:188,
  // :340-348). Do not merge the two into one helper; either behavior applied
  // to the other path breaks it.
  const regionData = String(req.body.region).split(',').map(Number);
  if (
    regionData.length !== 4 ||
    new Set(regionData).size !== 4 ||
    regionData.some((id) => !Number.isInteger(id) || id < 1 || id > 4)
  ) {
    // Echo only the coerced numbers, never the raw body.
    throw new ValidationError(
      `gamesVerify expected exactly 4 distinct bracket-quadrant regionIDs (1-4), got [${regionData}]`,
      'region',
    );
  }
  const gamesData = req.body.games;
  // createNewBracketStructure reads gamesData.length and indexes it
  // (tourneyService.js:265-281), so a missing or non-array field is a
  // TypeError that controllerWrapper turns into a generic 500 telling the
  // admin nothing. The real form posts one "games" value per R1 slot, which
  // urlencoded parses as an array.
  if (!Array.isArray(gamesData)) {
    throw new ValidationError(
      'gamesVerify expected a games array with one entry per R1 team slot',
      'games',
    );
  }
  await createNewBracket(gamesData, year, regionData);
  res.status(200).json({ message: 'New Bracket Created Successfully' });
}, 'gamesVerify');

const viewTournament = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);

  const { allGames: existingGames, regions: regionObjects } =
    await gameRepository.getAllTournamentDetails(year);
  const regionIDs = regionObjects.map((r) => r.regionID);

  const data = await prepareRegionVerifyData(regionIDs, year);
  res.render('editTourneyGames', {
    year,
    ...data,
    existingGames,
  });
}, 'viewTournament');

const tournamentUpdate = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  // The edit flow's form (editTourneyGames.ejs) posts a single comma-joined
  // "region" field — the same shape the create flow's second step
  // (gamesVerify) parses — not the region0..region3 fields that only the
  // create flow's first step (regionVerify) reads from its own form. The
  // edit view's list also carries the Final Four/Championship pseudo-regions
  // (5, 6), which updateBracket must not receive — it expects only the 4
  // bracket quadrants and appends 5/6 itself.
  const regionData = String(req.body.region)
    .split(',')
    .map(Number)
    .filter((id) => id >= 1 && id <= 4);
  // A partial or duplicated quadrant list would let updateBracket write an
  // incomplete bracket while still returning 200 — the same silent-corruption
  // class as the region0..region3 bug this guard accompanies.
  if (regionData.length !== 4 || new Set(regionData).size !== 4) {
    throw new ValidationError(
      `tournamentUpdate expected exactly 4 distinct bracket-quadrant regionIDs, got [${regionData}] from region="${req.body.region}"`,
      'region',
    );
  }
  const gamesData = req.body.games;
  // Same check gamesVerify applies above, for the same TypeError-to-500 reason.
  // This path does not corrupt without it — updateBracket's school-change
  // balance check (tourneyService.js) rejects a non-array first, because
  // teamRecordFormat comes back empty and reads as "0 additions vs N removals".
  // So this is status-code and field-name correctness, not a write guard; it
  // is here so the boundary states its own contract rather than depending on a
  // distant guard that exists for an unrelated reason.
  if (!Array.isArray(gamesData)) {
    throw new ValidationError(
      'tournamentUpdate expected a games array with one entry per R1 team slot',
      'games',
    );
  }
  const schoolChanges = await updateBracket(gamesData, year, regionData);
  await updateEntrywithNewSchools(schoolChanges, year);
  res.status(200).json({ message: 'Tournament updated successfully' });
}, 'tournamentUpdate');

const deleteTournamentHandler = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  await deleteTournament(year);
  res
    .status(200)
    .json({ message: `Tournament for ${year} deleted successfully` });
}, 'deleteTournament');

const setupNewTourney = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const data = await prepareNewTournamentData();
  res.render('newTourneyComplete', { year, ...data });
}, 'setupNewTourney');

const createTournament = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  // Same guard tournamentUpdate applies to the identical region list, and this
  // path needs it more: creating writes the whole bracket where editing changes
  // one game. createNewBracketStructure fans out a fixed block of future games
  // per entry, so a short list writes an incomplete bracket, a duplicated one
  // writes a quadrant twice and another never, and a non-numeric entry writes
  // that quadrant's games under regionID NaN — each with a 200, and NaN then
  // fails every comparison used to find the rows again. The admin form does
  // check all four selects, but a client check is not on this path for a stale,
  // replayed, or direct request. Reject rather than coerce: there is no correct
  // default for "which quadrant did they mean", and a half-specified bracket
  // should not create a tournament at all (same call as the First Four fields).
  const regions = Array.isArray(req.body.regions)
    ? req.body.regions.map(Number)
    : [];
  if (
    regions.length !== 4 ||
    new Set(regions).size !== 4 ||
    regions.some((id) => !Number.isInteger(id) || id < 1 || id > 4)
  ) {
    // Echo only the coerced numbers, never the raw body.
    throw new ValidationError(
      `createTournament expected exactly 4 distinct bracket-quadrant regionIDs (1-4), got [${regions}]`,
      'regions',
    );
  }
  const gamesData = req.body.games;
  // Unlike the two handlers above, this one corrupts without the check. A
  // string passes every downstream guard: createNewBracketStructure tests
  // gamesData.length % 2 and then calls gamesData[i].split('-'), and a string
  // has both, so an even-length value ("abcd") is never rejected. Its R1 loop
  // then destructures single characters into rows with regionID/gameID/seed
  // NaN and both team ids null, which puts every row in gamesWithoutTeams —
  // and createNewBracket writes unconditionally. That is a whole tournament of
  // NaN rows at HTTP 200, permanent because NaN fails every comparison later
  // used to find them. This route takes a JSON body, so that shape is directly
  // expressible. Checked ahead of the First Four parsing so the request fails
  // before any of that work, matching the regions guard above.
  if (!Array.isArray(gamesData)) {
    throw new ValidationError(
      'createTournament expected a games array with one entry per R1 team slot',
      'games',
    );
  }

  const includeFirstFour = req.body.includeFirstFour === true;
  let firstFourData = null;
  if (includeFirstFour) {
    const ffCount = parsePositiveInt(
      req.body.firstFourCount,
      'firstFourCount',
      { defaultValue: 4, max: 8 },
    );
    firstFourData = [];
    // Validate every per-game field rather than coercing with bare Number().
    // Firestore accepts NaN as a valid double, so an unvalidated field from a
    // partial or stale form persists a First Four game with a NaN team id —
    // silently, and then permanently, because NaN fails every comparison used
    // to find the row again (the poll's min-id key, the points lookup map).
    // Failing the whole request is correct: a half-specified First Four should
    // not create a tournament at all.
    for (let i = 0; i < ffCount; i++) {
      firstFourData.push({
        team1ID: parsePositiveInt(req.body[`ff_team1_${i}`], `ff_team1_${i}`),
        team2ID: parsePositiveInt(req.body[`ff_team2_${i}`], `ff_team2_${i}`),
        seed: parsePositiveInt(req.body[`ff_seed_${i}`], `ff_seed_${i}`, {
          max: 16,
        }),
        nextGameID: parsePositiveInt(
          req.body[`ff_nextGame_${i}`],
          `ff_nextGame_${i}`,
        ),
        nextGameSpot: parsePositiveInt(
          req.body[`ff_nextGameSpot_${i}`],
          `ff_nextGameSpot_${i}`,
          { max: 2 },
        ),
      });
    }
  }

  await createNewBracket(gamesData, year, regions, firstFourData);
  res.status(200).json({ message: 'Tournament created successfully' });
}, 'createTournament');

const pollEspnScheduled = controllerWrapper(async (req, res) => {
  const { date1, date2 } = req.body;
  const teamMap = loadTeamMap();

  const [games1, games2] = await Promise.all([
    date1 ? fetchScheduledTournamentGames(date1) : Promise.resolve([]),
    date2 ? fetchScheduledTournamentGames(date2) : Promise.resolve([]),
  ]);

  const allGames = Array.from(
    new Map([...games1, ...games2].map((g) => [g.espnEventId, g])).values(),
  );

  const resolved = allGames.map((g) => ({
    ...g,
    team1SID: teamMap[g.team1DisplayName] ?? null,
    team2SID: teamMap[g.team2DisplayName] ?? null,
  }));

  res.json({ games: resolved });
}, 'pollEspnScheduled');

const DEFAULT_REGION_ORDER = [1, 2, 3, 4];
const DATE_STR_RE = /^\d{8}$/;
const MAX_DATES_PER_FIELD = 8;

function parseDateList(raw, fieldName) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError(
      `${fieldName} must be a non-empty array of YYYYMMDD dates`,
      fieldName,
    );
  }
  if (raw.length > MAX_DATES_PER_FIELD) {
    throw new ValidationError(
      `${fieldName} must not list more than ${MAX_DATES_PER_FIELD} dates`,
      fieldName,
    );
  }
  for (const d of raw) {
    if (typeof d !== 'string' || !DATE_STR_RE.test(d)) {
      throw new ValidationError(
        `${fieldName} entries must be YYYYMMDD date strings`,
        fieldName,
      );
    }
  }
  return raw;
}

function parseRegionOrder(raw) {
  if (raw === undefined) return DEFAULT_REGION_ORDER;
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw new ValidationError(
      'regionOrder must list exactly 4 region ids',
      'regionOrder',
    );
  }
  const ids = raw.map((id) => Number(id));
  if (
    ids.some((id) => !Number.isInteger(id) || id < 1 || id > 4) ||
    new Set(ids).size !== 4
  ) {
    throw new ValidationError(
      'regionOrder must list 4 distinct region ids (1-4)',
      'regionOrder',
    );
  }
  return ids;
}

function readEspnPlanRequest(req) {
  const year = parseYear(req.body.year);
  const playInDates = parseDateList(req.body.playInDates, 'playInDates');
  const r1Dates = parseDateList(req.body.r1Dates, 'r1Dates');
  const playInCounts = req.body.playInCounts;
  if (
    !Array.isArray(playInCounts) ||
    playInCounts.length !== playInDates.length ||
    playInCounts.some(
      (count) => !Number.isInteger(count) || count < 1 || count > 8,
    ) ||
    new Set(playInDates).size !== playInDates.length
  ) {
    throw new ValidationError(
      'Provide one whole-number play-in count (1–8) for each distinct date',
      'playInCounts',
    );
  }
  const expectedPlayInCount = playInCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  if (expectedPlayInCount > 8) {
    throw new ValidationError(
      'No more than 8 play-in games are supported',
      'playInCounts',
    );
  }
  const regionOrder = parseRegionOrder(req.body.regionOrder);
  return {
    year,
    playInDates,
    r1Dates,
    expectedPlayInCount,
    regionOrder,
    playInCounts,
    ignoreResolvedPlayIns: req.body.ignoreResolvedPlayIns === true,
  };
}

const espnTournamentSetupPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, new Date().getFullYear());
  const allRegionTypes = await tourneyRepository.getAllRegionTypes();
  const bracketRegions = DEFAULT_REGION_ORDER.map((id) =>
    allRegionTypes.find((r) => Number(r.regionID) === id),
  ).filter(Boolean);
  res.render('espnTournamentSetup', { year, bracketRegions });
}, 'espnTournamentSetupPage');

const previewEspnTournamentPlan = controllerWrapper(async (req, res) => {
  const input = readEspnPlanRequest(req);
  const plan = await buildEspnBracketPlan(input);
  // Never echo gamesData/firstFourData back — createTournamentFromEspn
  // reassembles from scratch server-side and never trusts a client-held copy
  // of a previewed plan (see the plan doc's server-boundary section).
  res.json({
    ready: plan.ready,
    year: plan.year,
    playInCount: plan.playInCount,
    preview: plan.preview,
    diagnostics: plan.diagnostics,
    infoDiagnostics: plan.infoDiagnostics,
    fetchSummary: plan.fetchSummary,
  });
}, 'previewEspnTournamentPlan');

const createTournamentFromEspn = controllerWrapper(async (req, res) => {
  const input = readEspnPlanRequest(req);
  if (req.body.confirmPairings !== true) {
    throw new ValidationError(
      'Confirm the semifinal pairings before creating',
      'confirmPairings',
    );
  }
  const plan = await buildEspnBracketPlan(input);
  if (!plan.ready) {
    throw new ValidationError(
      `The ESPN bracket plan is not ready to create (${plan.diagnostics.length} issue(s) remain)`,
      'diagnostics',
    );
  }
  await createNewBracket(
    plan.gamesData,
    plan.year,
    input.regionOrder,
    plan.firstFourData,
  );
  res.status(200).json({
    message: 'Tournament created successfully from ESPN',
    year: plan.year,
    playInCount: plan.playInCount,
  });
}, 'createTournamentFromEspn');

export {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  espnTournamentSetupPage,
  previewEspnTournamentPlan,
  createTournamentFromEspn,
  setupNewTourney,
  createTournament,
  pollEspnScheduled,
};
