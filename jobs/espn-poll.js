import { runEspnPoll } from '../src/services/pollService.js';
import Logger from '../src/utils/logger.js';

/**
 * ESPN poll job entry point.
 *
 * Dependencies (env / exit / runPoll) are injected so the job is testable
 * without touching the real process or network. The module-load CLI guard at
 * the bottom preserves the original `node jobs/espn-poll.js` behavior.
 *
 * @param {object} [deps]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {(code?: number) => void} [deps.exit]
 * @param {(year: number) => Promise<object>} [deps.runPoll]
 */
export async function main({
  env = process.env,
  exit = process.exit,
  runPoll = runEspnPoll,
} = {}) {
  const year = parseInt(env.POLL_YEAR, 10);
  if (!year) {
    Logger.error('ESPN poll job: POLL_YEAR env var not set');
    exit(1);
    return;
  }

  Logger.info('ESPN poll job starting', { year });
  try {
    const summary = await runPoll(year);
    Logger.info('ESPN poll job complete', summary);
    exit(0);
    return summary;
  } catch (err) {
    Logger.error('ESPN poll job failed', err);
    exit(1);
  }
}

// Run automatically only when invoked directly as a script (not when imported
// by a test), so CLI behavior is unchanged.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
