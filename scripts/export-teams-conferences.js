import { db } from '../src/config/firestore.js';
import fs from 'fs';
import path from 'path';

//to use this script, run the following command:
//node scripts/export-teams-conferences.js

async function exportTeams() {
  console.log(`Exporting all schools and their conferences...`);

  // 1. Get conferences
  const confSnap = await db.collection('conferences').get();
  const confMap = new Map();
  confSnap.docs.forEach((doc) => confMap.set(doc.id, doc.data())); // doc.id is slug

  // 2. Get all schools
  const schoolsSnap = await db.collection('school').get();

  if (schoolsSnap.empty) {
    console.log(`No schools found.`);
    return;
  }

  const output = [];
  // CSV Header
  output.push('School Name,Nickname,Mascot,Conference');

  // Map to array and sort by Name
  const schools = schoolsSnap.docs.map((doc) => doc.data());
  schools.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  schools.forEach((school) => {
    let confName = 'Unknown';
    if (school.confID) {
      const conf = confMap.get(school.confID);
      if (conf) {
        confName = conf.name;
      } else {
        confName = school.confID; // fallback to slug if full name not found
      }
    }

    const schoolName = school.name || '';
    const nameNick = school.nameNick || '';
    const mascot = school.mascot || '';

    // Escape quotes and wrap in quotes for CSV
    const escapeCSV = (str) => `"${String(str).replace(/"/g, '""')}"`;

    output.push(
      `${escapeCSV(schoolName)},${escapeCSV(nameNick)},${escapeCSV(mascot)},${escapeCSV(confName)}`,
    );
  });

  const outPath = path.join(process.cwd(), `all-schools-conferences.csv`);
  fs.writeFileSync(outPath, output.join('\n'));
  console.log(`✅ Exported ${schools.length} schools to ${outPath}`);
}

exportTeams().catch((err) => {
  console.error('Error exporting teams:', err);
  process.exit(1);
});
