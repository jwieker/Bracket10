import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('agent context in fresh checkouts', () => {
  let checkout;
  let script;

  beforeEach(() => {
    checkout = mkdtempSync(path.join(tmpdir(), 'bracket10-agent-context-'));
    mkdirSync(path.join(checkout, 'scripts'));
    script = path.join(checkout, 'scripts/agent-context.js');
    writeFileSync(path.join(checkout, 'package.json'), '{"type":"module"}');
    copyFileSync(
      new URL('../scripts/agent-context.js', import.meta.url),
      script,
    );
  });

  afterEach(() => {
    rmSync(checkout, { recursive: true, force: true });
  });

  it('works in a public clone with no private files or dependencies', () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: checkout,
      encoding: 'utf8',
    });

    expect(output).toContain('No additional checkout context');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('docs/GUIDE.md');
  });

  it('reads only its own checkout context when invoked from another checkout', () => {
    mkdirSync(path.join(checkout, 'docs/private'), { recursive: true });
    const context = '# Checkout guidance\nRead the local working agreements.\n';
    writeFileSync(
      path.join(checkout, 'docs/private/agent-context.md'),
      context,
    );

    const otherCheckout = path.join(checkout, 'other-checkout');
    mkdirSync(path.join(otherCheckout, 'docs/private'), { recursive: true });
    writeFileSync(
      path.join(otherCheckout, 'docs/private/agent-context.md'),
      'Wrong checkout context',
    );

    expect(
      execFileSync(process.execPath, [script], {
        cwd: otherCheckout,
        encoding: 'utf8',
      }),
    ).toBe(context);
  });
});
