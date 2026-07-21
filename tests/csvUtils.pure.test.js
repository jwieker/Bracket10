import { toCSVRow } from '../src/utils/csvUtils.js';

// Guards the formula-/CSV-injection defense behind the `getFullGridCSV`
// export (src/controllers/resultsController.js). The export feeds
// user-controlled cells (entry "person" and "teamName") into a CSV that
// gets opened in Excel/Sheets, so the neutralization here is a security
// control, not cosmetics — hence the explicit coverage.

describe('toCSVRow — formula neutralization', () => {
  test.each([
    ['=cmd', "'=cmd"],
    ['+1', "'+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tlead-tab', "'\tlead-tab"],
  ])(
    'prefixes a leading formula trigger %j with a single quote',
    (input, expected) => {
      // single cell, no comma/quote/newline → emitted bare (just the ' prefix).
      // (\t is a trigger but is NOT in the quote-check, so it stays bare.)
      expect(toCSVRow([input])).toBe(expected);
    },
  );

  test('a leading CR is neutralized AND quoted (CR forces quoting)', () => {
    expect(toCSVRow(['\rlead-cr'])).toBe('"\'\rlead-cr"');
  });

  test('only the leading character triggers neutralization', () => {
    // an = in the middle is harmless; no prefix, no quoting needed
    expect(toCSVRow(['a=b'])).toBe('a=b');
  });

  test('plain text is passed through untouched', () => {
    expect(toCSVRow(['Duke'])).toBe('Duke');
  });
});

describe('toCSVRow — quoting', () => {
  test('cells with a comma are wrapped in quotes', () => {
    expect(toCSVRow(['a,b'])).toBe('"a,b"');
  });

  test('inner double-quotes are doubled and the cell is wrapped', () => {
    expect(toCSVRow(['she said "hi"'])).toBe('"she said ""hi"""');
  });

  test('newline and carriage-return cells are quoted', () => {
    expect(toCSVRow(['a\nb'])).toBe('"a\nb"');
    expect(toCSVRow(['a\rb'])).toBe('"a\rb"');
  });

  test('formula neutralization runs BEFORE quoting (=1,2 → "\'=1,2")', () => {
    // The leading-= gets the ' prefix first, then the comma forces quoting.
    // Quoting alone would NOT stop Excel from evaluating the formula.
    expect(toCSVRow(['=1,2'])).toBe('"\'=1,2"');
  });
});

describe('toCSVRow — nullish and non-string cells', () => {
  test('null and undefined become empty cells', () => {
    expect(toCSVRow([null, undefined])).toBe(',');
  });

  test('numbers are stringified', () => {
    expect(toCSVRow([0, 42])).toBe('0,42');
  });

  test('a whole row joins cells with commas', () => {
    expect(toCSVRow(['Rank', 'Entry', 'Team'])).toBe('Rank,Entry,Team');
  });
});

describe('toCSVRow — negative-number caveat (documented, intentional)', () => {
  // A leading "-" is a formula trigger, so a numeric -5 is neutralized to '-5.
  // This is acceptable for getFullGridCSV: every numeric column it emits
  // (rank, points, teams remaining, max score, pick indices) is non-negative;
  // the only cells that could legitimately start with "-" are the
  // user-supplied Entry/Team names, where neutralization is the desired
  // behavior. If a future export column carries genuine negative numerics,
  // it must be excluded from neutralization or formatted before this point.
  test('a negative number string is neutralized (known trade-off)', () => {
    expect(toCSVRow(['-5'])).toBe("'-5");
  });

  test('a negative number passed as a JS number is likewise neutralized', () => {
    expect(toCSVRow([-5])).toBe("'-5");
  });
});
