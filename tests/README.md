# Test taxonomy

The suite has three tiers. The tier is encoded in the file name, and each tier
has different rules about what it may touch. Put a new test in the right tier
before writing it — the decision guide at the bottom takes ten seconds.

| Tier        | File pattern     | Firestore access                       | Run with                                                |
| ----------- | ---------------- | -------------------------------------- | ------------------------------------------------------- |
| Pure unit   | `*.pure.test.js` | none — pure functions only             | `npm test`                                              |
| Integration | `*.test.js`      | mocked (`vi.mock`, `tests/__mocks__/`) | `npm test`                                              |
| Live E2E    | `*.live.test.js` | **real**, reserved sandbox years only  | `npm run test:live-e2e-v3` / `npm run test:live-e2e-v4` |

## Pure unit — `*.pure.test.js`

Tests of pure functions and static data: no I/O, no mocks of the database, no
Express. Examples: `pointsUtils.pure.test.js`, `csvUtils.pure.test.js`,
`espnTeamMap.pure.test.js` (invariants over a JSON config file are fine — the
file is read from disk, but nothing is mutated and nothing external is called).

## Integration — `*.test.js`

Everything else that runs in `npm test`. These exercise repositories,
services, controllers, and routes against **mocked** Firestore — either
`vi.mock("../src/config/firestore.js", …)` with a fake `db` (see
`hierarchicalRepository.test.js` for the shared mock harness), mocked
repository/service singletons (see `services.test.js`,
`admin.integration.test.js`), or fixtures under `data/seed/`
(`integration.test.js`). They must never open a real Firestore connection;
`npm test` has to pass on a machine with no credentials at all.

## Live E2E — `*.live.test.js`

Real Firestore, gated behind `LIVE_E2E=true` (in a plain `npm test` run these
files self-skip). Scripts:

- `npm run test:live-e2e-v3` — ESPN poll pipeline, cache layer, repositories
- `npm run test:live-e2e-v4` — bracket lifecycle, points engine, First Four
- `npm run test:targeted-updates` — targeted points-recalc path

**Data-safety rule:** live tests operate _exclusively_ on reserved sentinel
years (`9999` for e2e-v4, `9997` for the ESPN poll tests) and sentinel entry
ids — never a real tournament year. Each run pre-cleans and post-cleans its
sandbox year. If you add a live test, scope every read and write to a sentinel
year and never touch shared/top-level reference data destructively.

An emulator variant exists for local development without credentials:
`npm run test:e2e-v3` / `npm run test:e2e-v4` point the same specs at a
Firestore emulator (`FIRESTORE_EMULATOR_HOST`).

## Which tier does my new test belong in?

Pure function or static config file → `*.pure.test.js` · anything needing a
(mocked) repo, service, controller, or route → `*.test.js` · anything that
must prove behavior against real Firestore → `*.live.test.js`, sandbox year
only.
