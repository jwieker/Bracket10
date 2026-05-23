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

You'll need Node.js **v20.6+** (for native `--env-file-if-exists` support). The Dockerfile pins Node 24.14.

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

## Branching & commits

- Branch off `main`. Use a descriptive branch name (`feature/...`, `fix/...`, `docs/...`).
- Keep commits focused. Squash trivia before opening the PR if you can.
- Commit messages: imperative mood, short subject (≤ 72 chars), optional body explaining the _why_.

## Pull requests

1. Open a PR against `main`. Mark as draft until you're ready for review.
2. CI must be green.
3. If your change affects user-visible behavior, add or update tests.
4. If your change affects architecture, update the relevant `docs/architecture/*.md`.

## Filing issues

When filing a bug, please include:

- Node version (`node --version`)
- Reproduction steps
- What you expected vs. what happened
- Anything from the server logs (with secrets scrubbed)

Feature requests are welcome too — say what problem you're trying to solve, not just the solution.

## Code style

There is no enforced formatter yet (this is on the open-source TODO list — see [`docs/private/OPEN_SOURCE_PLAN.md`](./docs/private/OPEN_SOURCE_PLAN.md)). For now, match the surrounding style: 2-space indent, ESM imports, `const` by default. Try not to introduce new lint warnings.

## Cost contract

This project tries to stay close to **$0/month** on its existing GCP / Cloud Run / Firestore stack. If your change introduces recurring spend (new API call, new always-on service, new third-party integration), call that out in the PR description and add a kill switch.

## Security

If you find a security issue, **please don't file a public issue**. Email the maintainer (see `package.json` → `author`) with the details and we'll coordinate a fix and disclosure.
