---
tags: [development, review, agents]
updated: 2026-09-24
---

# Reviewing and maintaining PRs

The playbook for reviewing or fixing an existing PR in this repo. The review checklist itself
lives in [`AGENTS.md`](../../AGENTS.md) § Reviewing & maintaining PRs.

This repo receives a steady stream of auto-generated PRs, so reviewing and fixing existing
PRs is a routine task. They come from two places, and the difference matters: **Jules**
(`google-labs-jules[bot]`, branches like `perf/…-<taskid>` and `test-…-<taskid>`) opens PRs
directly, while this repo's own agent loops open `claude/*` PRs off a triaged issue. Beyond the
normal review lens:

- **A bare number is not necessarily an issue.** "Go look at 497 & 496" may hand you open pull
  requests, not issues — Jules ships PRs and never files issues, so its numbers never enter the
  `agent:ready` queue. Two ways to tell before you act: an issue read of a PR still succeeds, but
  its `html_url` ends in `/pull/N`; and a labels lookup **404s** on a PR while a plain get
  succeeds. Treat that 404 as a type signal, not a data error.
- **Verify locally; don't wait on CI.** CI status often reads `pending`. Check out the PR head
  in a throwaway git worktree (symlink the repo's `node_modules` into it), then run the
  affected tests plus `npm test`. This is faster and more trustworthy than the checks tab.
- **Template changes need a render-level check.** Controller tests mock `res.render`, so they
  do **not** catch EJS compile errors. When a PR touches a `.ejs` view, render the real
  template. Watch especially for an undefined local in a view shared by an authenticated and an
  anonymous flow (e.g. `myEditEntry.ejs` serves both `/my-brackets` and the public `/my-entry`)
  — EJS throws on undefined locals, so a missing `csrfToken`/`userEmail` will 500 the page.
- **Watch for overlapping PRs — then test-merge them instead of hedging.** Auto-generated PRs
  frequently touch the same file or region. When several do, call out the overlap and name which
  one is the superset. Don't stop at a speculative "watch for merge-order conflicts": check both
  heads out into two throwaway worktrees, merge them in each order, and run `npm test`. Two
  minutes converts the warning into a definite "no constraint, either order" or a named conflict.
- **Mutation-test a coverage-only PR before judging its tests.** For a PR that adds tests and
  nothing else, don't argue from the diff about whether the tests earn their keep — break the
  code they cover and see if they fail. Two worked examples: four new tests for `?.` guards in
  `adminMiddleware.js` all failed once the guards were stripped (real tests); and a set of
  `DEBUG_ERRORS` tests that _looked_ vacuous turned out to be the suite's only guard against
  internal exception text reaching a browser, because mutating that branch failed only the new
  test. It's cheaper and far more conclusive than reading.
- **Size a performance claim against real input volumes.** Auto-generated perf PRs benchmark on
  synthetic inputs that don't resemble production. A "4x faster, 1.358 ms → 0.341 ms" result
  measured over 10,000 games describes a path that actually reads one bracket — ~65 documents,
  cached — so the real saving was sub-microsecond. Take the simplification if it's a genuine
  simplification; don't repeat the number. Say which input size the claim was measured at.
- **Resolving conflicts / updating onto main is a maintenance action — only do it when asked.**
  Merge `origin/main` into the PR branch; do **not** rebase + force-push a branch you don't own
  (bot- or contributor-authored). Rebase + force-push is only for task branches you own.
  After resolving, run the full `npm test` (not just the conflicted file — semantic conflicts
  pass locally and break elsewhere) and confirm the PR is no longer marked conflicting.
- **Branch scope.** Net-new work originating in a session goes on the assigned or newly
  created task branch. Review/maintenance fixes go on the target PR's own branch, with the user's permission.
- **Reply on the review thread, not just the commit.** When you apply a finding from an inline
  review comment, reply on that specific thread (not a general PR comment) confirming what
  changed and the commit SHA — the diff alone doesn't tell the reviewer their comment was seen.
  If you decline a suggestion or resolve it differently than proposed (e.g. scoping a fix down
  instead of extending it), reply with the reasoning instead of silently diverging. Findings
  that depend on each other (a nit that only applies if a should-fix goes one way) need their
  own reply once the dependency resolves, even if the code itself didn't change for that thread.
