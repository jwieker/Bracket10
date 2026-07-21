import fs from 'node:fs';
import path from 'node:path';

// #339 — integrity invariants for the hand-edited season team map.
//
// src/config/espnTeamMap.json is consumed raw by pollService: a string-typed
// sID is silently dropped by the `typeof winnerSID === "number"` check, two
// display names mapped to the same sID can match the WRONG unresolved DB game
// (`${minSID}-${maxSID}` key), and JSON.parse keeps only the last of any
// duplicated key with no error. Each of those is a silent live-poll scoring
// corruption; these tests turn them into CI failures the day the map is edited.

const mapPath = path.join(process.cwd(), 'src/config/espnTeamMap.json');
const rawText = fs.readFileSync(mapPath, 'utf8');
const teamMap = JSON.parse(rawText);

describe('espnTeamMap.json integrity', () => {
  test('every value is null or a positive integer (strings would be silently dropped by the poll)', () => {
    const offenders = Object.entries(teamMap).filter(
      ([, sID]) => !(sID === null || (Number.isInteger(sID) && sID > 0)),
    );
    expect(offenders).toEqual([]);
  });

  test('no two display names map to the same sID (a duplicate can record the wrong winner)', () => {
    const bySID = new Map();
    for (const [name, sID] of Object.entries(teamMap)) {
      if (sID === null) continue;
      if (!bySID.has(sID)) bySID.set(sID, []);
      bySID.get(sID).push(name);
    }
    const duplicates = [...bySID.entries()].filter(
      ([, names]) => names.length > 1,
    );
    expect(duplicates).toEqual([]);
  });

  test('no duplicate JSON keys (JSON.parse keeps only the last one, invisibly)', () => {
    // Count raw key occurrences in the file text; a duplicated key parses to a
    // single entry, so raw count > parsed count reveals the duplicate.
    const rawKeyCount = (rawText.match(/^\s*"(?:[^"\\]|\\.)*"\s*:/gm) || [])
      .length;
    expect(rawKeyCount).toBe(Object.keys(teamMap).length);
  });

  test('every key is a non-empty trimmed string (matching is byte-exact against ESPN display names)', () => {
    const offenders = Object.keys(teamMap).filter(
      (key) => key.length === 0 || key !== key.trim(),
    );
    expect(offenders).toEqual([]);
  });
});
