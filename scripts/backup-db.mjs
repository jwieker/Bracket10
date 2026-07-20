import { Firestore } from '@google-cloud/firestore';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../databasebackup');

// Date prefix matching existing format: e.g. "Mar11-2026"
const now = new Date();
const month = now.toLocaleString('en-US', { month: 'short' });
const datePrefix = `${month}${now.getDate()}-${now.getFullYear()}`;

mkdirSync(OUTPUT_DIR, { recursive: true });

function writeCollection(name, docs) {
  const filePath = join(OUTPUT_DIR, `${datePrefix}_${name}.json`);
  const lines = docs.map((d) => JSON.stringify(d)).join('\n');
  writeFileSync(filePath, lines + '\n');
  console.log(`  ✅ ${name}: ${docs.length} docs → ${datePrefix}_${name}.json`);
}

async function backupCollection(collectionPath, outputName) {
  const snap = await db.collection(collectionPath).get();
  const docs = snap.docs.map((d) => {
    const data = { _id: d.id, ...d.data() };
    if ('email' in data) data.email = '';
    return data;
  });
  writeCollection(outputName, docs);
  return docs.length;
}

async function main() {
  console.log(
    `\nBacking up Firestore to databasebackup/ with prefix: ${datePrefix}\n`,
  );

  // ── Root collections ──────────────────────────────────────────────────────
  console.log('Root collections:');
  await backupCollection('school', 'school');
  await backupCollection('conferences', 'conferences');
  await backupCollection('groups', 'groups');
  await backupCollection('regionID', 'regionID');

  // ── Hierarchical tournament subcollections ────────────────────────────────
  const yearsSnap = await db.collection('tournaments').get();
  const years = yearsSnap.docs.map((d) => d.id).sort();
  console.log(`\nTournament years found: ${years.join(', ')}`);

  for (const year of years) {
    console.log(`\n  [${year}]`);
    const subcollections = ['regions', 'games', 'schoolRecords', 'entries'];
    for (const sub of subcollections) {
      await backupCollection(`tournaments/${year}/${sub}`, `${year}_${sub}`);
    }
  }

  console.log('\nBackup complete.\n');
}

main().catch(console.error);
