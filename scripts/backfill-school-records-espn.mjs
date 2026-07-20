/**
 * backfill-school-records-espn.mjs
 *
 * Backfills espnID, logoUrl, primaryColor, and conferenceName onto all existing
 * schoolRecord documents across every tournament year.
 *
 * Context
 * -------
 * As of the optimize-db-queries refactor, these four fields are now written by
 * insertMultipleSchoolRecords / updateMultipleSchoolRecords at tournament setup
 * time. Existing records (e.g. 2026 tournament) were written before the change
 * and are missing these fields. Without them, the game view will fall back to
 * nulls for logos/colors/conference names.
 *
 * Field mapping
 * -------------
 * school.espn.espnID      → schoolRecord.espnID
 * school.espn.logoURL     → schoolRecord.logoUrl   (note: ESPN stores as logoURL,
 *                                                    we normalize to logoUrl)
 * school.espn.primaryColor → schoolRecord.primaryColor
 * conference shortName/name (via school.confID) → schoolRecord.conferenceName
 *
 * Usage
 * -----
 *   node scripts/backfill-school-records-espn.mjs          # dry run (safe, no writes)
 *   node scripts/backfill-school-records-espn.mjs --write  # execute writes
 *
 * Run this once after the tournament is over (or at any point before the next
 * tournament setup) to keep old years accurate.
 */

import { Firestore } from '@google-cloud/firestore';

const isDryRun = !process.argv.includes('--write');
const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });

const BATCH_SIZE = 400; // stay well under Firestore's 500-op limit

async function main() {
  if (isDryRun) {
    console.log('DRY RUN — pass --write to apply changes.\n');
  } else {
    console.log('WRITE MODE — changes will be committed to Firestore.\n');
  }

  // 1. Load all schools and conferences up front
  console.log('Fetching school and conference data...');
  const [schoolsSnap, conferencesSnap] = await Promise.all([
    db.collection('school').get(),
    db.collection('conferences').get(),
  ]);

  const schoolsMap = new Map();
  schoolsSnap.docs.forEach((doc) => {
    const d = doc.data();
    schoolsMap.set(String(d.sid), d);
  });

  const confNameMap = new Map();
  conferencesSnap.docs.forEach((doc) => {
    const d = doc.data();
    confNameMap.set(doc.id, d.shortName || d.name || null);
  });

  console.log(
    `  ${schoolsMap.size} schools, ${confNameMap.size} conferences loaded.\n`,
  );

  // 2. Enumerate all tournament years
  const tournamentsSnap = await db.collection('tournaments').get();
  const years = tournamentsSnap.docs.map((d) => d.id).sort();
  console.log(`Tournament years found: ${years.join(', ')}\n`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalMissingEspn = 0;

  for (const year of years) {
    console.log(`── Year ${year} ──`);
    const recordsSnap = await db
      .collection('tournaments')
      .doc(year)
      .collection('schoolRecords')
      .get();

    if (recordsSnap.empty) {
      console.log('  No schoolRecords — skipping.\n');
      continue;
    }

    // Collect records that need updating
    const toUpdate = [];
    for (const doc of recordsSnap.docs) {
      const d = doc.data();
      const school = schoolsMap.get(String(d.sID));
      if (!school) {
        console.log(
          `  WARN: no school found for sID=${d.sID} (doc ${doc.id}) — skipping`,
        );
        totalSkipped++;
        continue;
      }

      const espn = school.espn || {};
      const newEspnID = espn.espnID ?? null;
      const newLogoUrl = espn.logoURL ?? null; // ESPN stores as logoURL
      const newPrimaryColor = espn.primaryColor ?? null;
      const newConfName = confNameMap.get(school.confID) ?? null;

      // Check if any field needs updating
      const alreadyCurrent =
        d.espnID === newEspnID &&
        d.logoUrl === newLogoUrl &&
        d.primaryColor === newPrimaryColor &&
        d.conferenceName === newConfName;

      if (alreadyCurrent) {
        totalSkipped++;
        continue;
      }

      if (!newEspnID) totalMissingEspn++;

      toUpdate.push({
        ref: doc.ref,
        fields: {
          espnID: newEspnID,
          logoUrl: newLogoUrl,
          primaryColor: newPrimaryColor,
          conferenceName: newConfName,
        },
        docId: doc.id,
        sID: d.sID,
        schoolName: d.schoolName || d.nameNick || d.sID,
      });
    }

    console.log(
      `  ${recordsSnap.size} records: ${toUpdate.length} need update, ${recordsSnap.size - toUpdate.length} already current.`,
    );

    if (toUpdate.length === 0) {
      console.log();
      continue;
    }

    if (isDryRun) {
      toUpdate.forEach(({ docId, sID, schoolName, fields }) => {
        console.log(
          `  [DRY RUN] Would update ${docId} (sID=${sID}, ${schoolName})`,
        );
        console.log(
          `    espnID=${fields.espnID}, logoUrl=${fields.logoUrl}, primaryColor=${fields.primaryColor}, conferenceName=${fields.conferenceName}`,
        );
      });
    } else {
      // Write in batches
      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach(({ ref, fields }) => batch.update(ref, fields));
        await batch.commit();
        console.log(
          `  Written batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs)`,
        );
      }
    }

    totalUpdated += toUpdate.length;
    console.log();
  }

  console.log('── Summary ──');
  console.log(`  Records updated:           ${totalUpdated}`);
  console.log(`  Records already current:   ${totalSkipped}`);
  console.log(`  Records with no ESPN data: ${totalMissingEspn}`);
  if (totalMissingEspn > 0) {
    console.log(
      '  NOTE: Run scripts/enrichEspnData.js to populate ESPN data for those schools,',
    );
    console.log('        then re-run this script.');
  }
  if (isDryRun && totalUpdated > 0) {
    console.log('\nRe-run with --write to apply these changes.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
