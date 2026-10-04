import { controllerWrapper } from '../src/utils/controllerUtils.js';
import { errorMiddleware } from '../src/middleware/errorMiddleware.js';
import { ValidationError, ServiceError } from '../src/utils/errors.js';

const secrets = [
  'OAUTH_CODE_SECRET',
  'OAUTH_STATE_SECRET',
  'CONFIRM_SECRET',
  'CSRF_SECRET',
  'PAYMENT_NOTE_SECRET',
  'NESTED_SECRET',
  'PICK_SECRET',
];

function request() {
  return {
    method: 'POST',
    url: `/auth/google/callback?code=${secrets[0]}&state=${secrets[1]}`,
    originalUrl: `/auth/google/callback?code=${secrets[0]}&state=${secrets[1]}&token=${secrets[2]}`,
    headers: { accept: 'application/json' },
    body: {
      _csrf: secrets[3],
      paymentNote: secrets[4],
      extra: { token: secrets[5] },
      teamSelect1: secrets[6],
      year: '2026',
      round: 2,
      gameID: { value: secrets[5] },
      gameYear: secrets[0],
      [secrets[2]]: secrets[2],
      email: 'private@example.com',
    },
  };
}

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
}

let lines;
beforeEach(() => {
  lines = [];
  for (const method of ['log', 'warn', 'error']) {
    vi.spyOn(console, method).mockImplementation((line) => lines.push(line));
  }
});
afterEach(() => vi.restoreAllMocks());

function expectSafeLogs() {
  const output = lines.join('\n');
  for (const secret of [...secrets, 'private@example.com']) {
    expect(output).not.toContain(secret);
  }
  expect(output).toContain('/auth/google/callback');
  expect(output).toContain('POST');
  expect(output).not.toContain('?code=');
}

test('request start logs retain only validated numeric metadata', async () => {
  await controllerWrapper(async () => {}, 'verify')(request(), response());
  expectSafeLogs();
  const log = JSON.parse(lines[0]);
  expect(log.data.body).toEqual({ year: '2026', round: 2 });
  expect(log.message).toBe('verify started');
});

test('controller errors omit messages, raw bodies, and upstream request configs', async () => {
  const req = request();
  const error = Object.assign(
    new SyntaxError(`Invalid ${secrets[0]}\n    at ${secrets[1]}`),
    {
      body: req.body,
      config: { url: req.url },
    },
  );
  await controllerWrapper(async () => {
    throw error;
  }, 'verify')(req, response());
  expectSafeLogs();
  const log = lines
    .map((line) => JSON.parse(line))
    .find((entry) => entry.severity === 'ERROR');
  expect(log.data.name).toBe('SyntaxError');
  expect(log.data.stack).toContain('requestLogging.test.js');
});

test.each([ValidationError, ServiceError, SyntaxError])(
  'global error logs omit query strings and input echoed by %s',
  (ErrorType) => {
    const req = request();
    const error = Object.assign(new ErrorType(secrets.join('\n')), {
      body: req.body,
    });
    errorMiddleware(error, req, response(), vi.fn());
    expectSafeLogs();
    expect(JSON.parse(lines[0]).data.name).toBe(error.name);
    expect(JSON.parse(lines[0]).data.stack).toContain('requestLogging.test.js');
  },
);

test.each(['controller', 'middleware'])(
  '%s logs known validation field names without arbitrary field values',
  async (boundary) => {
    for (const field of [
      'email',
      'Team name',
      secrets[0],
      { value: secrets[1] },
    ]) {
      lines.length = 0;
      const error = new ValidationError('Invalid input', field);
      if (boundary === 'controller') {
        await controllerWrapper(async () => {
          throw error;
        }, 'verify')(request(), response());
      } else {
        errorMiddleware(error, request(), response(), vi.fn());
      }
      expectSafeLogs();
      const log = lines
        .map((line) => JSON.parse(line))
        .find(
          (entry) => entry.severity === 'ERROR' || entry.severity === 'WARNING',
        );
      if (field === 'email' || field === 'Team name') {
        expect(log.data.field).toBe(field);
      } else {
        expect(log.data).not.toHaveProperty('field');
      }
    }
  },
);
