import {
  prepareRegionVerifyData,
  prepareNewTournamentData,
  createNewBracket,
  updateBracket,
  updateEntrywithNewSchools,
  deleteTournament,
} from "../services/index.js";
import { fetchScheduledTournamentGames, loadTeamMap } from "../services/espnService.js";
import { gameRepository } from "../repositories/index.js";
import { controllerWrapper, parseYear, parsePositiveInt } from "../utils/controllerUtils.js";

const regionVerify = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const regions = [0, 1, 2, 3].map((i) => Number(req.body[`region${i}`]));
  const data = await prepareRegionVerifyData(regions, year);
  res.render("newTourneyGames", { year, ...data });
}, "regionVerify");

const gamesVerify = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const regionData = String(req.body.region).split(',').map(Number);
  const gamesData = req.body.games;
  await createNewBracket(gamesData, year, regionData);
  res.status(200).json({ message: "New Bracket Created Successfully" });
}, "gamesVerify");

const viewTournament = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);

  const { allGames: existingGames, regions: regionObjects } =
    await gameRepository.getAllTournamentDetails(year);
  const regionIDs = regionObjects.map((r) => r.regionID);

  const data = await prepareRegionVerifyData(regionIDs, year);
  res.render("editTourneyGames", {
    year,
    ...data,
    existingGames,
  });
}, "viewTournament");

const tournamentUpdate = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const regionData = [0, 1, 2, 3].map((i) => Number(req.body[`region${i}`]));
  const gamesData = req.body.games;
  const schoolChanges = await updateBracket(gamesData, year, regionData);
  await updateEntrywithNewSchools(schoolChanges, year);
  res.status(200).json({ message: "Tournament updated successfully" });
}, "tournamentUpdate");

const deleteTournamentHandler = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  await deleteTournament(year);
  res.status(200).json({ message: `Tournament for ${year} deleted successfully` });
}, "deleteTournament");

const setupNewTourney = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const data = await prepareNewTournamentData();
  res.render("newTourneyComplete", { year, ...data });
}, "setupNewTourney");

const createTournament = controllerWrapper(async (req, res) => {
  const year = parseYear(req.body.year);
  const regions = req.body.regions.map(Number);
  const gamesData = req.body.games;

  const includeFirstFour = req.body.includeFirstFour === true;
  let firstFourData = null;
  if (includeFirstFour) {
    const ffCount = parsePositiveInt(req.body.firstFourCount, 'firstFourCount', { defaultValue: 4, max: 8 });
    firstFourData = [];
    for (let i = 0; i < ffCount; i++) {
      firstFourData.push({
        team1ID: Number(req.body[`ff_team1_${i}`]),
        team2ID: Number(req.body[`ff_team2_${i}`]),
        seed: Number(req.body[`ff_seed_${i}`]),
        nextGameID: Number(req.body[`ff_nextGame_${i}`]),
        nextGameSpot: Number(req.body[`ff_nextGameSpot_${i}`]),
      });
    }
  }

  await createNewBracket(gamesData, year, regions, firstFourData);
  res.status(200).json({ message: "Tournament created successfully" });
}, "createTournament");

const pollEspnScheduled = controllerWrapper(async (req, res) => {
  const { date1, date2 } = req.body;
  const teamMap = loadTeamMap();

  const [games1, games2] = await Promise.all([
    date1 ? fetchScheduledTournamentGames(date1) : Promise.resolve([]),
    date2 ? fetchScheduledTournamentGames(date2) : Promise.resolve([]),
  ]);

  const allGames = Array.from(
    new Map([...games1, ...games2].map((g) => [g.espnEventId, g])).values()
  );

  const resolved = allGames.map((g) => ({
    ...g,
    team1SID: teamMap[g.team1DisplayName] ?? null,
    team2SID: teamMap[g.team2DisplayName] ?? null,
  }));

  res.json({ games: resolved });
}, "pollEspnScheduled");

export {
  regionVerify,
  gamesVerify,
  viewTournament,
  tournamentUpdate,
  deleteTournamentHandler,
  setupNewTourney,
  createTournament,
  pollEspnScheduled,
};
