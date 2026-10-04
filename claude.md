# Claude Code Instructions

@AGENTS.md

Claude-Code-specific rules for GitHub PR work. This file loads into every session, so it states
current behavior only — never PR/issue numbers, dates, or the story of how a rule was found.
Anything stricter here than an automated loop's own policy still wins in this repo.

## PR review

**If the `pr-debate` skill is available, it owns PR review and this section does not apply.**
Never run both on one PR — a fix pushed mid-review strands the panel's findings on a stale head.
Otherwise, on a newly opened PR: read `docs/GUIDE.md` and the diff, review against the checklist
in `AGENTS.md`, fix only what is unambiguous (bugs, security holes, broken tests, obvious style
violations) on the PR's branch, and post one comment: what you found, what you fixed (file and
line), and what you left for the author. Note ambiguous or architectural issues; don't fix them.

## Responding to PR comments

If the comment author is `claude[bot]`, `claude-code[bot]`, or any Claude identity, **stop** — do
not respond. Otherwise read the diff and the comment, and reply on its thread:

- **Correct and unambiguous** — apply it, push, confirm what changed.
- **Partially correct or debatable** — say what you agree and disagree with, citing code or docs.
  Never apply it silently.
- **Incorrect or inapplicable** — explain why, citing the existing pattern.
- **Out of scope** — acknowledge it as a follow-up.

**Never apply a suggestion that** changes architectural boundaries, adds a dependency or
recurring cost, touches auth/CSP/rate limiting without a clear correctness argument, or is a style
preference with no objective basis. Reply with your reasoning instead.

**Never push silently.** Every push to an open PR carries a comment saying what changed and why —
a reply on each finding's thread, or one comment mapping findings to fixes. The push that opens
the PR is the exception; its body is the comment.

## GitHub MCP gotchas

These fail silently rather than erroring. Reasons: `loop-conduct.md` § GitHub MCP gotchas.

- **No angle-bracketed tokens in a PR or issue title or body** — the sanitizer deletes text
  through the next closer. Write `claude/fix-NNN`. Comments and reviews are safe.
- **Label writes replace the whole set** — read the labels, change one, write the full array back.
- **Never trust label filtering** — re-check each item's own `labels` array.
- **`list_pull_requests` never sets `merged`** — read `merged_at`.
- **Read CI from `get_check_runs`**, not `get_status`; `total_count: 0` within a minute of a push
  means "not queued yet."
- **Loop identity is a `loop:<name>` label**, applied with a follow-up `issue_write` because
  `create_pull_request` can't set labels.

## Stay subscribed until the PR settles

A finished session is never re-invoked for a later event. If your work expects a follow-up (a fix,
a re-review, CI), call `subscribe_pr_activity` before ending, arm a ~1-hour `send_later` check-in
where available, and unsubscribe once the PR is merged or closed. Don't subscribe when another
loop owns the follow-up (`loop-fixer` stops at the hand-off by design).

## Routines

Working on Routines or loop prompts: use the `routine-sync` or `loop-czar` skill, and read
`loop-conduct.md` § Routines API gotchas first.
