import { ServiceError } from '../src/utils/errors.js';

import {
  requestLogContext,
  requestErrorDetails,
} from '../src/utils/requestLogUtils.js';

test.each([0, Number.MAX_SAFE_INTEGER, '0', '9'.repeat(15)])(
  'keeps numeric metadata at the allowed boundary: %s',
  (year) => {
    expect(requestLogContext({ body: { year } }).body).toEqual({ year });
  },
);

test.each([
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
  Infinity,
  NaN,
  '',
  '9'.repeat(16),
  '-1',
  '1.5',
  '1e3',
  ' 1',
  null,
  [],
  {},
])('omits invalid numeric metadata: %s', (year) => {
  expect(requestLogContext({ body: { year } }).body).toEqual({});
});

test.each([
  undefined,
  'nonstandard header\n    at SECRET_FRAME',
  'SyntaxError: different message\n    at SECRET_FRAME',
])(
  'omits missing or nonstandard stacks without leaking their contents',
  (stack) => {
    expect(
      requestErrorDetails({ name: 'SyntaxError', message: 'secret', stack }),
    ).toEqual({ name: 'SyntaxError', stack: '' });
  },
);

test('preserves diagnostic frames from an error with an empty message', () => {
  const details = requestErrorDetails(new Error());
  expect(details.name).toBe('Error');
  expect(details.stack).toContain('requestLogUtils.pure.test.js');
});

describe.each([[ServiceError, 'service', 'getTournamentData']])(
  '%s diagnostic context',
  (ErrorClass, field, context) => {
    test('retains typed context while omitting messages and arbitrary properties', () => {
      const error = new ErrorClass(
        'SECRET email@example.com\n    at SECRET_FRAME',
        context,
      );
      error.body = 'SECRET parser body';
      error.config = { token: 'SECRET' };
      const details = requestErrorDetails(error);
      expect(details).toEqual({
        name: error.name,
        [field]: context,
        stack: expect.any(String),
      });
      expect(details.stack).toContain('requestLogUtils.pure.test.js');
      expect(JSON.stringify(details)).not.toContain('SECRET');
    });

    test.each([null, undefined, 42, {}, ['context']])(
      'omits non-string context %j',
      (context) => {
        expect(
          requestErrorDetails(new ErrorClass('secret', context)),
        ).not.toHaveProperty(field);
      },
    );

    test('does not trust a plain error even if it spoofs the class name', () => {
      const error = new Error('secret');
      error[field] = 'secret';
      expect(requestErrorDetails(error)).not.toHaveProperty(field);
      error.name = ErrorClass.name;
      expect(requestErrorDetails(error)).not.toHaveProperty(field);
      expect(
        requestErrorDetails({ name: ErrorClass.name, [field]: 'secret' }),
      ).not.toHaveProperty(field);
    });
  },
);

test('retains only the class’s own diagnostic field', () => {
  const serviceError = new ServiceError('secret', 'getTournamentData');
  serviceError.operation = 'secret';
  expect(requestErrorDetails(serviceError)).not.toHaveProperty('operation');
});
