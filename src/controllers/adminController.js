import {
  getTournamentData,
  getBudgetStatus,
  triggerProductionDeploy,
  getCloudConsoleLinks,
} from '../services/index.js';
import { thisYear } from '../config/app.js';
import {
  controllerWrapper,
  parseYearOrDefault,
} from '../utils/controllerUtils.js';
import { gameRepository } from '../repositories/index.js';

const adminDashboard = controllerWrapper(async (_req, res) => {
  res.redirect('/admin/tournament');
}, 'adminDashboard');

const adminTournamentPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, thisYear);
  const activeGames = await gameRepository.getActiveGames(year);
  if (activeGames.length > 0) {
    const enhancedActiveGames = await Promise.all(
      activeGames.map(async (game) => {
        if (game.winner) {
          const team1 = game.team1ID;
          const team1Name = game.team1Name;
          const team2Name = game.team2Name;
          if (game.winner === team1) {
            return { ...game, winnerName: team1Name };
          } else {
            return { ...game, winnerName: team2Name };
          }
        }
        return game;
      }),
    );
    // Unresolved First Four (round 0) games pinned to the top; once complete
    // they sort like any other finished game. The sort is stable so the
    // repository ordering (unresolved first, then gameID) is kept otherwise.
    const ffPending = (g) => (g.round === 0 && !g.winner ? 0 : 1);
    enhancedActiveGames.sort((a, b) => ffPending(a) - ffPending(b));
    const isDev =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    res.render('adminTournament', {
      activeGames: enhancedActiveGames,
      year,
      isNewTournament: false,
      isDev,
    });
  } else {
    const result = await getTournamentData(year);
    const isDev =
      process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (result.isNewTournament) {
      return res.render('adminTournament', {
        activeGames: [],
        year: result.year,
        isNewTournament: true,
        isDev,
      });
    } else {
      return res.render('adminTournament', {
        activeGames: [],
        year: year,
        isNewTournament: false,
        isDev,
      });
    }
  }
}, 'adminTournamentPage');

const adminEntriesPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, thisYear);
  res.render('adminEntries', { year });
}, 'adminEntriesPage');

const adminTeamsPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, thisYear);
  res.render('adminTeams', { year });
}, 'adminTeamsPage');

const adminSystemPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, thisYear);
  res.render('adminSystem', { year });
}, 'adminSystemPage');

const changeYear = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.body.year, thisYear);
  res.redirect(`/admin/tournament?year=${year}`);
}, 'changeYear');

const adminCloudPage = controllerWrapper(async (req, res) => {
  const year = parseYearOrDefault(req.query.year, thisYear);
  const budget = await getBudgetStatus();
  const links = await getCloudConsoleLinks();
  res.render('adminCloud', { year, budget, links });
}, 'adminCloudPage');

const adminCloudBudgetRefresh = controllerWrapper(async (_req, res) => {
  const budget = await getBudgetStatus({ force: true });
  res.json(budget);
}, 'adminCloudBudgetRefresh');

const adminCloudDeploy = controllerWrapper(async (_req, res) => {
  const result = await triggerProductionDeploy();
  if (!result.ok) {
    return res.status(500).json(result);
  }
  res.json(result);
}, 'adminCloudDeploy');

export {
  adminDashboard,
  adminTournamentPage,
  adminEntriesPage,
  adminTeamsPage,
  adminSystemPage,
  adminCloudPage,
  adminCloudBudgetRefresh,
  adminCloudDeploy,
  changeYear,
};
