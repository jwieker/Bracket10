import { main } from '../jobs/espn-poll.js';

const { loggerInfoMock, loggerErrorMock } = vi.hoisted(() => ({
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

// pollService imports Firestore-backed modules at load time; stub it so the job
// can be exercised in isolation. The real runPoll is injected per-test anyway.
vi.mock('../src/services/pollService.js', () => ({
  runEspnPoll: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: loggerInfoMock,
    error: loggerErrorMock,
  },
}));

describe('espn-poll job main()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exits 1 and skips the poll when POLL_YEAR is missing', async () => {
    const exit = vi.fn();
    const runPoll = vi.fn();

    await main({ env: {}, exit, runPoll });

    expect(runPoll).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'ESPN poll job: POLL_YEAR env var not set',
    );
  });

  test('exits 1 when POLL_YEAR is not a valid number', async () => {
    const exit = vi.fn();
    const runPoll = vi.fn();

    await main({ env: { POLL_YEAR: 'not-a-year' }, exit, runPoll });

    expect(runPoll).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('runs the poll and exits 0 on success, logging the summary', async () => {
    const exit = vi.fn();
    const summary = { updated: 3, skipped: 0 };
    const runPoll = vi.fn().mockResolvedValue(summary);

    const result = await main({ env: { POLL_YEAR: '2026' }, exit, runPoll });

    expect(runPoll).toHaveBeenCalledWith(2026);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      'ESPN poll job complete',
      summary,
    );
    expect(exit).toHaveBeenCalledWith(0);
    expect(result).toBe(summary);
  });

  test('exits 1 and logs when the poll rejects', async () => {
    const exit = vi.fn();
    const boom = new Error('ESPN unreachable');
    const runPoll = vi.fn().mockRejectedValue(boom);

    await main({ env: { POLL_YEAR: '2026' }, exit, runPoll });

    expect(runPoll).toHaveBeenCalledWith(2026);
    expect(loggerErrorMock).toHaveBeenCalledWith('ESPN poll job failed', boom);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
