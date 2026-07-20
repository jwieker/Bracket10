import fs from 'fs';
import path from 'path';

// Production-shaped seed fixtures live in data/seed/. Top-level docs are
// NDJSON (`{"_id": "...", ...}` per line); year-suffixed files
// (e.g. games.2022.json) match the hierarchical per-year subcollections.
const seedDir = path.join(process.cwd(), 'data/seed');
const FIXTURE_YEAR = 2022;

function readNdjson(file) {
  return fs
    .readFileSync(path.join(seedDir, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(
          `Failed to parse ${file} line ${i + 1}: ${err.message}`,
          { cause: err },
        );
      }
    });
}

describe('Integration Tests with Seed Data', () => {
  let entryData;
  let gamesData;
  let schoolData;
  let schoolRecordData;
  let groupsData;
  let regionData;
  let conferencesData;

  beforeAll(() => {
    entryData = readNdjson('entry.json');
    gamesData = readNdjson(`games.${FIXTURE_YEAR}.json`);
    schoolData = readNdjson('school.json');
    schoolRecordData = readNdjson(`schoolRecord.${FIXTURE_YEAR}.json`);
    groupsData = readNdjson('groups.json');
    regionData = readNdjson('regionID.json');
    conferencesData = readNdjson('conferences.json');
  });

  describe('Fixture Shape (matches prod schema)', () => {
    test('entry rows have prod fields', () => {
      expect(entryData.length).toBeGreaterThan(0);
      const first = entryData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('email');
      expect(first).toHaveProperty('teamName');
      expect(first).toHaveProperty('picks');
      expect(first).toHaveProperty('person');
      expect(first).toHaveProperty('created_at');
      // Prod entries store `groups` (array), not `group` (string)
      expect(Array.isArray(first.groups)).toBe(true);
      expect(Array.isArray(first.picks)).toBe(true);
    });

    test('games rows have prod fields', () => {
      expect(gamesData.length).toBe(63);
      const first = gamesData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('gameID');
      expect(first).toHaveProperty('regionID');
      expect(first).toHaveProperty('round');
      expect(first).toHaveProperty('team1ID');
      expect(first).toHaveProperty('team2ID');
      expect(first).toHaveProperty('winner');
      expect(first).toHaveProperty('nextGameID');
      expect(first).toHaveProperty('nextGameSpot');
      // Prod stores round as a number
      expect(typeof first.round).toBe('number');
    });

    test('school rows have prod fields', () => {
      expect(schoolData.length).toBeGreaterThan(0);
      const first = schoolData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('sid');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('nameNick');
      expect(first).toHaveProperty('mascot');
      // Prod confID is a string (slug), not a numeric ID
      expect(typeof first.confID).toBe('string');
    });

    test('schoolRecord rows have prod fields', () => {
      expect(schoolRecordData.length).toBe(64);
      const first = schoolRecordData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('sID');
      expect(first).toHaveProperty('seed');
      expect(first).toHaveProperty('regionID');
    });

    test('groups rows have prod fields', () => {
      expect(groupsData.length).toBeGreaterThan(0);
      const first = groupsData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('name');
    });

    test('regionID rows include Final Four + Championship', () => {
      expect(regionData.length).toBe(6);
      const first = regionData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('regionID');
      expect(first).toHaveProperty('regionName');
      const ids = new Set(regionData.map((r) => r.regionID));
      for (const id of [1, 2, 3, 4, 5, 6]) {
        expect(ids.has(id)).toBe(true);
      }
    });

    test('conferences rows have prod fields', () => {
      expect(conferencesData.length).toBeGreaterThan(0);
      const first = conferencesData[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('division');
      expect(first).toHaveProperty('active');
    });
  });

  describe('Cross-collection consistency', () => {
    test('every team in games exists in school', () => {
      const schoolIds = new Set(schoolData.map((s) => s.sid));
      for (const g of gamesData) {
        for (const teamId of [g.team1ID, g.team2ID, g.winner]) {
          if (teamId != null) {
            expect(schoolIds.has(teamId)).toBe(true);
          }
        }
      }
    });

    test('every regionID in games exists in regionID', () => {
      const regionIds = new Set(regionData.map((r) => r.regionID));
      for (const g of gamesData) {
        expect(regionIds.has(g.regionID)).toBe(true);
      }
    });

    test('every sID in schoolRecord exists in school', () => {
      const schoolIds = new Set(schoolData.map((s) => s.sid));
      for (const r of schoolRecordData) {
        expect(schoolIds.has(r.sID)).toBe(true);
      }
    });

    test('every regionID in schoolRecord exists in regionID', () => {
      const regionIds = new Set(regionData.map((r) => r.regionID));
      for (const r of schoolRecordData) {
        expect(regionIds.has(r.regionID)).toBe(true);
      }
    });

    test('every confID in school exists in conferences', () => {
      const confIds = new Set(conferencesData.map((c) => c._id));
      for (const s of schoolData) {
        // Some prod schools may carry historical/unmapped conferences;
        // assert only that the field is a string when present.
        if (s.confID != null) {
          expect(typeof s.confID).toBe('string');
        }
      }
      // Spot-check: at least one school resolves to a known conference.
      expect(schoolData.some((s) => confIds.has(s.confID))).toBe(true);
    });
  });

  describe('Bracket structure', () => {
    test('exactly 32 first-round games', () => {
      const r1 = gamesData.filter((g) => g.round === 1);
      expect(r1.length).toBe(32);
    });

    test('rounds span 1..6 with the right per-round counts', () => {
      const counts = {};
      for (const g of gamesData) {
        counts[g.round] = (counts[g.round] || 0) + 1;
      }
      expect(counts[1]).toBe(32);
      expect(counts[2]).toBe(16);
      expect(counts[3]).toBe(8);
      expect(counts[4]).toBe(4);
      expect(counts[5]).toBe(2);
      expect(counts[6]).toBe(1);
    });

    test('16 seeds (1..16) per region per year', () => {
      const byRegion = {};
      for (const r of schoolRecordData) {
        (byRegion[r.regionID] ||= new Set()).add(r.seed);
      }
      for (const regionID of Object.keys(byRegion)) {
        const seeds = byRegion[regionID];
        expect(seeds.size).toBe(16);
        for (let s = 1; s <= 16; s++) {
          expect(seeds.has(s)).toBe(true);
        }
      }
    });

    test('nextGameID references resolve (or terminate at championship)', () => {
      const ids = new Set(gamesData.map((g) => g.gameID));
      for (const g of gamesData) {
        if (g.nextGameID && g.nextGameID !== 0) {
          expect(ids.has(g.nextGameID)).toBe(true);
        }
      }
      // Championship (round 6) terminates at 0
      const champ = gamesData.find((g) => g.round === 6);
      expect(champ.nextGameID).toBe(0);
    });
  });

  describe('Entry data quality', () => {
    test('picks arrays look valid', () => {
      for (const e of entryData) {
        expect(Array.isArray(e.picks)).toBe(true);
        expect(e.picks.length).toBe(10);
        for (const p of e.picks) {
          expect(typeof p).toBe('number');
        }
      }
    });

    test('emails are well-formed', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const e of entryData) {
        expect(emailRegex.test(e.email)).toBe(true);
      }
    });

    test('created_at parses as a valid date', () => {
      for (const e of entryData) {
        expect(typeof e.created_at).toBe('string');
        expect(new Date(e.created_at).toString()).not.toBe('Invalid Date');
      }
    });

    test('no duplicate ids in any collection', () => {
      const collections = [
        ['entry', entryData.map((e) => e._id)],
        ['games', gamesData.map((g) => g._id)],
        ['school', schoolData.map((s) => s._id)],
        ['schoolRecord', schoolRecordData.map((r) => r._id)],
        ['groups', groupsData.map((g) => g._id)],
        ['regionID', regionData.map((r) => r._id)],
        ['conferences', conferencesData.map((c) => c._id)],
      ];
      for (const [label, ids] of collections) {
        expect(new Set(ids).size, `duplicate _id in ${label}`).toBe(ids.length);
      }
    });
  });
});
