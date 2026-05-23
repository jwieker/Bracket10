/**
 * enrichEspnData.js — Fetches ESPN branding data and stores under school/{sID}/espn/data
 *
 * Pulls the following evergreen fields from ESPN's team API and merges them into
 * the school/{sID} document as a nested `espn` field:
 *
 *   espnID            ESPN's numeric team ID
 *   espnSlug          URL-friendly slug  (e.g. "arkansas-razorbacks")
 *   espnAbbreviation  Short ticker       (e.g. "ARK")
 *   espnShortName     Short display name (e.g. "Arkansas")
 *   primaryColor      Hex color string   (e.g. "a32136")
 *   alternateColor    Hex color string   (e.g. "ffffff")
 *   logoURL           Primary 500px logo CDN URL
 *   fetchedAt         ISO timestamp of when the data was written
 *
 * Usage:
 *   node scripts/enrichEspnData.js                          # all teams in espnTeamMap.json
 *   node scripts/enrichEspnData.js "Arkansas Razorbacks"    # single team by ESPN display name
 *   node scripts/enrichEspnData.js --dry-run                # preview without writing to DB
 *   node scripts/enrichEspnData.js "Duke Blue Devils" --dry-run
 *
 * The script checks whether school/{sID}/espn/data already exists before fetching.
 * Teams that already have ESPN data are skipped unless you pass --force.
 *   node scripts/enrichEspnData.js --force                  # re-fetch and overwrite all
 *   node scripts/enrichEspnData.js "Arkansas Razorbacks" --force
 */

import { db } from '../src/config/firestore.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ESPN_TEAMS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';
const ESPN_TEAM_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';

const MAP_PATH      = path.join(__dirname, '../src/config/espnTeamMap.json');
const OVERRIDE_PATH = path.join(__dirname, '../src/config/espnIDOverrides.json');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce  = args.includes('--force');
// Any non-flag arg is treated as the ESPN display name to run for a single team
const singleTeamName = args.find(a => !a.startsWith('--')) ?? null;

// ── Load espnTeamMap ──────────────────────────────────────────────────────────

function loadTeamMap() {
  if (!fs.existsSync(MAP_PATH)) {
    throw new Error(`espnTeamMap.json not found at ${MAP_PATH}`);
  }
  return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
}

function loadIDOverrides() {
  if (!fs.existsSync(OVERRIDE_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
  // Strip the _comment meta-key
  const { _comment: _, ...overrides } = raw;
  return overrides;
}

// ── Fetch all ESPN teams (displayName → ESPN team object) ─────────────────────

async function fetchEspnTeamsIndex() {
  console.log('Fetching ESPN teams index...');
  // ESPN paginates at 25 by default — request a large limit to get all D-I teams
  const url = `${ESPN_TEAMS_URL}?limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN teams index HTTP ${res.status}`);
  const data = await res.json();

  const index = {};
  for (const item of data?.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    const t = item.team;
    if (t?.displayName) index[t.displayName] = t;
  }
  console.log(`  Found ${Object.keys(index).length} teams in ESPN index.\n`);
  return index;
}

// ── Fetch full ESPN team detail by ESPN numeric ID ────────────────────────────

async function fetchEspnTeamDetail(espnID) {
  const url = `${ESPN_TEAM_URL}/${espnID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN team detail HTTP ${res.status} for espnID=${espnID}`);
  const data = await res.json();
  return data?.team ?? null;
}

// ── Extract the fields we care about ─────────────────────────────────────────

function extractEspnFields(teamDetail) {
  // Find the best 500px logo: prefer "default" (full-colour on white), fall back to first logo
  const logos = teamDetail.logos ?? [];
  const defaultLogo =
    logos.find(l => l.rel?.includes('default') && !l.rel?.includes('dark')) ??
    logos[0] ??
    null;

  return {
    espnID:           Number(teamDetail.id),
    espnSlug:         teamDetail.slug         ?? null,
    espnAbbreviation: teamDetail.abbreviation  ?? null,
    espnShortName:    teamDetail.shortDisplayName ?? null,
    primaryColor:     teamDetail.color         ?? null,
    alternateColor:   teamDetail.alternateColor ?? null,
    logoURL:          defaultLogo?.href        ?? null,
    fetchedAt:        new Date().toISOString(),
  };
}

// ── Check if ESPN data already exists in Firestore ────────────────────────────

async function hasEspnData(sID) {
  const snap = await db.collection('school').doc(String(sID)).get();
  return snap.exists && snap.data()?.espn != null;
}

// ── Write ESPN data to Firestore ──────────────────────────────────────────────

async function writeEspnData(sID, fields) {
  await db.collection('school').doc(String(sID)).set({ espn: fields }, { merge: true });
}

// ── Process a single team ─────────────────────────────────────────────────────

async function processTeam(displayName, sID, espnIndex, idOverrides) {
  console.log(`\n── ${displayName} (sID=${sID}) ──`);

  // 1. Look up this team in the ESPN index; fall back to espnIDOverrides.json
  const espnIndexEntry = espnIndex[displayName];
  let espnID;
  if (espnIndexEntry) {
    espnID = espnIndexEntry.id;
  } else if (idOverrides[displayName]) {
    espnID = String(idOverrides[displayName]);
    console.log(`  ℹ  Not in ESPN index — using ID override (espnID=${espnID})`);
  } else {
    console.log(`  ⚠  Not found in ESPN teams index — skipping.`);
    return { status: 'not_found' };
  }

  // 2. Check if data already exists (skip in dry-run — no DB connection needed)
  if (!isForce && !isDryRun) {
    const alreadyExists = await hasEspnData(sID);
    if (alreadyExists) {
      console.log(`  ✓  ESPN data already exists in DB — skipping. (use --force to overwrite)`);
      return { status: 'skipped' };
    }
  }

  // 3. Fetch full team detail from ESPN
  console.log(`  Fetching ESPN team detail (espnID=${espnID})...`);
  const detail = await fetchEspnTeamDetail(espnID);
  if (!detail) {
    console.log(`  ✗  ESPN returned no team detail — skipping.`);
    return { status: 'error' };
  }

  // 4. Extract fields
  const fields = extractEspnFields(detail);
  console.log(`  Extracted:`);
  console.log(`    espnID:           ${fields.espnID}`);
  console.log(`    espnSlug:         ${fields.espnSlug}`);
  console.log(`    espnAbbreviation: ${fields.espnAbbreviation}`);
  console.log(`    espnShortName:    ${fields.espnShortName}`);
  console.log(`    primaryColor:     #${fields.primaryColor}`);
  console.log(`    alternateColor:   #${fields.alternateColor}`);
  console.log(`    logoURL:          ${fields.logoURL}`);

  // 5. Write to DB (or dry-run)
  if (isDryRun) {
    console.log(`  [DRY RUN] Would write espn field to school/${sID}`);
  } else {
    await writeEspnData(sID, fields);
    console.log(`  ✅ Written espn field to school/${sID}`);
  }

  return { status: 'written', fields };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isDryRun) console.log('🔍 DRY RUN mode — no DB writes will occur.\n');
  if (isForce)  console.log('⚡ FORCE mode — existing ESPN data will be overwritten.\n');

  const teamMap    = loadTeamMap();
  const idOverrides = loadIDOverrides();

  // Determine which teams to process
  let teamsToProcess;
  if (singleTeamName) {
    if (!(singleTeamName in teamMap)) {
      console.error(`Error: "${singleTeamName}" not found in espnTeamMap.json`);
      console.error('Keys must match exactly (e.g. "Arkansas Razorbacks")');
      process.exit(1);
    }
    teamsToProcess = [[singleTeamName, teamMap[singleTeamName]]];
  } else {
    teamsToProcess = Object.entries(teamMap).filter(([, sID]) => sID !== null);
  }

  console.log(`Teams to process: ${teamsToProcess.length}`);

  // Fetch the ESPN teams index once, up front
  const espnIndex = await fetchEspnTeamsIndex();

  // Process each team
  const results = { written: 0, skipped: 0, not_found: 0, error: 0 };
  for (const [displayName, sID] of teamsToProcess) {
    const { status } = await processTeam(displayName, sID, espnIndex, idOverrides);
    results[status] = (results[status] ?? 0) + 1;
  }

  console.log('\n── Summary ───────────────────────────────────────────');
  if (isDryRun) console.log('  (DRY RUN — nothing was written)');
  console.log(`  Written:   ${results.written ?? 0}`);
  console.log(`  Skipped:   ${results.skipped ?? 0}  (already had ESPN data)`);
  console.log(`  Not found: ${results.not_found ?? 0}  (displayName not in ESPN index)`);
  console.log(`  Errors:    ${results.error ?? 0}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
