import { buildPlaygroundData } from '../services/playgroundService.js';
import { controllerWrapper, parseYearOrDefault } from '../utils/controllerUtils.js';
import { ValidationError } from '../utils/errors.js';
import { thisYear } from '../config/app.js';

export const getPlayground = controllerWrapper(async (req, res) => {
  const groupName = req.query.group;
  const year = parseYearOrDefault(req.query.year, thisYear);

  if (!groupName) {
    throw new ValidationError('Group name is required');
  }

  const {
    entries,
    schoolRecords,
    pendingGames,
    allGamesForClient,
    roundPoints,
    roundNames,
  } = await buildPlaygroundData(groupName, year);

  res.set('Cache-Control', 'private, max-age=300');
  res.render('playground', {
    groupName,
    gameYear: year,
    entries,
    schoolRecords,
    pendingGames,
    allGames: allGamesForClient,
    roundPoints,
    roundNames,
  });
}, 'getPlayground');
