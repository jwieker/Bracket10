import fs from 'node:fs';
import ejs from 'ejs';
import { describe, expect, test } from 'vitest';

// Controller tests mock res.render, so they never compile the template — these
// render the real one.
function renderAdminTournament(activeGames) {
  const template = fs.readFileSync('views/adminTournament.ejs', 'utf-8');
  return ejs.render(
    template,
    {
      activeGames,
      year: 2026,
      isNewTournament: false,
      isDev: false,
      csrfToken: 'test-csrf',
      cspNonce: 'test-nonce',
      gaMeasurementId: 'test-ga',
      enableRegistration: true,
      userEmail: undefined,
      siteAdmin: true,
    },
    { filename: 'views/adminTournament.ejs' },
  );
}

const game = {
  gameID: 7,
  round: 1,
  regionName: 'East',
  team1ID: 11,
  team1Name: 'Duke',
  team1Seed: 1,
  team1LogoUrl: 'https://a.espncdn.com/duke.png',
  team2ID: 22,
  team2Name: 'UNC',
  team2Seed: 16,
  team2LogoUrl: null,
  nextGameID: 33,
  nextGameSpot: 1,
  winner: null,
};

describe('adminTournament.ejs', () => {
  test('desktop table has a Show less toggle and tags ID/next-game columns as collapsible', () => {
    const html = renderAdminTournament([game]);

    expect(html).toContain('id="toggleDetailsBtn"');
    expect(html).toContain('>Show less</button>');
    // GameID, both team IDs, Next Game group header, next ID + spot — header row 2
    // and the body row must agree so the compact view leaves no orphan cells.
    const headerCols = html.match(/<th class="col-detail /g) ?? [];
    expect(headerCols).toHaveLength(5);
    const bodyCols = html.match(/<td class="col-detail[ "]/g) ?? [];
    expect(bodyCols).toHaveLength(5);
  });

  test('mobile card shows the team logo, falling back to initials without one', () => {
    const html = renderAdminTournament([game]);

    expect(html).toContain('<img src="https://a.espncdn.com/duke.png" alt=""');
    expect(html).toContain('<span class="admin-team-logo-fallback">UN</span>');
  });

  test('desktop table shows the logos too, outside the collapsible columns', () => {
    const html = renderAdminTournament([game]);
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));

    expect(table).toContain('<img src="https://a.espncdn.com/duke.png" alt=""');
    expect(table).toContain('<span class="admin-team-logo-fallback">UN</span>');
  });

  test('the team names are the one-click winner buttons; no dropdown or confirm dialogs', () => {
    const html = renderAdminTournament([game]);

    // Desktop row + mobile card, two teams each.
    expect(html.match(/class="team-pick-btn team-pick-/g)).toHaveLength(4);
    expect(html).toContain('data-team-id="11" data-team-name="Duke"');
    expect(html).toContain('data-team-id="22" data-team-name="UNC"');
    expect(html).not.toContain('winner-select');
    expect(html).not.toContain('submit-game-result');
    expect(html).not.toContain('pick-winner-btn');
    expect(html).not.toContain('window.confirm(`Set winner');
    expect(html).not.toContain('window.confirm(`Undo the winner');
    expect(html).toContain('id="resultToast"');
  });

  test('a decided game outlines the winner, greys the loser, and shows Undo', () => {
    const html = renderAdminTournament([
      { ...game, winner: 22, winnerName: 'UNC' },
    ]);

    expect(html.match(/data-winner-id="22"/g)).toHaveLength(2);
    expect(html.match(/team-pick-\w+ is-winner"/g)).toHaveLength(2);
    expect(html.match(/team-pick-\w+ is-loser"/g)).toHaveLength(2);
    // The winner is UNC (team 2); Duke is the loser.
    expect(html).toMatch(/is-loser"\s+data-team-id="11"/);
    expect(html).toMatch(/is-winner"\s+data-team-id="22"/);
    expect(html).not.toMatch(/undo-game-result d-none/);
  });

  test('an undecided game has no winner/loser styling and Undo hidden', () => {
    const html = renderAdminTournament([game]);

    expect(html.match(/\sdata-winner-id=""/g)).toHaveLength(2);
    expect(html.match(/undo-game-result d-none/g)).toHaveLength(2);
    expect(html).not.toContain('is-winner"');
    expect(html).not.toContain('is-loser"');
  });

  test('an undecided, unheld game still renders Release Hold, hidden', () => {
    const html = renderAdminTournament([game]);

    // The button must exist at load even with no hold: Undo applies the hold
    // server-side, and both the d-none toggle and the click handler act on
    // markup that was already there.
    expect(html.match(/release-hold-btn d-none/g)).toHaveLength(2);
  });

  test('a held, undecided game shows Release Hold', () => {
    const html = renderAdminTournament([{ ...game, manualHold: true }]);

    expect(html.match(/release-hold-btn"/g)).toHaveLength(2);
    expect(html).not.toMatch(/release-hold-btn d-none/);
  });

  test('a held game with a winner keeps Release Hold hidden', () => {
    const html = renderAdminTournament([
      { ...game, manualHold: true, winner: 22, winnerName: 'UNC' },
    ]);

    expect(html.match(/release-hold-btn d-none/g)).toHaveLength(2);
  });

  test('renders with no games (new tournament) without throwing', () => {
    expect(() => renderAdminTournament([])).not.toThrow();
  });
});
