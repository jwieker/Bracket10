import fs from 'node:fs';
import ejs from 'ejs';
import { expect, test } from 'vitest';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';

test('myEditEntry.ejs tolerates a missing csrfToken local', () => {
  const template = fs.readFileSync('views/myEditEntry.ejs', 'utf-8');

  // Minimal data to render the template
  const mockData = {
    entryData: {
      id: '123',
      person: 'Alice',
      teamName: 'T1',
      email: 'a@a.com',
      picks: [],
    },
    year: '2024',
    teamData: [],
    gameData: {},
    regions: ['East', 'West', 'South', 'Midwest'],
    cspNonce: 'test-nonce',
    gaMeasurementId: 'test-ga',
    enableRegistration: true,
    userEmail: undefined,
    siteAdmin: false,
    safeJson: safeJsonForScript,
  };

  // This should not throw a ReferenceError
  const html = ejs.render(template, mockData, {
    filename: 'views/myEditEntry.ejs',
  });
  expect(html).toContain('name="_csrf" value=""');
});
