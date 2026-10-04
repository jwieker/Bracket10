import { readFileSync } from 'node:fs';

// This optional file is stripped by scripts/excluded-paths.sh in public snapshots.
// Resolve against this script so worktrees and callers in subdirectories stay local.
try {
  process.stdout.write(
    readFileSync(
      new URL('../docs/private/agent-context.md', import.meta.url),
      'utf8',
    ),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  process.stdout.write(
    'No additional checkout context. Follow AGENTS.md and docs/GUIDE.md.\n',
  );
}
