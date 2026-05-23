import { Firestore } from '@google-cloud/firestore';

const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID });

async function main() {
    // 1. Collect all valid school sIDs
    const schoolSnap = await db.collection('school').get();
    const validSIDs = new Set();
    for (const doc of schoolSnap.docs) {
        validSIDs.add(doc.id);
        validSIDs.add(String(parseInt(doc.id, 10)));
    }
    console.log(`Loaded ${schoolSnap.size} schools.`);

    // 2. Get all tournament years
    const yearsSnap = await db.collection('tournaments').get();
    const years = yearsSnap.docs.map(d => d.id);
    console.log(`Found tournament years: ${years.join(', ')}`);

    const issues = [];

    for (const year of years) {
        // 3a. Check schoolRecords
        const recordsSnap = await db.collection(`tournaments/${year}/schoolRecords`).get();
        console.log(`  [${year}] Checking ${recordsSnap.size} schoolRecords...`);
        for (const doc of recordsSnap.docs) {
            const { sID } = doc.data();
            if (sID !== undefined && !validSIDs.has(String(sID))) {
                issues.push({ year, collection: 'schoolRecords', docId: doc.id, sID });
            }
        }

        // 3b. Check entries picks
        const entriesSnap = await db.collection(`tournaments/${year}/entries`).get();
        console.log(`  [${year}] Checking ${entriesSnap.size} entries...`);
        for (const doc of entriesSnap.docs) {
            const { picks = [] } = doc.data();
            for (const pickSID of picks) {
                if (!validSIDs.has(String(pickSID))) {
                    issues.push({ year, collection: 'entries', docId: doc.id, sID: pickSID });
                }
            }
        }
    }

    // 4. Report
    const recordIssues = issues.filter(i => i.collection === 'schoolRecords');
    const entryIssues = issues.filter(i => i.collection === 'entries');

    console.log('\n=== schoolRecords ===');
    if (recordIssues.length === 0) {
        console.log('✅ All schoolRecords reference valid schools.');
    } else {
        console.log(`❌ ${recordIssues.length} broken reference(s):`);
        for (const issue of recordIssues) {
            console.log(`  tournaments/${issue.year}/schoolRecords/${issue.docId} → sID "${issue.sID}"`);
        }
    }

    console.log('\n=== entries picks ===');
    if (entryIssues.length === 0) {
        console.log('✅ All entries picks reference valid schools.');
    } else {
        console.log(`❌ ${entryIssues.length} broken reference(s):`);
        // Deduplicate: same sID might appear in many entries
        const byYear = {};
        for (const issue of entryIssues) {
            const key = `${issue.year}::${issue.sID}`;
            if (!byYear[key]) byYear[key] = { year: issue.year, sID: issue.sID, count: 0 };
            byYear[key].count++;
        }
        for (const { year, sID, count } of Object.values(byYear)) {
            console.log(`  [${year}] sID "${sID}" missing from school collection (appears in ${count} entries)`);
        }
        console.log(`\n  (${entryIssues.length} total broken pick references across all entries)`);
    }
}

main().catch(console.error);
