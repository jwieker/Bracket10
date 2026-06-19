# AI Assistant Instructions

Read `docs/GUIDE.md` first. It explains the project and directs you to the right docs per task.

---

## General Coding Behavior

Behavioral guidelines to reduce common LLM coding mistakes. These bias toward caution over speed; for trivial tasks, use judgment. Where these conflict with the project-specific `CRITICAL INSTRUCTION`s below, the project-specific rules win.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

Surface alternatives when the choice is architecturally significant or hard to reverse. Otherwise, act decisively per the cost rule below — don't re-litigate trivial decisions.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

This project uses Vitest — run the suite with `npm test` (config in `vitest.config.js`, tests in `tests/`) to verify before and after changes.

**CRITICAL INSTRUCTION — Remote environment testing**: When running in the Claude Code on the web environment, Firestore credentials are pre-loaded. After any change that touches the ESPN poll pipeline (`pollService.js`, `espnService.js`), the cache layer (`cacheUtils.js`), or conference/school repositories, run the V3 live suite to validate against real Firestore:
```bash
npm run test:live-e2e-v3
```
For changes to the bracket lifecycle, points engine, or First Four logic, run V4:
```bash
npm run test:live-e2e-v4
```
See `docs/private/development/testing.md` § "Running live tests in the remote Claude Code environment" for full details and data safety rules.

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

**CRITICAL INSTRUCTION**: If you discover new patterns or make architectural changes, update the relevant `docs/` file. Skip updates for minor changes.

**CRITICAL INSTRUCTION**: Act decisively. When you have a likely cause and a clear fix, make the change. Don't re-examine the same evidence or generate alternatives. Token usage is expensive.

**CRITICAL INSTRUCTION**: Never expose internal implementation details (stack traces, Firestore paths, user IDs) in API error responses or rendered views. Log them server-side only. Verbose error details must only be exposed when `DEBUG_ERRORS` is explicitly enabled, and never in production.

**CRITICAL INSTRUCTION — Cost contract**: Keep the project as close to **$0/month** as possible. Any change adding recurring spend needs a kill switch or explicit funding. Read `CONTRIBUTING.md` § "Cost contract" before adding infrastructure, third-party API calls, or changing scaling parameters.

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

**Never apply a suggestion that**:
- Changes architectural boundaries (routes/controllers/services/repositories)
- Adds new dependencies or recurring cost
- Touches security-sensitive code (auth, CSP, rate limiting) without a clear correctness argument
- Is a style preference with no objective basis

For those, reply with your reasoning instead.
