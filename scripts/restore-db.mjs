/**
 * restore-db.mjs — Restores core root collections from databasebackup/ to Firestore
 *
 * Usage:
 *   GCP_PROJECT_ID=your-project-id node scripts/restore-db.mjs
 *   GCP_PROJECT_ID=your-project-id node scripts/restore-db.mjs --dry-run
 *   GCP_PROJECT_ID=your-project-id node scripts/restore-db.mjs --only=school
 *
 * For local emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8085 GCP_PROJECT_ID=local-dev node scripts/restore-db.mjs
 */

import { Firestore } from '@google-cloud/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '../databasebackup');

// ── CLI Args ──────────────────────────────────────────────────────────────────
const isDryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='))?.split('=')[1] ?? null;

// Core root collections we support restoring
const CORE_COLLECTIONS = ['school', 'conferences', 'regionID', 'groups'];

// Initialize Firestore
const projectId = process.env.GCP_PROJECT_ID;
if (!projectId && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Error: GCP_PROJECT_ID environment variable is required to run this script (unless FIRESTORE_EMULATOR_HOST is set).');
  process.exit(1);
}

const db = new Firestore(projectId ? { projectId } : {});

// Find the latest backup file for a given collection
function findLatestBackup(collection) {
  if (!fs.existsSync(BACKUP_DIR)) {
    throw new Error(`Backup directory not found at ${BACKUP_DIR}`);
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(`_${collection}.json`))
    .sort(); // Sort alphabetically (Apr22-2026_school.json, etc.)

  return files.at(-1) ? path.join(BACKUP_DIR, files.at(-1)) : null;
}

// Restore a single collection
async function restoreCollection(collection) {
  console.log(`\n── Restoring collection: "${collection}" ──`);

  const backupFilePath = findLatestBackup(collection);
  if (!backupFilePath) {
    console.log(`  ⚠ No backup files found for collection "${collection}". Skipping.`);
    return;
  }

  console.log(`  Using backup file: ${path.basename(backupFilePath)}`);

  const fileContent = fs.readFileSync(backupFilePath, 'utf8');
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    console.log(`  ⚠ Backup file is empty. Skipping.`);
    return;
  }

  console.log(`  Found ${lines.length} document(s) to restore.`);

  let batch = db.batch();
  let opCount = 0;
  let totalWritten = 0;
  const BATCH_LIMIT = 400; // Keep safely below Firestore's 500 limit

  for (const line of lines) {
    let docData;
    try {
      docData = JSON.parse(line);
    } catch (err) {
      console.error(`  ✗ Error parsing JSON line: "${line.substring(0, 100)}..."`, err);
      continue;
    }

    const { _id, ...cleanData } = docData;
    if (!_id) {
      console.error(`  ✗ Skipping document: missing "_id" property in backup line.`);
      continue;
    }

    const docRef = db.collection(collection).doc(String(_id));

    if (!isDryRun) {
      batch.set(docRef, cleanData);
      opCount++;

      if (opCount >= BATCH_LIMIT) {
        console.log(`  Writing batch of ${opCount} documents...`);
        await batch.commit();
        totalWritten += opCount;
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  // Commit any remaining operations in the final batch
  if (!isDryRun && opCount > 0) {
    console.log(`  Writing final batch of ${opCount} documents...`);
    await batch.commit();
    totalWritten += opCount;
  }

  if (isDryRun) {
    console.log(`  [DRY RUN] Would have written ${lines.length} document(s) to collection "${collection}".`);
  } else {
    console.log(`  ✅ Successfully restored ${totalWritten} document(s) to collection "${collection}".`);
  }
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`Database Restore Tool`);
  console.log(`Project ID: ${projectId || 'Local Emulator'}`);
  if (isDryRun) {
    console.log(`🔍 DRY RUN MODE — No actual writes will occur.`);
  }
  console.log(`======================================================`);

  const collectionsToRestore = onlyArg 
    ? CORE_COLLECTIONS.filter(c => c === onlyArg) 
    : CORE_COLLECTIONS;

  if (onlyArg && collectionsToRestore.length === 0) {
    console.error(`Error: Unsupported or invalid collection "${onlyArg}".`);
    console.error(`Supported collections: ${CORE_COLLECTIONS.join(', ')}`);
    process.exit(1);
  }

  for (const col of collectionsToRestore) {
    await restoreCollection(col);
  }

  console.log(`\n======================================================`);
  console.log(`Restore operation complete.`);
  console.log(`======================================================\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal restore error:', err);
  process.exit(1);
});
