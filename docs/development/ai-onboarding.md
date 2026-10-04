---
tags: [development, agents, onboarding]
updated: 2026-09-06
---

# Working with any coding agent

Project knowledge belongs in the repository. `AGENTS.md` holds shared rules and the session
checklist; `docs/GUIDE.md` routes tasks to architecture and feature docs. Each tool's small
entry adapter is designed to load or point to those files. Changing models does not require copying the
rules, installing a Claude plugin, or recreating a previous conversation.

## Start from a fresh checkout

Use Node 24 (CI's exact version is in `.github/workflows/test.yml`) and open the repo in a
coding assistant with filesystem and shell access. Its startup instructions tell it to run:

```bash
node scripts/agent-context.js
git status --short --branch
npm ci --ignore-scripts
npm test
```

The context command works before dependency installation. It reads optional checkout context
and succeeds when none is present. `npm run agent:context` is the same command. It does not
load `.env`, inspect credentials, install packages, or contact external services.

The default tests use mocked Firestore. Leave `LIVE_E2E` unset: no Google account, `.env`,
database, emulator, or deployment is needed to edit code and run these tests. Dependency
installation needs registry access. Integration tests need permission to bind local ports;
a sandbox denial is an environment limitation to report, not a reason to skip tests silently.
The repo's `.npmrc` disables lifecycle scripts. Git hooks are optional conveniences; the
explicit CI commands remain authoritative.

After changes, run the CI sequence in order:

```bash
npm run lint
npm run format:check
npm test
```

For a running app, follow the emulator setup in `README.md`. For live tests, read
`tests/README.md`. These are separate from the credential-free coding path.

## Instruction discovery

The host application discovers instructions, not the model itself:

| Host | Repository entry | How shared rules are reached |
| --- | --- | --- |
| Codex | `AGENTS.md` | Native discovery |
| Claude Code | `CLAUDE.md` | `@AGENTS.md` import; additional Claude event automation stays in the adapter |
| Gemini CLI | `GEMINI.md` | `@./AGENTS.md` import |
| GitHub Copilot | `.github/copilot-instructions.md` | Explicit instruction to read `AGENTS.md` and `docs/GUIDE.md` |
| Other repository-aware tools | `AGENTS.md` or existing tool rules file | Shared guidance, directly or through a pointer |

These are the intended discovery mechanisms, following conventions documented by [OpenAI](https://developers.openai.com/codex/guides/agents-md/),
[Claude Code](https://code.claude.com/docs/en/memory),
[Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), and
[GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).
Keep `GEMINI.md` uppercase in Git so discovery also works on case-sensitive Linux hosts.
An import includes the shared text at startup; a Markdown pointer requires the agent to read
the target. Host settings can disable instruction loading or override it.

A plain ChatGPT or Gemini conversation without repository tools cannot discover local files
or execute commands. Give it repository access or attach the relevant files, and start with:

> Read AGENTS.md and docs/GUIDE.md. Follow the session setup, then work on this task.
> If repository or shell access is unavailable, say which steps you cannot perform.

No repository can guarantee automatic discovery in every future host. Hosts that already
support `AGENTS.md` need no new project configuration; a host with a different convention
needs only a thin adapter. Account login, repository access, secrets, connector permissions,
and event scheduling remain host configuration. Claude's automated PR loops do not become
scheduled Codex or Gemini jobs just because the instructions are shared.

## Validation status

Validation covers the context command, checkout isolation, public-snapshot startup, and
local/remote Claude hook JSON delivery. Fresh Claude, Gemini CLI, and Copilot sessions have
not been exercised, so those adapters are designed for their documented host conventions
but are not verified end to end. In particular, Copilot must follow a Markdown pointer;
it does not use the Claude/Gemini import syntax. Follow the fresh-session checks below to
verify a host before relying on automatic instruction loading there.

## Maintain one set of rules

- Put coding, testing, branching, review criteria, and artifact budgets in `AGENTS.md`.
- Put task-specific knowledge in the appropriate `docs/` file and link it from `docs/GUIDE.md`.
- Keep provider event handlers and API quirks in their provider adapter. An ordinary coding
  session should not require those integrations.
- When adding a host, check its documented discovery filename and commit a small adapter.
  Do not run an initializer that replaces the canonical rules with a generated copy.
- Preserve the public-sync exclusions in `scripts/excluded-paths.sh`. Public onboarding
  must work with optional maintainer context absent.

To verify discovery after changing adapters, start a fresh session in each available host
and ask it to identify its instruction sources, setup commands, and CI gates. For Gemini,
`/memory show` displays the loaded context. Verify Git records the exact filename casing.
File checks and unit tests can verify the wiring, but do not prove that a particular model
will follow every instruction.
