/**
 * seed-emulator.mjs — Seeds the Firestore emulator from data/seed/.
 *
 * Usage:
 *   node scripts/seed-emulator.mjs           # Seeds everything in data/seed/
 *
 * Top-level NDJSON files (one document per line, each line carries an `_id`):
 *   school.json, conferences.json, regionID.json, groups.json, entry.json
 *     → written to the matching root collection.
 *
 * Year-suffixed NDJSON files (e.g. games.2022.json, schoolRecord.2022.json):
 *   → written to the hierarchical per-year subcollections under tournaments/{year}/...
 *     The year is parsed from the filename. The collection name is the prefix.
 *     `schoolRecord` is pluralised to `schoolRecords` on write.
 */

import { Firestore } from '@google-cloud/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Emulator defaults ────────────────────────────────────────────────────────
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';
  console.log(
    `ℹ FIRESTORE_EMULATOR_HOST not set. Defaulting to: ${process.env.FIRESTORE_EMULATOR_HOST}`,
  );
}
if (!process.env.GCP_PROJECT_ID) {
  process.env.GCP_PROJECT_ID = 'local-dev';
  console.log(
    `ℹ GCP_PROJECT_ID not set. Defaulting to: ${process.env.GCP_PROJECT_ID}`,
  );
}

const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });

const SEED_DIR = path.join(__dirname, '../data/seed');

console.log(`\n======================================================`);
console.log(`Firestore Emulator Seeder`);
console.log(`Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);
console.log(`Project ID:    ${process.env.GCP_PROJECT_ID}`);
console.log(`Source:        ${SEED_DIR}`);
console.log(`======================================================\n`);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function commitBatch(operations, label) {
  if (operations.length === 0) return;
  const LIMIT = 400;
  let batch = db.batch();
  let count = 0;
  let totalBatches = 0;

  for (const op of operations) {
    op(batch);
    count++;
    if (count >= LIMIT) {
      await batch.commit();
      totalBatches++;
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
    totalBatches++;
  }
  console.log(
    `  ✅ Loaded ${operations.length} document(s) in ${totalBatches} batch(es) for "${label}"`,
  );
}

function readNdjson(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(
          `Failed to parse ${path.basename(filePath)} line ${i + 1}: ${err.message}`,
          { cause: err },
        );
      }
    });
}

// ── Top-level (root collection) seed ─────────────────────────────────────────

const ROOT_COLLECTIONS = [
  'school',
  'conferences',
  'regionID',
  'groups',
  'entry',
];

async function seedRootCollection(collection) {
  const filePath = path.join(SEED_DIR, `${collection}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ Skipping "${collection}": ${filePath} not found`);
    return;
  }
  const rows = readNdjson(filePath);
  const ops = [];
  for (const row of rows) {
    const { _id, ...payload } = row;
    if (!_id) {
      console.error(`  ✗ Missing "_id" in ${collection}.json. Skipping row.`);
      continue;
    }
    ops.push((batch) => {
      batch.set(db.collection(collection).doc(String(_id)), payload);
    });
  }
  await commitBatch(ops, collection);
}

// ── Year-suffixed (hierarchical subcollection) seed ──────────────────────────
//
// Filename convention: `<collection>.<year>.json` (e.g. games.2022.json).
// `schoolRecord` pluralises to `schoolRecords` on write (matches prod path).
// `games`       → tournaments/{year}/games/{_id}
// `schoolRecord`→ tournaments/{year}/schoolRecords/{_id}
// Other prefixes are written as-is under tournaments/{year}/{prefix}.

const SUBCOLLECTION_ALIASES = {
  schoolRecord: 'schoolRecords',
};

function discoverYearSuffixedFiles() {
  if (!fs.existsSync(SEED_DIR)) return [];
  const files = fs.readdirSync(SEED_DIR);
  const out = [];
  for (const f of files) {
    const m = f.match(/^([a-zA-Z]+)\.(\d{4})\.json$/);
    if (!m) continue;
    const [, prefix, year] = m;
    out.push({ file: f, prefix, year });
  }
  return out;
}

async function seedYearSuffixedFile({ file, prefix, year }) {
  const filePath = path.join(SEED_DIR, file);
  const rows = readNdjson(filePath);
  const collection = SUBCOLLECTION_ALIASES[prefix] || prefix;
  const ops = [];

  // Ensure the parent tournaments/{year} doc exists so years are queryable.
  ops.push((batch) => {
    batch.set(
      db.collection('tournaments').doc(String(year)),
      { year: Number(year) },
      { merge: true },
    );
  });

  for (const row of rows) {
    const { _id, ...payload } = row;
    if (!_id) {
      console.error(`  ✗ Missing "_id" in ${file}. Skipping row.`);
      continue;
    }
    ops.push((batch) => {
      batch.set(
        db
          .collection('tournaments')
          .doc(String(year))
          .collection(collection)
          .doc(String(_id)),
        payload,
      );
    });
  }
  await commitBatch(ops, `tournaments/${year}/${collection}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  for (const c of ROOT_COLLECTIONS) {
    await seedRootCollection(c);
  }
  for (const entry of discoverYearSuffixedFiles()) {
    await seedYearSuffixedFile(entry);
  }
  console.log(`\n======================================================`);
  console.log(`✅ Emulator seeding completed successfully!`);
  console.log(`======================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seeding error:', err);
  process.exit(1);
});
