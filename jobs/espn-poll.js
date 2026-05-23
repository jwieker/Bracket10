import { runEspnPoll } from '../src/services/pollService.js';
import Logger from '../src/utils/logger.js';

const year = parseInt(process.env.POLL_YEAR, 10);
if (!year) {
  Logger.error('ESPN poll job: POLL_YEAR env var not set');
  process.exit(1);
}

Logger.info('ESPN poll job starting', { year });
runEspnPoll(year)
  .then((summary) => {
    Logger.info('ESPN poll job complete', summary);
    process.exit(0);
  })
  .catch((err) => {
    Logger.error('ESPN poll job failed', err);
    process.exit(1);
  });
