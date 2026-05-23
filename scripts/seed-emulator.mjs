/**
 * seed-emulator.mjs — Seeds the Firestore emulator with NCAA D-I teams or test fixtures
 *
 * Usage:
 *   node scripts/seed-emulator.mjs           # Seeds real NCAA D-I schools & conferences (PII-free)
 *   node scripts/seed-emulator.mjs --test    # Seeds synthetic mock fixtures (from datafortests/)
 */

import { Firestore } from '@google-cloud/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Set Emulator Default ──────────────────────────────────────────────────────
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';
  console.log(`ℹ FIRESTORE_EMULATOR_HOST not set. Defaulting to: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}
if (!process.env.GCP_PROJECT_ID) {
  process.env.GCP_PROJECT_ID = 'local-dev';
  console.log(`ℹ GCP_PROJECT_ID not set. Defaulting to: ${process.env.GCP_PROJECT_ID}`);
}

const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });

// ── Args ──────────────────────────────────────────────────────────────────────
const isTestMode = process.argv.includes('--test');

// ── Folders & Collections ─────────────────────────────────────────────────────
const SEED_DIR = isTestMode 
  ? path.join(__dirname, '../datafortests') 
  : path.join(__dirname, '../data/seed');

console.log(`\n======================================================`);
console.log(`Firestore Emulator Seeder`);
console.log(`Target: ${isTestMode ? 'Synthetic Test Fixtures' : 'Real D-I NCAA Seed Data'}`);
console.log(`Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);
console.log(`Project ID: ${process.env.GCP_PROJECT_ID}`);
console.log(`Source Folder: ${SEED_DIR}`);
console.log(`======================================================\n`);

// Helper to commit operations in safe chunks
async function commitBatch(operations, label) {
  if (operations.length === 0) return;
  
  let batch = db.batch();
  let count = 0;
  let totalBatches = 0;
  const LIMIT = 400;

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

  console.log(`  ✅ Loaded ${operations.length} document(s) in ${totalBatches} batch(es) for "${label}"`);
}

// ── Production Seed (NDJSON Format) ──────────────────────────────────────────
async function seedProductionData() {
  const collections = ['school', 'conferences', 'regionID', 'groups', 'entry'];

  for (const col of collections) {
    const filePath = path.join(SEED_DIR, `${col}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ Skipping "${col}": Seed file not found at ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const ops = [];

    for (const line of lines) {
      let docData;
      try {
        docData = JSON.parse(line);
      } catch (err) {
        console.error(`  ✗ Error parsing line in "${col}.json":`, err.message);
        continue;
      }

      const { _id, ...cleanData } = docData;
      if (!_id) {
        console.error(`  ✗ Missing "_id" in seed record for "${col}". Skipping.`);
        continue;
      }

      ops.push((batch) => {
        batch.set(db.collection(col).doc(String(_id)), cleanData);
      });
    }

    await commitBatch(ops, col);
  }
}

// ── Test Fixtures Seed (Standard JSON Array Format) ──────────────────────────
async function seedTestFixtures() {
  const files = ['school', 'regionID', 'groups', 'entry', 'games', 'schoolRecord'];

  for (const name of files) {
    const filePath = path.join(SEED_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ Skipping "${name}": Fixture file not found at ${filePath}`);
      continue;
    }

    const items = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ops = [];

    for (const doc of items) {
      let collectionName = name;
      let docId;

      // Map file to correct collection and document ID
      if (name === 'school') {
        docId = String(doc.sid);
      } else if (name === 'regionID') {
        docId = String(doc.regionName);
      } else if (name === 'groups') {
        docId = String(doc.name);
      } else if (name === 'entry') {
        // Test entries use "year:entryId" hierarchical or "entryId" flat
        docId = String(doc.id);
      } else if (name === 'games') {
        // Write to both tournaments hierarchical collection and root legacy games collection
        const year = doc.year || 2024;
        ops.push((batch) => {
          batch.set(db.collection('tournaments').doc(String(year)).collection('games').doc(String(doc.gameID)), doc);
        });
        collectionName = 'games';
        docId = `${year}_${doc.gameID}`;
      } else if (name === 'schoolRecord') {
        const year = doc.year || 2024;
        const regionID = doc.regionID || 1;
        const seed = doc.seed || 16;
        const canonicalId = `${regionID}_${seed}`;
        
        ops.push((batch) => {
          batch.set(db.collection('tournaments').doc(String(year)).collection('schoolRecords').doc(canonicalId), doc);
        });
        collectionName = 'schoolRecord';
        docId = `${year}_${canonicalId}`;
      }

      if (!docId) {
        console.error(`  ✗ Could not determine document ID for fixture "${name}". Skipping.`);
        continue;
      }

      ops.push((batch) => {
        batch.set(db.collection(collectionName).doc(docId), doc);
      });
    }

    await commitBatch(ops, name);
  }
}

async function main() {
  if (isTestMode) {
    await seedTestFixtures();
  } else {
    await seedProductionData();
  }

  console.log(`\n======================================================`);
  console.log(`✅ Emulator seeding operation completed successfully!`);
  console.log(`======================================================\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Seeding error:', err);
  process.exit(1);
});
