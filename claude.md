# Claude Code Instructions

Read [`AGENTS.md`](./AGENTS.md) first — it is the canonical guidance (project overview, repo
map, conventions, and general coding behavior) shared across all AI tools. Then read
`docs/GUIDE.md` for task-specific docs.

One additional reminder beyond `AGENTS.md`: never expose internal implementation details
(stack traces, Firestore paths, user IDs) in API error responses or rendered views — log them
server-side only. Verbose error details must only be exposed when `DEBUG_ERRORS` is explicitly
enabled, and never in production.

The sections below are **Claude-Code-specific automation** for GitHub PR events.

---

## PR Review Instructions

When triggered by a `pull_request.opened` GitHub event:

1. Read `docs/GUIDE.md` and the PR diff to understand what changed.
2. Review the changes against the checklist below.
3. **Fix any clear issues directly**: check out the PR branch, make the fix, run tests if applicable, and push to the same branch. Only fix things that are unambiguous — bugs, security holes, broken tests, obvious style violations. Do not refactor or restructure beyond the minimal fix.
4. Post a single PR comment summarising what you found, what you fixed (with file and line references), and anything you left for the author to address manually.

If an issue is ambiguous or architecturally significant, note it in the comment but do not attempt a fix.

**Review checklist** (omit headings with no findings):

- **Security**: Auth bypasses, CSP violations, missing rate limits, session handling, OAuth state, XSS/injection — see [docs/architecture/security.md](./docs/architecture/security.md) for the threat model.
- **Cost**: Any new Firestore reads/writes, Cloud Run scaling changes, third-party API calls, or missing kill switches — see [CONTRIBUTING.md](./CONTRIBUTING.md#cost-contract).
- **Architecture**: Layer violations (routes → controllers → services → repositories), direct Firestore access outside repositories, business logic in the wrong layer.
- **Correctness**: Logic bugs, off-by-one errors, missing null/undefined checks at system boundaries (user input, external API responses).
- **Tests**: Missing test coverage for changed logic. Check `./tests` for the existing suite.
- **Style**: Deviations from the project's patterns in [CONTRIBUTING.md](./CONTRIBUTING.md#code-style).

---

## PR Comment Response Instructions

When triggered by a pull request review or review comment, first check the comment author. If the author is `claude[bot]`, `claude-code[bot]`, or any Claude Code identity, **stop immediately** — do not respond to avoid loops.

Otherwise:

1. Read the PR diff and the triggering comment/review to understand the context.
2. **Evaluate the feedback**:
   - If the suggestion is **correct and unambiguous**: apply it, push to the PR branch, and reply to the comment confirming what was changed and why it was right.
   - If the suggestion is **partially correct or debatable**: reply explaining what you agree with, what you disagree with, and why — referencing the relevant code or docs. Do not apply it silently.
   - If the suggestion is **incorrect or inapplicable**: reply politely explaining why, with reference to the codebase (e.g. the existing pattern in `docs/architecture/` or `CONTRIBUTING.md`).
   - If the suggestion is **out of scope** for this PR: acknowledge it and note it as a separate follow-up.
3. Reply directly to the comment thread so the conversation stays in context.
4. Keep replies concise. Don't restate what the reviewer said — just respond to it.

> **Rule — never push silently:** every push to an open PR MUST be accompanied by a PR
> comment saying what changed and why. When the push addresses review feedback, that means
> a reply on each finding's thread (or a single comment mapping every finding to its fix or
> reasoned decline); for any other push — follow-on work, formatting fixes, scope additions —
> a short comment summarizing the commits is enough. This applies regardless of how the
> session was started — a silent push leaves reviewers (human or the pr-debate loop) unable
> to re-verify without diffing, and the automated loops key off replies to converge. The
> only exception is the push that opens the PR itself, where the PR body is the comment.

**Never apply a suggestion that**:

- Changes architectural boundaries (routes/controllers/services/repositories)
- Adds new dependencies or recurring cost
- Touches security-sensitive code (auth, CSP, rate limiting) without a clear correctness argument
- Is a style preference with no objective basis

For those, reply with your reasoning instead.

---

## Stay Subscribed Until the PR Settles

A session triggered by a single GitHub event (a webhook or Routine firing) runs once and ends —
**nothing re-invokes a finished session for a later event on its own.** If your work on a PR
expects a follow-up (you posted a review awaiting a fix, pushed a fix awaiting re-review, or
opened a PR awaiting CI), call `subscribe_pr_activity` for that PR before ending your turn so
the follow-up event wakes this session with its context intact. Where `send_later` is
available, also arm a ~1-hour self check-in as a backstop — webhooks don't deliver everything
(CI success and new pushes can be missed) — and re-arm it silently when nothing changed.
Unsubscribe (and delete the pending check-in) when the PR is merged or closed, or your part in
it is done. Don't assume another session or a Routine trigger will pick up the follow-up: on
PR #465 a fix push went unreviewed because the reviewing session had ended unsubscribed.

**Carve-out — hand-offs by design:** don't subscribe when another loop explicitly owns the
follow-up. `loop-fixer` opens a draft PR and stops there on purpose (`pr-debate` reviews it,
`pr-responder` implements the feedback) — a fixer session subscribing would receive events
outside its scope. The rule is: whoever is _expected to act next from this session_ subscribes;
a session whose job ended at the hand-off does not.
