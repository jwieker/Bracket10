/**
 * buildEspnMap.js — One-time setup script to generate espnTeamMap.json
 *
 * Usage:
 *   node scripts/buildEspnMap.js [year]
 *
 * Arguments:
 *   year  - Tournament year to pull school records from (default: 2026)
 *
 * Dates fetched:
 *   Fetches both Round 1 days (March 19 & 20) to capture all 64 teams.
 *   Add more entries to TOURNAMENT_DATES if you need additional rounds.
 *
 * Output:
 *   src/config/espnTeamMap.json  — ESPN displayName → internal sID
 *
 * After running, manually check the "UNMATCHED" entries at the bottom of the file
 * and fill in the correct sID values before using the poller.
 */

import { db } from "../src/config/firestore.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// ── Args ──────────────────────────────────────────────────────────────────────

const yearArg = Number(process.argv[2] ?? 2026);

// Both Round 1 days — together they cover all 64 first-round teams
const TOURNAMENT_DATES = ["20260317", "20260318", "20260319", "20260320"];

// ── Fetch ESPN names ──────────────────────────────────────────────────────────

async function fetchEspnTeamNames(dateStr) {
  const url = `${ESPN_URL}?limit=200&dates=${dateStr}`;
  console.log(`Fetching ESPN scoreboard: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const data = await res.json();

  const names = new Set();
  for (const event of data?.events ?? []) {
    for (const comp of event?.competitions ?? []) {
      for (const c of comp?.competitors ?? []) {
        if (c?.team?.displayName) names.add(c.team.displayName);
      }
    }
  }
  return [...names].sort();
}

// ── Fetch schools from Firestore ──────────────────────────────────────────────

async function fetchSchools() {
  console.log("Fetching global school collection...");
  const snap = await db.collection("school").get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      sID: d.sid,
      nameNick: (d.nameNick ?? "").toLowerCase(),
      schoolName: (d.name ?? "").toLowerCase(),
      mascot: (d.mascot ?? "").toLowerCase(),
    };
  });
}

// ── Name matching ─────────────────────────────────────────────────────────────

/**
 * ESPN displayName = nameNick + " " + mascot (e.g. "Duke Blue Devils").
 * Match strategies in priority order:
 *   1. nameNick + mascot exact match  ("duke blue devils" === "duke" + " " + "blue devils")
 *   2. Exact nameNick match           ("uconn" === "uconn")
 *   3. displayName starts with nameNick ("duke blue devils".startsWith("duke"))
 *   4. Exact schoolName match
 *   5. schoolName keyword match
 */
function tryMatch(espnDisplayName, teams) {
  const lower = espnDisplayName.toLowerCase();

  // 1. nameNick + " " + mascot — the most reliable strategy
  let match = teams.find(
    (t) => t.nameNick && t.mascot && lower === `${t.nameNick} ${t.mascot}`
  );
  if (match) return match.sID;

  // 2. Exact nameNick match
  // match = teams.find((t) => t.nameNick && lower === t.nameNick);
  // if (match) return match.sID;

  // 3. displayName starts with nameNick (handles extra words like location prefixes)
  // match = teams.find((t) => t.nameNick && lower.startsWith(`${t.nameNick} `));
  // if (match) return match.sID;

  // 4. Exact schoolName match
  // match = teams.find((t) => t.schoolName && lower === t.schoolName);
  // if (match) return match.sID;

  // // 5. First significant word of schoolName appears in displayName
  // match = teams.find((t) => {
  //   if (!t.schoolName) return false;
  //   const firstWord = t.schoolName.split(" ")[0];
  //   return firstWord.length > 3 && lower.startsWith(firstWord);
  // });
  // if (match) return match.sID;

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const outPath = path.join(__dirname, "../src/config/espnTeamMap.json");

async function main() {
  console.log(`Building ESPN team map for year=${yearArg}, dates=${TOURNAMENT_DATES.join(", ")}\n`);

  // Fetch both Round 1 days in parallel alongside DB teams
  const [nameArrays, teams] = await Promise.all([
    Promise.all(TOURNAMENT_DATES.map(fetchEspnTeamNames)),
    fetchSchools(),
  ]);

  // Merge names from all dates into a single sorted unique set
  const espnNames = [...new Set(nameArrays.flat())].sort();

  console.log(`ESPN names found: ${espnNames.length} (across ${TOURNAMENT_DATES.length} date(s))`);
  console.log(`Schools in DB: ${teams.length}`);

  // Load existing map to preserve manual corrections
  let existing = {};
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    console.log(`Loaded existing map with ${Object.keys(existing).length} entries`);
  }

  // Only process ESPN names not already present in the file
  const newNames = espnNames.filter((name) => !(name in existing));
  console.log(`New ESPN names (not in existing map): ${newNames.length}\n`);

  const matched = {};
  const unmatched = [];

  for (const name of newNames) {
    const sID = tryMatch(name, teams);
    if (sID != null) {
      matched[name] = sID;
      console.log(`  ✓ "${name}" → sID ${sID}`);
    } else {
      unmatched.push(name);
      console.log(`  ✗ "${name}" → UNMATCHED`);
    }
  }

  // Merge: existing entries preserved, new ones appended
  const output = { ...existing, ...matched };
  for (const name of unmatched) {
    output[name] = null; // null = needs manual mapping
  }

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  Matched:   ${Object.keys(matched).length}`);
  console.log(`  Unmatched: ${unmatched.length} (set these to the correct sID manually)`);

  if (unmatched.length > 0) {
    console.log("\nUnmatched teams (edit espnTeamMap.json to fill these in):");
    unmatched.forEach((n) => console.log(`  "${n}"`));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
