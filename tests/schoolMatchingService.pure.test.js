import {
  matchTeam,
  matchSchoolsForEvents,
} from '../src/services/schoolMatchingService.js';

const allSchools = [
  { sid: 1, name: 'Duke', espn: { espnID: 150 } },
  { sid: 2, name: 'Kansas', espn: { espnID: 52 } },
  { sid: 3, name: 'Gonzaga', espn: { espnID: null } },
];

const teamMap = {
  Duke: 1,
  Kansas: 2,
  Gonzaga: 999, // stale mapping: no school has sid 999
};

// ---------------------------------------------------------------------------
// matchTeam
// ---------------------------------------------------------------------------

describe('matchTeam', () => {
  test('treats a TBD displayName as a placeholder, not unresolved', () => {
    const result = matchTeam(
      { espnId: null, displayName: 'TBD', seed: 11 },
      allSchools,
      teamMap,
    );
    expect(result).toEqual({
      espnId: null,
      displayName: 'TBD',
      seed: 11,
      sID: null,
      matchMethod: 'placeholder',
    });
  });

  test('treats a blank/missing displayName as a placeholder', () => {
    const result = matchTeam(
      { espnId: null, displayName: null, seed: 11 },
      allSchools,
      teamMap,
    );
    expect(result.matchMethod).toBe('placeholder');
  });

  test('matches by unique espnID first', () => {
    const result = matchTeam(
      { espnId: '150', displayName: 'Duke', seed: 5 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBe(1);
    expect(result.matchMethod).toBe('espnId');
  });

  test('falls back to the exact name map when espnId is absent', () => {
    const result = matchTeam(
      { espnId: null, displayName: 'Kansas', seed: 12 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBe(2);
    expect(result.matchMethod).toBe('nameMap');
  });

  test('a name-map sid that matches no current school is unresolved', () => {
    const result = matchTeam(
      { espnId: null, displayName: 'Gonzaga', seed: 1 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBeNull();
    expect(result.matchMethod).toBe('unresolved');
  });

  test('no espnId match and no name-map entry is unresolved', () => {
    const result = matchTeam(
      { espnId: null, displayName: 'Some New School', seed: 16 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBeNull();
    expect(result.matchMethod).toBe('unresolved');
  });

  test('an espnId claimed by more than one school is a conflict', () => {
    const dupeSchools = [
      ...allSchools,
      { sid: 4, name: 'Duke Dupe', espn: { espnID: 150 } },
    ];
    const result = matchTeam(
      { espnId: '150', displayName: 'Duke', seed: 5 },
      dupeSchools,
      teamMap,
    );
    expect(result.sID).toBeNull();
    expect(result.matchMethod).toBe('conflict');
  });

  test('espnId and name-map disagreeing on the sid is a conflict', () => {
    const disagreeingMap = { ...teamMap, Duke: 2 }; // maps Duke's name to Kansas's sid
    const result = matchTeam(
      { espnId: '150', displayName: 'Duke', seed: 5 },
      allSchools,
      disagreeingMap,
    );
    expect(result.sID).toBeNull();
    expect(result.matchMethod).toBe('conflict');
  });

  test('espnId and name-map agreeing on the sid is not a conflict', () => {
    const result = matchTeam(
      { espnId: '150', displayName: 'Duke', seed: 5 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBe(1);
    expect(result.matchMethod).toBe('espnId');
  });

  test('numeric-string espnId matches a school stored with a number espnID', () => {
    const result = matchTeam(
      { espnId: '52', displayName: 'Kansas', seed: 12 },
      allSchools,
      teamMap,
    );
    expect(result.sID).toBe(2);
    expect(result.matchMethod).toBe('espnId');
  });
});

// ---------------------------------------------------------------------------
// matchSchoolsForEvents
// ---------------------------------------------------------------------------

describe('matchSchoolsForEvents', () => {
  test('matches team1/team2 and rolls up diagnostics for unresolved/conflict teams', () => {
    const events = [
      {
        espnEventId: '1',
        team1: { espnId: '150', displayName: 'Duke', seed: 5 },
        team2: { espnId: null, displayName: 'Some New School', seed: 12 },
        winner: null,
      },
    ];

    const result = matchSchoolsForEvents(events, allSchools, teamMap);

    expect(result.events[0].team1.matchMethod).toBe('espnId');
    expect(result.events[0].team2.matchMethod).toBe('unresolved');
    expect(result.diagnostics).toEqual([
      {
        espnEventId: '1',
        reason:
          'team2 "Some New School" did not match an existing school by ESPN id or name map',
      },
    ]);
  });

  test('matches the winner field when present and passes null through otherwise', () => {
    const events = [
      {
        espnEventId: '1',
        team1: { espnId: '150', displayName: 'Duke', seed: 5 },
        team2: { espnId: '52', displayName: 'Kansas', seed: 12 },
        winner: { espnId: '150', displayName: 'Duke', seed: 5 },
      },
      {
        espnEventId: '2',
        team1: { espnId: '150', displayName: 'Duke', seed: 5 },
        team2: { espnId: '52', displayName: 'Kansas', seed: 12 },
        winner: null,
      },
    ];

    const result = matchSchoolsForEvents(events, allSchools, teamMap);

    expect(result.events[0].winner.sID).toBe(1);
    expect(result.events[1].winner).toBeNull();
  });

  test('a placeholder (TBD) team produces no diagnostic', () => {
    const events = [
      {
        espnEventId: '1',
        team1: { espnId: '150', displayName: 'Duke', seed: 11 },
        team2: { espnId: null, displayName: 'TBD', seed: 11 },
        winner: null,
      },
    ];

    const result = matchSchoolsForEvents(events, allSchools, teamMap);

    expect(result.diagnostics).toEqual([]);
    expect(result.events[0].team2.matchMethod).toBe('placeholder');
  });

  test('flags a conflict diagnostic distinctly from an unresolved one', () => {
    const dupeSchools = [
      ...allSchools,
      { sid: 4, name: 'Duke Dupe', espn: { espnID: 150 } },
    ];
    const events = [
      {
        espnEventId: '1',
        team1: { espnId: '150', displayName: 'Duke', seed: 5 },
        team2: { espnId: '52', displayName: 'Kansas', seed: 12 },
        winner: null,
      },
    ];

    const result = matchSchoolsForEvents(events, dupeSchools, teamMap);

    expect(result.diagnostics).toEqual([
      {
        espnEventId: '1',
        reason:
          'team1 "Duke" has conflicting school matches and needs admin review',
      },
    ]);
  });
});
