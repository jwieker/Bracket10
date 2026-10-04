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

const viewsDir = path.resolve(__dirname, '../views');
const ejsFiles = getFilesRecursively(viewsDir, (file) => file.endsWith('.ejs'));

function cspViolations(content) {
  // Preserve line numbers while ignoring markup that never reaches the browser.
  const markup = content.replace(/<%#[\s\S]*?%>|<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  );
  // Quoted values and EJS expressions can contain >, including the nonce's %>.
  const tags = /<([a-z][\w:-]*)\b(?:<%[\s\S]*?%>|"[^"]*"|'[^']*'|[^'">])*>/gi;
  const violations = { nonce: [], handlers: [] };
  for (const match of markup.matchAll(tags)) {
    const [tag, name] = match;
    const attributes = [
      ...tag.matchAll(
        /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
      ),
    ];
    const location = `line ${markup.slice(0, match.index).split('\n').length}: ${tag}`;
    if (name.toLowerCase() === 'script') {
      const nonce = attributes.find(
        (attr) => attr[1].toLowerCase() === 'nonce',
      );
      if (
        !nonce ||
        !/^<%=\s*cspNonce\s*%>$/.test(nonce[2] ?? nonce[3] ?? nonce[4] ?? '')
      ) {
        violations.nonce.push(location);
      }
    }
    if (attributes.some((attr) => /^on[a-z]+$/i.test(attr[1]))) {
      violations.handlers.push(location);
    }
  }
  return violations;
}

// Collects every `kind` violation (nonce | handlers) across all views, flattened
// into `file:location` strings for a single, readable assertion failure.
function collectViolations(kind) {
  return ejsFiles.flatMap((file) =>
    cspViolations(fs.readFileSync(file, 'utf8'))[kind].map(
      (violation) => `${path.relative(viewsDir, file)}:${violation}`,
    ),
  );
}

describe('EJS Views Correctness', () => {
  test('every script tag binds its nonce to cspNonce', () => {
    expect(ejsFiles.length).toBeGreaterThan(0);
    expect(collectViolations('nonce')).toEqual([]);
  });

  test('no HTML tag has an inline event handler', () => {
    expect(ejsFiles.length).toBeGreaterThan(0);
    expect(collectViolations('handlers')).toEqual([]);
  });

  test('all raw output tags (<%-) use whitelisted safe operations to prevent XSS', () => {
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

describe('CSP guard detection', () => {
  test.each([
    '<script>alert(1)</script>',
    '<script src="/app.js"></script>',
    '<script nonce="fixed"></script>',
    '<script data-nonce="<%= cspNonce %>"></script>',
    '<script nonce="<%= otherNonce %>"></script>',
  ])('rejects a script without the request nonce: %s', (markup) => {
    expect(cspViolations(markup).nonce).toHaveLength(1);
  });

  test.each([
    '<button onclick="go()">Go</button>',
    "<input\n ONCHANGE = 'go()'>",
    '<input onfocus=go()>',
  ])('rejects an inline handler: %s', (markup) => {
    expect(cspViolations(markup).handlers).toHaveLength(1);
  });

  test('accepts multiline nonced scripts, delegated hooks, and comment examples', () => {
    const markup = `
      <%# <script></script> <button onclick="go()"> %>
      <!-- <script></script> <button onclick="go()"> -->
      <script
        src="/app.js"
        nonce='<%= cspNonce %>'></script>
      <script nonce="<%= cspNonce %>">
        // Replaces onclick="go()" with a delegated listener.
      </script>
      <button data-act="go" title="Example onclick='go()'">Go</button>
    `;
    expect(cspViolations(markup)).toEqual({ nonce: [], handlers: [] });
  });
});
