import fs from 'node:fs';
import ejs from 'ejs';
import { describe, expect, test, vi, afterEach } from 'vitest';
import { index, resolveHomeState } from '../src/controllers/indexController.js';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';
import {
  thisYear,
  bracketLaunchDate,
  tourneyStartDate,
  TOURNAMENT_ROUNDS,
} from '../src/config/app.js';

function mockRes() {
  return {
    render: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    redirect: vi.fn(),
  };
}

function mockReq(query = {}, path = '/') {
  return { body: {}, query, method: 'GET', url: path, path };
}

async function renderData(query = {}, path = '/') {
  const res = mockRes();
  await index(mockReq(query, path), res);
  expect(res.render).toHaveBeenCalledWith('index', expect.any(Object));
  return res.render.mock.calls[0][1];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function stateAt(at) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.useFakeTimers();
  vi.setSystemTime(at);
  return resolveHomeState();
}

const MINUTE = 60 * 1000;

describe('indexController - index', () => {
  test('renders index with state "test" in test environment', async () => {
    const req = mockReq();
    const res = mockRes();
    await index(req, res);
    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ state: 'test' }),
    );
  });

  test('passes userEmail from the session to the homepage', async () => {
    const req = mockReq({ userEmail: 'query@example.com' });
    req.body.userEmail = 'body@example.com';
    req.session = { userEmail: 'a@b.com' };
    const res = mockRes();

    await index(req, res);

    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ userEmail: 'a@b.com' }),
    );
  });

  test('passes null userEmail when the session is absent', async () => {
    const req = mockReq({ userEmail: 'query@example.com' });
    req.body.userEmail = 'body@example.com';
    const res = mockRes();

    await index(req, res);

    expect(res.render).toHaveBeenCalledWith(
      'index',
      expect.objectContaining({ userEmail: null }),
    );
  });

  test('sets error: true when query.error === "true"', async () => {
    expect((await renderData({ error: 'true' })).error).toBe(true);
  });

  test('sets error: false when query.error is absent', async () => {
    expect((await renderData()).error).toBe(false);
  });

  test('sets createError: true when query.createError === "true"', async () => {
    expect((await renderData({ createError: 'true' })).createError).toBe(true);
  });

  test('sets createError: false when query.createError is absent', async () => {
    expect((await renderData()).createError).toBe(false);
  });

  test('passes thisYear in render data', async () => {
    expect((await renderData()).thisYear).toBeDefined();
  });

  test('launch copy follows config in Eastern time across a season rollover', async () => {
    const original = bracketLaunchDate.getTime();
    try {
      // Monday in UTC, still Sunday at the tournament's Eastern time.
      bracketLaunchDate.setTime(Date.parse('2027-03-15T01:00:00Z'));
      const model = await renderData({ preview: 'comingsoon' });
      expect(model.launchDateLabel).toBe('Sunday, March 14');
      const html = renderIndex({ ...model, thisYear: 2027 });
      expect(html).toContain('Next Pool Opens Sunday, March 14');
      expect(html).toContain('Brackets for 2027 open Sunday, March 14.');
      expect(html).toContain('Top 2027 Bracket');
      expect(html).not.toContain('Sunday, March 15');
    } finally {
      bracketLaunchDate.setTime(original);
    }
  });

  test('currentPath reflects the request path', async () => {
    expect((await renderData({}, '/')).currentPath).toBe('/');
  });
});

describe('resolveHomeState follows the tournament calendar', () => {
  test.each([
    [
      'before the bracket launch',
      bracketLaunchDate.getTime() - MINUTE,
      'comingsoon',
    ],
    [
      'between launch and first tip',
      bracketLaunchDate.getTime() + MINUTE,
      'registration',
    ],
    ['at the first tip', tourneyStartDate.getTime(), 'registration'],
    ['after the first tip', tourneyStartDate.getTime() + MINUTE, 'tournament'],
  ])('%s → %s', (_label, at, expected) => {
    expect(stateAt(new Date(at))).toBe(expected);
  });
});

describe('index controller view model', () => {
  test('passes the ladder derived from TOURNAMENT_ROUNDS', async () => {
    const { ladder } = await renderData();
    expect(ladder.map((r) => r.roundPoints)).toEqual([2, 3, 5, 9, 17, 33]);
    expect(ladder.map((r) => r.cumulative)).toEqual([2, 5, 10, 19, 36, 69]);
    expect(ladder.at(-1).barWidth).toBe(100);
    expect(ladder.every((r) => r.barWidth > 0 && r.barWidth <= 100)).toBe(true);
  });

  test('offers five archive years ending at the current one', async () => {
    const { archiveYears } = await renderData();
    expect(archiveYears).toEqual([
      thisYear,
      thisYear - 1,
      thisYear - 2,
      thisYear - 3,
      thisYear - 4,
    ]);
  });

  test('passes the comparison stats', async () => {
    const { compare } = await renderData();
    expect(compare).toEqual({
      deep: 36,
      shallow: 6,
      deepLabel: 'Final Four',
      shallowTeams: 3,
      ratio: 6,
    });
  });

  test('?preview picks a layout in test/development only', async () => {
    expect((await renderData({ preview: 'tournament' })).layout).toBe(
      'tournament',
    );
    expect((await renderData({ preview: 'comingsoon' })).layout).toBe(
      'comingsoon',
    );
    expect((await renderData({ preview: 'nonsense' })).layout).toBe(
      'registration',
    );
    expect((await renderData()).preview).toBe(true);
  });

  test('outside test/development the layout is the calendar state and preview is off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(tourneyStartDate.getTime() + MINUTE));

    const data = await renderData({ preview: 'comingsoon' });
    expect(data.preview).toBe(false);
    expect(data.layout).toBe('tournament');
  });
});

function renderIndex(overrides = {}) {
  const template = fs.readFileSync('views/index.ejs', 'utf-8');
  return ejs.render(
    template,
    {
      state: 'test',
      layout: 'registration',
      preview: false,
      error: false,
      createError: false,
      thisYear,
      launchDateLabel: 'Sunday, March 15',
      currentPath: '/',
      archiveYears: [thisYear, thisYear - 1, thisYear - 2],
      ladder: [
        { name: 'First Round', roundPoints: 2, cumulative: 2, barWidth: 6 },
        {
          name: 'Championship',
          roundPoints: 33,
          cumulative: 69,
          barWidth: 100,
        },
      ],
      compare: {
        deep: 36,
        shallow: 6,
        deepLabel: 'Final Four',
        shallowTeams: 3,
        ratio: 6,
      },
      userEmail: undefined,
      appHost: '',
      cspNonce: 'test-nonce',
      gaMeasurementId: '',
      safeJson: safeJsonForScript,
      ...overrides,
    },
    { filename: 'views/index.ejs' },
  );
}

describe('index.ejs template rendering', () => {
  test('registration layout posts the create form to /newEntry', () => {
    const html = renderIndex({ layout: 'registration' });
    expect(html).toContain('<form action="/newEntry"');
  });

  test('tournament layout offers view-only, never the create form', () => {
    const html = renderIndex({ layout: 'tournament' });
    expect(html).not.toContain('<form action="/newEntry"');
    expect(html).toContain('<form action="/gameView"');
    expect(html).toContain(`name="year" value="${thisYear}"`);
  });

  test('coming-soon layout offers view-only, never the create form', () => {
    const html = renderIndex({ layout: 'comingsoon' });
    expect(html).not.toContain('<form action="/newEntry"');
    expect(html).toContain('<form action="/gameView"');
  });

  test.each(['comingsoon', 'registration', 'tournament'])(
    '%s renders exactly one archive year picker',
    async (layout) => {
      const html = renderIndex(await renderData({ preview: layout }));
      const pickers = [
        ...html.matchAll(/<select[^>]*name="year"[^>]*>([\s\S]*?)<\/select>/g),
      ];
      expect(pickers).toHaveLength(1);
      const years = [...pickers[0][1].matchAll(/<option value="(\d+)"/g)].map(
        (match) => Number(match[1]),
      );
      expect(years).toEqual(
        layout === 'comingsoon'
          ? [thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4]
          : [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4],
      );
      if (layout === 'comingsoon') {
        expect(html.match(/<form action="\/gameView"/g)).toHaveLength(1);
      }
    },
  );

  test('the scoring ladder renders the table with round points', () => {
    const html = renderIndex();
    expect(html).toContain('First Round');
    expect(html).toContain('69 pts');
    expect(html).toContain('width: 100%;');
  });

  test('the dev preview switcher only renders when preview is on', () => {
    expect(renderIndex({ preview: false })).not.toContain('/?preview=');
    expect(renderIndex({ preview: true })).toContain('/?preview=tournament');
  });

  test.each([['error'], ['createError']])(
    'the %s flag surfaces a message on the page',
    (flag) => {
      expect(renderIndex({ [flag]: true })).toContain(
        'We couldn&rsquo;t find that group name',
      );
    },
  );

  test('neither flag means no message', () => {
    expect(renderIndex()).not.toContain(
      'We couldn&rsquo;t find that group name',
    );
  });

  test('signed-in users see "Signed in as" instead of the sign-in button', () => {
    const html = renderIndex({ userEmail: 'alex@example.com' });
    expect(html).toContain('Signed in as <strong>alex@example.com</strong>');
    expect(html).not.toContain('Sign in with Google');
  });

  test('signed-out users see the Google sign-in button', () => {
    const html = renderIndex({ userEmail: undefined });
    expect(html).toContain('Sign in with Google');
    expect(html).not.toContain('Signed in as');
  });

  test('emits the appHost social-preview meta tag when appHost is set', () => {
    const html = renderIndex({ appHost: 'bracket10.example.com' });
    expect(html).toContain(
      '<meta itemprop="image" content="https://bracket10.example.com/logo.png">',
    );
  });

  test('omits the appHost meta tag when appHost is empty', () => {
    expect(renderIndex({ appHost: '' })).not.toContain('itemprop="image"');
  });

  test('comparison prose follows changed round points and labels', async () => {
    const firstRound = TOURNAMENT_ROUNDS[1].roundPoints;
    const deepLabel = TOURNAMENT_ROUNDS[5].name;
    try {
      TOURNAMENT_ROUNDS[1].roundPoints = 4;
      TOURNAMENT_ROUNDS[5].name = 'Semifinals';
      const model = await renderData();
      const html = renderIndex(model);
      expect(html).toContain('<strong>3x</strong> as many points');
      expect(html).toContain('One Team in Semifinals');
      expect(html).toContain('3 Teams Winning Once');
      expect(html).not.toContain('<strong>6x</strong>');
    } finally {
      TOURNAMENT_ROUNDS[1].roundPoints = firstRound;
      TOURNAMENT_ROUNDS[5].name = deepLabel;
    }
  });

  test('renders the compare stats passed by the controller', () => {
    const html = renderIndex({
      compare: {
        deep: 42,
        shallow: 7,
        deepLabel: 'Final Four',
        shallowTeams: 3,
        ratio: 6,
      },
    });
    expect(html).toContain('<div class="b2-stat-number">42</div>');
    expect(html).toContain(
      '<div class="b2-stat-number" style="color: var(--b2-text-muted);">7</div>',
    );
  });
});
