import { extractPicks } from '../src/utils/entryPicksUtils.js';
import { ValidationError } from '../src/utils/errors.js';

// extractPicks parses the 10 user-submitted `teamSelect{i}` fields (used by
// registrationController, selfServiceController, adminEntryController) into
// parallel id/name arrays. It's request-shape parsing on untrusted input, so
// every rejection branch and the happy path are pinned here.

function body(picks) {
  // picks: { 1: 'value', 3: 'value', ... } → { teamSelect1: ..., teamSelect3: ... }
  const out = {};
  for (const [i, v] of Object.entries(picks)) out[`teamSelect${i}`] = v;
  return out;
}

describe('extractPicks — happy path', () => {
  test('parses sID/name pairs into parallel arrays', () => {
    const { picksIds, picksNames } = extractPicks(
      body({ 1: '12, Duke', 2: '34, Kansas' }),
    );
    expect(picksIds).toEqual([12, 34]);
    expect(picksNames).toEqual(['Duke', 'Kansas']);
  });

  test('skips empty / absent slots and keeps the rest in order', () => {
    const { picksIds, picksNames } = extractPicks(
      body({ 1: '12, Duke', 2: '', 5: '99, UConn' }),
    );
    expect(picksIds).toEqual([12, 99]);
    expect(picksNames).toEqual(['Duke', 'UConn']);
  });

  test('an empty body yields empty arrays', () => {
    expect(extractPicks({})).toEqual({ picksIds: [], picksNames: [] });
  });

  test('trims surrounding whitespace on both id and name', () => {
    const { picksIds, picksNames } = extractPicks(body({ 1: ' 12 ,  Duke ' }));
    expect(picksIds).toEqual([12]);
    expect(picksNames).toEqual(['Duke']);
  });
});

describe('extractPicks — ", " inside the team name', () => {
  test('a name containing ", " is preserved (split on first separator only)', () => {
    // Regression for #296: the old split(", ") + length===2 check rejected this.
    const { picksIds, picksNames } = extractPicks(
      body({ 1: '7, Texas A&M, Corpus Christi' }),
    );
    expect(picksIds).toEqual([7]);
    expect(picksNames).toEqual(['Texas A&M, Corpus Christi']);
  });

  test('a name with several ", " keeps the entire tail (only the first is the boundary)', () => {
    // Pins the "first separator only" invariant against a regression that
    // splits on every ", " (e.g. split(/, /, 2)) and silently drops the tail.
    const { picksIds, picksNames } = extractPicks(body({ 1: '7, A, B, C' }));
    expect(picksIds).toEqual([7]);
    expect(picksNames).toEqual(['A, B, C']);
  });
});

describe('extractPicks — rejections', () => {
  test('non-string value throws ValidationError on the field', () => {
    expect(() => extractPicks({ teamSelect1: 12 })).toThrow(ValidationError);
    try {
      extractPicks({ teamSelect1: 12 });
    } catch (e) {
      expect(e.field).toBe('teamSelect1');
    }
  });

  test('missing separator (no ", ") is malformed', () => {
    expect(() => extractPicks(body({ 1: '12-Duke' }))).toThrow(/malformed/);
  });

  test('a leading ", " (no id before the separator) is malformed, not "invalid team ID"', () => {
    expect(() => extractPicks(body({ 1: ', Duke' }))).toThrow(/malformed/);
  });

  test('non-numeric id is rejected', () => {
    expect(() => extractPicks(body({ 1: 'abc, Duke' }))).toThrow(
      /invalid team ID/,
    );
  });

  test('zero / negative id is rejected', () => {
    expect(() => extractPicks(body({ 1: '0, Duke' }))).toThrow(
      /invalid team ID/,
    );
    expect(() => extractPicks(body({ 1: '-3, Duke' }))).toThrow(
      /invalid team ID/,
    );
  });

  test('empty name is rejected', () => {
    expect(() => extractPicks(body({ 1: '12, ' }))).toThrow(
      /invalid team name/,
    );
  });

  test('name longer than 128 chars is rejected', () => {
    expect(() => extractPicks(body({ 1: `12, ${'x'.repeat(129)}` }))).toThrow(
      /invalid team name/,
    );
  });

  test('a 128-char name is accepted (boundary)', () => {
    const { picksNames } = extractPicks(body({ 1: `12, ${'x'.repeat(128)}` }));
    expect(picksNames[0]).toHaveLength(128);
  });
});
