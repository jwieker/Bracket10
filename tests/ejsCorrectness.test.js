import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Recursively find files in a directory matching a filter
function getFilesRecursively(dir, filter) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, filter));
    } else if (filter(filePath)) {
      results.push(filePath);
    }
  }
  return results;
}

// Allowed safe patterns for `<%-` in EJS
const ALLOWED_PATTERNS = [
  /include\(/, // Include partials
  /safeJson\(/, // Our safe global json helper
  /\?\s*'selected'\s*:\s*''/, // Safe selection attribute
  /\?\s*'disabled'\s*:\s*''/, // Safe disabled attribute
];

describe('EJS Views Correctness', () => {
  test('all raw output tags (<%-) use whitelisted safe operations to prevent XSS', () => {
    const viewsDir = path.resolve(__dirname, '../views');
    const ejsFiles = getFilesRecursively(viewsDir, (file) =>
      file.endsWith('.ejs'),
    );

    expect(ejsFiles.length).toBeGreaterThan(0);

    const violations = [];

    for (const file of ejsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        if (line.includes('<%-')) {
          // Check if this line matches any allowed pattern
          const isAllowed = ALLOWED_PATTERNS.some((pattern) =>
            pattern.test(line),
          );
          if (!isAllowed) {
            violations.push({
              file: path.relative(viewsDir, file),
              lineNum: idx + 1,
              content: line.trim(),
            });
          }
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `File: ${v.file}:${v.lineNum}\n  Content: ${v.content}`)
        .join('\n\n');
      throw new Error(
        `Found unsafe raw interpolation (<%-) in EJS views:\n\n${message}`,
      );
    }
  });
});
