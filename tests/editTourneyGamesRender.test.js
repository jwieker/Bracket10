import fs from 'node:fs';
import ejs from 'ejs';
import { safeJsonForScript } from '../src/utils/htmlSafe.js';

// Controller tests mock res.render, so they never compile the template —
// this renders the real one. Covers the plan's editor-compatibility fix: a
// null (play-in-fed) R1 slot must render a *selected* option, not a blank
// required select an admin can't submit unchanged.
function renderEditTourneyGames(overrides = {}) {
  const template = fs.readFileSync('views/editTourneyGames.ejs', 'utf-8');
  const defaults = {
    year: 2026,
    regions: [1, 2, 3, 4],
    regionNames: ['East', 'West', 'South', 'Midwest'],
    seeds: [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15],
    allTeams: [
      { sid: 10, name: 'Duke', mascot: 'Blue Devils' },
      { sid: 11, name: 'Kansas', mascot: 'Jayhawks' },
    ],
    existingGames: [],
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
    { filename: 'views/editTourneyGames.ejs' },
  );
}

describe('editTourneyGames.ejs play-in (First Four) slot rendering', () => {
  test('an ordinary resolved slot still renders the real team as selected', () => {
    const html = renderEditTourneyGames({
      existingGames: [
        { gameID: 1, regionID: 1, round: 1, team1ID: 10, team2ID: 11 },
      ],
    });

    expect(html).toContain('value="1-1-1-10"');
    expect(html).toContain('value="1-1-16-11"');
    expect(html).not.toContain('data-play-in="true"');
  });

  test('a null (play-in-fed) slot renders a selected placeholder posting an empty sID, labeled with both play-in teams', () => {
    const html = renderEditTourneyGames({
      existingGames: [
        { gameID: 1, regionID: 1, round: 1, team1ID: 10, team2ID: null },
        {
          gameID: 64,
          regionID: 7,
          round: 0,
          team1ID: 100,
          team1Name: 'Alcorn State',
          team2ID: 200,
          team2Name: 'Fairleigh Dickinson',
          nextGameID: 1,
          nextGameSpot: 2,
        },
      ],
    });

    // value is regionID-gameID-seed- (empty 4th segment) and carries `selected`.
    expect(html).toMatch(
      /<option\s+value="1-1-16-"\s+selected data-play-in="true">/,
    );
    expect(html).toContain(
      'Play-in winner: Alcorn State / Fairleigh Dickinson',
    );
  });

  test('a null slot with no matching round-0 game still renders a selected, submittable placeholder', () => {
    const html = renderEditTourneyGames({
      existingGames: [
        { gameID: 1, regionID: 1, round: 1, team1ID: 10, team2ID: null },
      ],
    });

    expect(html).toMatch(
      /<option\s+value="1-1-16-"\s+selected data-play-in="true">/,
    );
    expect(html).toContain('Play-in winner (unresolved)');
  });

  test('the play-in placeholder value is excluded from the client duplicate-selection check', () => {
    const html = renderEditTourneyGames();
    expect(html).toContain('if (!selectedTeamId) return;');
    expect(html).toContain('teamId && selectedTeams.has(teamId)');
  });
});
