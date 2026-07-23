# Contributing to Bracket 10

Thanks for your interest in contributing. This is a small, opinionated project — a self-hostable basketball bracket pool app — and contributions are very welcome.

## Quick start

```bash
git clone https://github.com/jwieker/bracket10.git
cd bracket10
cp .env.example .env             # then fill in at least SESSION_SECRET
npm install
npm run dev                      # http://localhost:8080
```

You'll need Node.js **v20.6+** (for native `--env-file-if-exists` support). The Dockerfile pins Node 24.16.

To exercise admin features locally, you'll need a Google OAuth client (free) and a Firestore database. See [`README.md`](./README.md) for the full setup walkthrough.

## Project layout

See the **Project Structure** section of the [README](./README.md). Deeper architectural notes live in [`docs/architecture/`](./docs/architecture/); domain vocabulary is in [`docs/domain.md`](./docs/domain.md).

## Tests

```bash
npm test                         # full unit + integration suite (Vitest)
npm run test:coverage            # adds an HTML coverage report under ./coverage
```

Tests run automatically on every PR via [`.github/workflows/test.yml`](./.github/workflows/test.yml).

**Live e2e tests** hit a real Firestore database and are gated behind `LIVE_E2E=true`. They are intentionally not run in CI (cost + credentials).

**Changing an EJS view?** Controller tests mock `res.render`, so they won't catch a template
compile error (e.g. an undefined local in a view shared by an authenticated and an anonymous
flow — EJS throws on undefined locals). Add or run a test that renders the real `.ejs`.

## Branching & commits

- Branch off `main`. Use a descriptive branch name (`feature/...`, `fix/...`, `docs/...`).
- Keep commits focused. Squash trivia before opening the PR if you can.
- Commit messages: imperative mood, short subject (≤ 72 chars), optional body explaining the _why_.
- **Resolving conflicts:** rebase your own branch onto `main` and force-push _your_ branch only.
  Never force-push a branch you don't own (a bot's or another contributor's PR) — merge `main`
  into it instead. After resolving, run the full `npm test` and confirm the PR no longer shows a
  conflict.

## Pull requests

1. Open a PR against `main`. Mark as draft until you're ready for review.
2. CI must be green.
3. If your change affects user-visible behavior, add or update tests.
4. If your change affects architecture, update the relevant `docs/architecture/*.md`.
5. Check for open PRs touching the same files before opening yours — overlapping PRs cause
   merge-order conflicts. If yours supersedes another, say so in the description.

## Filing issues

When filing a bug, please include:

- Node version (`node --version`)
- Reproduction steps
- What you expected vs. what happened
- Anything from the server logs (with secrets scrubbed)

Feature requests are welcome too — say what problem you're trying to solve, not just the solution.

## Code style

Run the linter and formatter before opening a PR:

```bash
npm run lint          # ESLint — must pass; CI blocks on errors
npm run lint:fix      # auto-fix what's mechanically fixable
npm run format        # Prettier — rewrites files into the project style
npm run format:check  # what CI runs; fails if anything is unformatted
```

The linter (`eslint.config.js`) is intentionally small — correctness rules (typo'd refs, unused vars, `==` vs `===`, bad import paths), not formatting. Formatting is Prettier's job (`.prettierrc.json`: single quotes, otherwise defaults — semicolons, 2-space indent); CI blocks on `format:check`, so run `npm run format` before pushing. EJS templates in `views/` are not formatted (Prettier mangles `<% %>` tags) — match the surrounding style there. Beyond that: ESM imports, `const` by default.

A pre-commit hook (husky + lint-staged) runs ESLint and Prettier on staged files automatically after you `npm install`, so most of the time you won't need to think about either.

## Cost contract

This project tries to stay close to **$0/month** on its existing GCP / Cloud Run / Firestore stack. If your change introduces recurring spend (new API call, new always-on service, new third-party integration), call that out in the PR description and add a kill switch.

The CSP violation endpoint (`POST /csp-report`) follows this contract: it logs to **stdout only** (no Firestore, no third party), is rate-limited, and is fully disabled by `CSP_REPORT_ONLY=off`.

## Feedback & design rationale

### Understanding design decisions

Many features and architectural choices in this project have non-obvious reasons behind them. Before proposing a change that would "simplify" or "optimize" something, consider:

- **Cost contract**: We aim to stay near **$0/month** on infrastructure. If something looks inefficient but avoids an API call or database operation, that's intentional.
- **Auditability**: Some processes (like the maintainer's automated PR review/fix loops) use indirection through GitHub rather than direct coupling. This looks slower but provides a crucial audit trail and avoids race conditions.
- **Coupling & resilience**: Tight coupling between systems may seem redundant but often prevents cascading failures. The trade-off (latency vs. decoupling) is usually worth it.
- **Agent loops**: Autonomous agent routines have explicit permission gates (`agent:ready` labels, draft PRs, human gates on merge) for good reason. They're not meant to be "optimized" to near-zero human involvement.

### Giving feedback on design

If you think a design choice is wrong:

1. **Check the history first**: Look for comments in code, the PR that introduced it, or relevant `docs/architecture/*.md` files explaining the _why_.
2. **Name the trade-off clearly**: Not "this is slow" or "we could simplify this," but "we'd save X by accepting Y risk/cost." Be specific.
3. **Propose a concrete alternative**: "Instead of doing A, do B because <specific reason>" beats "this could be better."
4. **File a design-discussion issue**: For architectural concerns, open an issue (not a PR) titled `[Design Discussion]` with the trade-off analysis. The maintainer will label it and prioritize it.

## Security

If you find a security issue, **please don't file a public issue**. Email the maintainer (see `package.json` → `author`) with the details and we'll coordinate a fix and disclosure.
