import { describe, test, expect } from 'vitest';
import safeJsonForScriptDefault, {
  safeJsonForScript,
} from '../src/utils/htmlSafe.js';

const LT = String.fromCharCode(0x3c); // <
const U2028 = String.fromCharCode(0x2028);
const U2029 = String.fromCharCode(0x2029);

describe('safeJsonForScript', () => {
  test('neutralizes a </script> breakout: no raw "<" survives', () => {
    const out = safeJsonForScript({
      x: '</script><img src=x onerror=alert(1)>',
    });
    expect(out).not.toContain(LT);
    expect(out).toContain('\\u003c/script\\u003e');
  });

  test('escapes <, >, & to their \\uXXXX form', () => {
    expect(safeJsonForScript('a & b > c')).toBe('"a \\u0026 b \\u003e c"');
  });

  test('escapes the U+2028 / U+2029 line separators (valid JSON, breaks JS strings)', () => {
    const out = safeJsonForScript(`x${U2028}y${U2029}z`);
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(out).not.toContain(U2028);
    expect(out).not.toContain(U2029);
  });

  test('output round-trips back to the original value via JSON.parse', () => {
    const input = {
      teams: ['A<b>', 'C&D', `sep${U2028}here`],
      n: 3,
      nested: { k: 'x</script>y' },
    };
    expect(JSON.parse(safeJsonForScript(input))).toEqual(input);
  });

  test('returns valid JS "null" for undefined (never a bare `undefined`)', () => {
    expect(safeJsonForScript(undefined)).toBe('null');
  });

  test('leaves safe payloads otherwise identical to JSON.stringify', () => {
    const value = { a: 1, b: 'plain text', c: [true, null, 2.5] };
    expect(safeJsonForScript(value)).toBe(JSON.stringify(value));
  });

  test('default export is the same function', () => {
    expect(safeJsonForScriptDefault).toBe(safeJsonForScript);
  });
});
