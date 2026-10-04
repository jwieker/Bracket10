import fs from 'node:fs';
import ejs from 'ejs';
import { describe, expect, test } from 'vitest';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';

// Controller tests mock res.render, so they never compile the template — these
// render the real one. (#516)
function renderEditTeam(conferences) {
  const template = fs.readFileSync('views/editTeam.ejs', 'utf-8');
  return ejs.render(
    template,
    {
      team: {
        sid: 1,
        name: 'Test School',
        mascot: 'Testers',
        nameNick: 'TS',
        espn: '',
        confID: '',
        conferenceHistory: [],
      },
      isNew: false,
      conferences,
      csrfToken: 'test-csrf',
      cspNonce: 'test-nonce',
      gaMeasurementId: 'test-ga',
      enableRegistration: true,
      userEmail: undefined,
      siteAdmin: true,
      safeJson: safeJsonForScript,
    },
    { filename: 'views/editTeam.ejs' },
  );
}

describe('editTeam.ejs conference options (#516)', () => {
  test("a shortName containing an apostrophe reaches the browser as text, not as '&#39;'", () => {
    const html = renderEditTeam([
      {
        slug: 'big-east',
        shortName: "St. John's",
        name: "St. John's",
        active: true,
      },
    ]);

    // The old form interpolated into a JS string literal via the escaping output
    // tag, so the apostrophe arrived as the literal characters `&#39;` — browsers
    // don't decode HTML entities inside a classic script element, so the dropdown
    // rendered the entity. JSON carries the real character.
    expect(html).toContain('"label":"St. John\'s"');
    expect(html).not.toContain("St. John&#39;s'");
  });

  test('an ampersand in a conference name survives, and markup characters stay escaped', () => {
    const html = renderEditTeam([
      { slug: 'a-b', shortName: 'A & B', name: 'A & B', active: true },
    ]);

    // safeJson escapes `&` to \u0026 inside the JSON, which JS decodes back to a
    // real ampersand at parse time — inert in markup, correct in the DOM.
    expect(html).toContain('"label":"A \\u0026 B"');
  });

  test('a shortName cannot break out of the script element', () => {
    const html = renderEditTeam([
      {
        slug: 'evil',
        shortName: '</script><script>alert(1)</script>',
        name: 'Evil',
        active: true,
      },
    ]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  test('renders with no conferences', () => {
    const html = renderEditTeam([]);
    expect(html).toContain('CONF_OPTIONS');
  });
});
