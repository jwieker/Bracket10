import fs from 'node:fs';
import vm from 'node:vm';
import ejs from 'ejs';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';

// Controller tests mock res.render, so they never compile the template —
// this renders the real one.
function renderEspnTournamentSetup(overrides = {}) {
  const template = fs.readFileSync('views/espnTournamentSetup.ejs', 'utf-8');
  const defaults = {
    year: 2027,
    bracketRegions: [
      { regionID: 1, regionName: 'East' },
      { regionID: 2, regionName: 'West' },
      { regionID: 3, regionName: 'South' },
      { regionID: 4, regionName: 'Midwest' },
    ],
    csrfToken: 'test-csrf',
    cspNonce: 'test-nonce',
    gaMeasurementId: 'test-ga',
    enableRegistration: true,
    userEmail: undefined,
    siteAdmin: true,
    safeJson: safeJsonForScript,
  };
  return ejs.render(
    template,
    { ...defaults, ...overrides },
    { filename: 'views/espnTournamentSetup.ejs' },
  );
}

describe('espnTournamentSetup.ejs', () => {
  test('renders with the year and all 4 region names', () => {
    const html = renderEspnTournamentSetup();
    expect(html).toContain('Create 2027 Bracket from ESPN');
    expect(html).toContain('East');
    expect(html).toContain('West');
    expect(html).toContain('South');
    expect(html).toContain('Midwest');
  });

  test('every inline script carries the CSP nonce', () => {
    const html = renderEspnTournamentSetup();
    const scriptOpenTags = html.match(/<script(?![^>]*src=)[^>]*>/g) || [];
    for (const tag of scriptOpenTags) {
      expect(tag).toContain('nonce="test-nonce"');
    }
  });

  test('embeds bracket region names as JSON, not raw interpolation, for the client script', () => {
    const html = renderEspnTournamentSetup();
    expect(html).toContain('bracketRegionNames =');
    expect(html).toContain('"East"');
  });

  test('handles a region name containing HTML-sensitive characters safely via JSON embedding', () => {
    const html = renderEspnTournamentSetup({
      bracketRegions: [
        { regionID: 1, regionName: '</script><script>alert(1)</script>' },
        { regionID: 2, regionName: 'West' },
        { regionID: 3, regionName: 'South' },
        { regionID: 4, regionName: 'Midwest' },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('every inline script parses as valid JavaScript', () => {
    // The page's behavior lives entirely in inline client script, which no
    // other test executes — a stray backtick or brace would ship silently.
    const html = renderEspnTournamentSetup();
    const scripts = [
      ...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g),
    ];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, code] of scripts) {
      expect(() => new vm.Script(code)).not.toThrow();
    }
  });

  test('preview shows team names (falling back to school id) and wraps the play-in badge within its column', () => {
    const html = renderEspnTournamentSetup();
    expect(html).toContain('slot.displayName ||');
    expect(html).toContain('badge text-bg-warning text-wrap text-start mw-100');
  });

  test('renders with no bracketRegions without throwing', () => {
    const html = renderEspnTournamentSetup({ bracketRegions: [] });
    expect(html).toContain('Create 2027 Bracket from ESPN');
  });
});

test('the rendered page submits selected regions and each date/count pair unchanged', () => {
  const html = renderEspnTournamentSetup();
  const selects = [
    ...html.matchAll(
      /<select class="form-select region-order"[\s\S]*?<\/select>/g,
    ),
  ];
  expect(selects).toHaveLength(4);
  for (const [select] of selects) {
    for (const id of [1, 2, 3, 4]) expect(select).toContain(`value="${id}"`);
  }
  const code = html.slice(
    html.indexOf('function toYyyymmdd'),
    html.indexOf('// ── Preview rendering'),
  );
  const regionOrder = [1, 4, 2, 3];
  let counts = [1, 3];
  let ignoreResolvedPlayIns = false;
  expect(html).toMatch(
    /<input[^>]*type="checkbox"[^>]*id="ignoreResolvedPlayIns"[^>]*>/,
  );
  expect(
    html.match(/<input[^>]*id="ignoreResolvedPlayIns"[^>]*>/)[0],
  ).not.toContain('checked');
  const context = vm.createContext({
    document: {
      querySelectorAll: (selector) =>
        selector === '.region-order'
          ? regionOrder.map((value) => ({ value: String(value) }))
          : counts.map((count, index) => ({
              querySelector: (field) => ({
                value:
                  field === '.play-in-date'
                    ? `2027-03-${18 + index}`
                    : String(count),
              }),
            })),
      getElementById: (id) => ({
        checked:
          id === 'ignoreResolvedPlayIns' ? ignoreResolvedPlayIns : undefined,
        value: {
          espnYear: '2027',
          r1Date1: '2027-03-20',
          r1Date2: '2027-03-21',
        }[id],
      }),
    },
  });
  vm.runInContext(code, context);
  const body = JSON.parse(JSON.stringify(context.buildRequestBody()));
  expect(body).toEqual({
    year: 2027,
    playInDates: ['20270318', '20270319'],
    playInCounts: [1, 3],
    r1Dates: ['20270320', '20270321'],
    regionOrder,
    ignoreResolvedPlayIns: false,
  });
  ignoreResolvedPlayIns = true;
  expect(context.buildRequestBody().ignoreResolvedPlayIns).toBe(true);
  counts = [2, 2];
  expect(
    JSON.parse(JSON.stringify(context.buildRequestBody())).playInCounts,
  ).toEqual([2, 2]);
});
