import fs from 'node:fs';
import ejs from 'ejs';
import { describe, expect, test } from 'vitest';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';

// Controller tests mock res.render, so they never compile the template — this
// renders the real one.
function renderRegistration(overrides = {}) {
  const template = fs.readFileSync('views/registration.ejs', 'utf-8');
  return ejs.render(
    template,
    {
      teamData: [],
      gameData: {},
      regions: ['East', 'West', 'South', 'Midwest'],
      conferenceStats: {},
      name: 'Test Group',
      year: 2026,
      csrfToken: 'test-csrf',
      cspNonce: 'test-nonce',
      gaMeasurementId: 'test-ga',
      enableRegistration: true,
      userEmail: undefined,
      siteAdmin: false,
      safeJson: safeJsonForScript,
      ...overrides,
    },
    { filename: 'views/registration.ejs' },
  );
}

describe('registration.ejs email info', () => {
  test('the info icon is a popover button carrying the email copy and privacy link', () => {
    const html = renderRegistration();

    expect(html).toContain('id="emailInfoBtn"');
    expect(html).toContain('data-bs-toggle="popover"');
    expect(html).toContain('data-bs-html="true"');
    // Attribute-escaped: the browser decodes it back to real markup.
    expect(html).toContain(
      'We use your email to confirm your entry and help you access or change your picks.',
    );
    expect(html).toContain('We won&#39;t send marketing emails.');
    expect(html).toContain(
      '&lt;a href=&#34;/privacy&#34;&gt;Privacy Notice&lt;/a&gt;',
    );
    expect(html).toContain('Using a Gmail address? Sign in with Google');
  });

  test('the copy no longer sits under the field', () => {
    const html = renderRegistration();

    expect(html).not.toContain('id="emailHelp"');
    expect(html).not.toContain('aria-describedby="emailHelp"');
  });
});
