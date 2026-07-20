/**
 * buildFullD1Map.js — Extends espnTeamMap.json to cover all D-I teams
 *
 * The existing buildEspnMap.js only pulls teams that appear on the ESPN scoreboard
 * during tournament dates (64 teams). This script fetches ALL ~362 D-I teams from
 * the ESPN teams index and attempts to match them against the school collection.
 *
 * Match strategy (conservative by design):
 *   ONLY uses exact nameNick + mascot match (e.g. "Arkansas" + "Razorbacks" → "Arkansas Razorbacks").
 *   No fuzzy fallbacks — an uncertain match is worse than a null entry.
 *   Unmatched teams are written as null and must be filled in manually.
 *
 * Existing entries in espnTeamMap.json are NEVER modified. Only new ESPN display
 * names (not already present as keys) are added.
 *
 * Usage:
 *   node scripts/buildFullD1Map.js                # fetch all, match conservatively (requires Firestore)
 *   node scripts/buildFullD1Map.js --use-backup   # use local databasebackup/ instead of Firestore
 *   node scripts/buildFullD1Map.js --dry-run      # print results, don't write file
 *
 * After running, review the null entries at the bottom of espnTeamMap.json and
 * fill in the correct sID values manually for any teams you need.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.join(__dirname, '../src/config/espnTeamMap.json');
const ESPN_TEAMS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';

// ── CLI args ──────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');
const useBackup = process.argv.includes('--use-backup');

// ── Fetch all D-I teams from ESPN ─────────────────────────────────────────────

async function fetchAllEspnTeams() {
  console.log('Fetching all D-I teams from ESPN...');
  const res = await fetch(`${ESPN_TEAMS_URL}?limit=1000`);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();

  const teams = [];
  for (const item of data?.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    const t = item.team;
    if (t?.displayName) teams.push(t.displayName);
  }
  teams.sort();
  console.log(`  ESPN returned ${teams.length} D-I teams.\n`);
  return teams;
}

// ── Load schools from Firestore or local backup ───────────────────────────────

async function fetchSchools() {
  if (useBackup) {
    // Find the most recent school backup file
    const backupDir = path.join(__dirname, '../databasebackup');
    const backupFile = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('_school.json'))
      .sort()
      .at(-1);
    if (!backupFile)
      throw new Error('No school backup file found in databasebackup/');
    console.log(`Loading schools from backup: ${backupFile}`);
    const schools = fs
      .readFileSync(path.join(backupDir, backupFile), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const d = JSON.parse(line);
        return {
          sID: d.sid,
          nameNick: (d.nameNick ?? '').toLowerCase().trim(),
          mascot: (d.mascot ?? '').toLowerCase().trim(),
        };
      });
    console.log(`  Loaded ${schools.length} schools.\n`);
    return schools;
  }

  // Default: live Firestore
  const { db } = await import('../src/config/firestore.js');
  console.log('Loading school collection from Firestore...');
  const snap = await db.collection('school').get();
  const schools = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      sID: d.sid,
      nameNick: (d.nameNick ?? '').toLowerCase().trim(),
      mascot: (d.mascot ?? '').toLowerCase().trim(),
    };
  });
  console.log(`  Loaded ${schools.length} schools.\n`);
  return schools;
}

// ── Conservative match: nameNick + mascot only ────────────────────────────────
//
// ESPN displayName = nameNick + " " + mascot (e.g. "Duke Blue Devils").
// We only accept an exact case-insensitive match of both parts together.
// No partial matches, no fallbacks — accuracy over recall.

function tryMatch(espnDisplayName, schools) {
  const lower = espnDisplayName.toLowerCase().trim();
  const match = schools.find(
    (s) => s.nameNick && s.mascot && lower === `${s.nameNick} ${s.mascot}`,
  );
  return match?.sID ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isDryRun) console.log('🔍 DRY RUN — file will not be written.\n');

  // Load existing map — existing entries are never touched
  let existing = {};
  if (fs.existsSync(MAP_PATH)) {
    existing = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    console.log(
      `Loaded existing espnTeamMap.json: ${Object.keys(existing).length} entries.\n`,
    );
  }

  // Fetch ESPN teams and DB schools in parallel
  const [espnTeams, schools] = await Promise.all([
    fetchAllEspnTeams(),
    fetchSchools(),
  ]);

  // Only process teams not already in the map
  const newTeams = espnTeams.filter((name) => !(name in existing));
  console.log(`New ESPN teams not in existing map: ${newTeams.length}`);
  console.log(
    `(${espnTeams.length - newTeams.length} already present — skipping)\n`,
  );

  // Match
  const matched = {};
  const unmatched = [];

  for (const name of newTeams) {
    const sID = tryMatch(name, schools);
    if (sID != null) {
      matched[name] = sID;
      console.log(`  ✓  "${name}" → sID ${sID}`);
    } else {
      unmatched.push(name);
      console.log(`  ✗  "${name}" → no match`);
    }
  }

  // Summary
  console.log(
    '\n── Results ───────────────────────────────────────────────────',
  );
  console.log(
    `  Already in map (skipped): ${espnTeams.length - newTeams.length}`,
  );
  console.log(`  New matched:              ${Object.keys(matched).length}`);
  console.log(`  New unmatched (null):     ${unmatched.length}`);
  console.log(
    `  Match rate on new teams:  ${Math.round((Object.keys(matched).length / newTeams.length) * 100)}%`,
  );

  if (isDryRun) {
    console.log('\n[DRY RUN] No changes written.');
    process.exit(0);
  }

  // Merge and write
  // Order: existing entries first, then new matched, then nulls at the bottom
  const output = { ...existing, ...matched };
  for (const name of unmatched) {
    output[name] = null;
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${MAP_PATH}`);
  console.log(`  Total entries now: ${Object.keys(output).length}`);

  if (unmatched.length > 0) {
    console.log(`\nUnmatched teams (fill these in manually if needed):`);
    unmatched.forEach((n) => console.log(`  "${n}"`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
