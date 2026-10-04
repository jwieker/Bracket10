import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { createServer } from 'http';
import { APP_CONFIG } from '../src/config/app.js';

// Guards the global body-parser caps in server.js: express.json() (#573) and
// express.urlencoded() (#584). Both have to stay above the largest body the app
// legitimately posts, and the paths that come close are tournament creation
// (JSON) and tournament game seeding (urlencoded) — once-a-year admin flows, so
// a limit set too tight would 413 during the one week anybody would notice.
// These tests build both payloads at full bracket size from the real seed
// fixture and assert they still round-trip, which is what makes a future
// tightening fail here instead of in production.

const seedDir = path.join(process.cwd(), 'data/seed');
const FIXTURE_YEAR = 2022;

// Round-1 seed order within a region, matching the pairing the tournament views
// render (1v16, 8v9, …). Only used to make the generated slot strings the same
// length as the real ones.
const R1_SEEDS = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

function readNdjson(file) {
  return fs
    .readFileSync(path.join(seedDir, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => JSON.parse(line));
}

// Mirrors how views/newTourneyComplete.ejs builds the /createTournament body:
// one "regionID-gameID-seed-teamSID" string per Round-1 team slot (not a whole
// game object), plus flat ff_* keys per First Four game. Widest possible school
// id is used for every slot so the result is an upper bound, not a sample.
function buildCreateTournamentBody(r1Games, maxSid, ffCount) {
  const games = [];
  r1Games.forEach((game, i) => {
    for (const slot of [1, 2]) {
      const seed = R1_SEEDS[(i % 8) * 2 + slot - 1];
      games.push(`${game.regionID}-${game.gameID}-${seed}-${maxSid}`);
    }
  });

  const body = {
    year: FIXTURE_YEAR,
    regions: [1, 2, 3, 4],
    games,
    includeFirstFour: true,
    firstFourCount: ffCount,
  };
  for (let i = 0; i < ffCount; i++) {
    body[`ff_team1_${i}`] = maxSid;
    body[`ff_team2_${i}`] = maxSid;
    body[`ff_seed_${i}`] = 16;
    body[`ff_nextGame_${i}`] = 63;
    body[`ff_nextGameSpot_${i}`] = 2;
  }
  return body;
}

function parseLimitBytes(limit) {
  const match = /^(\d+)kb$/.exec(limit);
  if (!match) throw new Error(`Unhandled limit format: ${limit}`);
  return Number(match[1]) * 1024;
}

// Mirrors how views/editTourneyGames.ejs builds the /tournamentGamesUpdate body:
// the same one-string-per-Round-1-slot shape as the JSON payload above, but
// posted as a flat form — repeated `games` keys plus _csrf/year/region. This is
// the largest urlencoded body the app produces (#584); the CSRF token is padded
// to a generous width so the result is an upper bound.
function buildGamesUpdateForm(r1Games, maxSid) {
  const params = new URLSearchParams();
  params.append('_csrf', 'x'.repeat(72));
  params.append('year', String(FIXTURE_YEAR));
  params.append('region', '1,2,3,4');
  r1Games.forEach((game, i) => {
    for (const slot of [1, 2]) {
      const seed = R1_SEEDS[(i % 8) * 2 + slot - 1];
      params.append(
        'games',
        `${game.regionID}-${game.gameID}-${seed}-${maxSid}`,
      );
    }
  });
  return params;
}

let server;
let baseUrl;
let fullBracketBody;
let fullGamesForm;

beforeAll(async () => {
  const games = readNdjson(`games.${FIXTURE_YEAR}.json`);
  const r1Games = games.filter((g) => g.round === 1);
  const schools = readNdjson('school.json');
  const maxSid = Math.max(...schools.map((s) => Number(s.sid) || 0));
  if (r1Games.length !== 32) {
    throw new Error(
      `Expected 32 Round-1 games in the fixture, got ${r1Games.length}`,
    );
  }

  // 8 First Four games is the ceiling createTournament accepts (parsePositiveInt
  // max in tourneyController), so this is the largest body the route can take.
  fullBracketBody = buildCreateTournamentBody(r1Games, maxSid, 8);
  fullGamesForm = buildGamesUpdateForm(r1Games, maxSid);

  // Same parser configuration server.js mounts globally, with a bare echo route
  // instead of the real controller — this is a body-parser test, not a
  // tournament-creation test. server.js itself isn't imported here (it has
  // import-time side effects: SESSION_SECRET check, DB startup checks), so a
  // typo or dropped `limit:` option in the real app.use(express.json(...))
  // mount would not be caught by this test.
  const app = express();
  app.use(express.json({ limit: APP_CONFIG.http.jsonBodyLimit }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: APP_CONFIG.http.urlencodedBodyLimit,
      parameterLimit: APP_CONFIG.http.urlencodedParameterLimit,
    }),
  );
  app.post('/echo', (req, res) => res.status(200).json(req.body));
  // express.json surfaces an over-limit body as an error with status 413; without
  // a handler Express would answer 500 and the assertion below would pass for the
  // wrong reason.
  app.use((err, req, res, _next) => res.status(err.status || 500).end());

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postJson(raw) {
  return fetch(`${baseUrl}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
}

describe('global express.json body limit', () => {
  test('a full-size bulk games payload round-trips intact', async () => {
    const raw = JSON.stringify(fullBracketBody);
    const res = await postJson(raw);

    expect(res.status).toBe(200);
    const echoed = await res.json();
    // 32 Round-1 games x 2 team slots — a partial parse would show up here
    // before it showed up as a half-written bracket.
    expect(echoed.games).toHaveLength(64);
    expect(echoed).toEqual(fullBracketBody);
  });

  test('the full-size bulk games payload leaves room under the limit', () => {
    const size = Buffer.byteLength(JSON.stringify(fullBracketBody));
    const limit = parseLimitBytes(APP_CONFIG.http.jsonBodyLimit);

    // Measured at ~1.6kb against a 32kb cap. Asserting a 4x margin rather than
    // the exact byte count leaves room for extra fields on the route while still
    // failing loudly if someone tightens the limit toward the real payload.
    expect(size * 4).toBeLessThan(limit);
  });

  test('the configured limit matches the measured 32kb cap', () => {
    expect(APP_CONFIG.http.jsonBodyLimit).toBe('32kb');
  });

  test('a body over the limit is rejected with 413', async () => {
    const limit = parseLimitBytes(APP_CONFIG.http.jsonBodyLimit);
    const oversized = JSON.stringify({ pad: 'x'.repeat(limit) });

    const res = await postJson(oversized);
    expect(res.status).toBe(413);
  });
});

async function postForm(raw) {
  return fetch(`${baseUrl}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: raw,
  });
}

describe('global express.urlencoded body limit', () => {
  test('a full-size tournament games form round-trips intact', async () => {
    const res = await postForm(fullGamesForm.toString());

    expect(res.status).toBe(200);
    const echoed = await res.json();
    // 32 Round-1 games x 2 team slots, arriving as a repeated key. Asserting
    // the array length catches a parameterLimit set below the real form just as
    // surely as it catches a truncated body.
    expect(echoed.games).toHaveLength(64);
    expect(echoed.year).toBe(String(FIXTURE_YEAR));
  });

  test('the full-size games form leaves room under both limits', () => {
    const size = Buffer.byteLength(fullGamesForm.toString());
    const limit = parseLimitBytes(APP_CONFIG.http.urlencodedBodyLimit);
    const paramCount = [...fullGamesForm.keys()].length;

    // Measured at ~1.2kb / 67 parameters. Same 4x-margin style as the JSON
    // assertion above rather than an exact byte count, so an extra field on the
    // form doesn't fail the build but a real tightening does.
    expect(size * 4).toBeLessThan(limit);
    expect(paramCount * 2).toBeLessThan(
      APP_CONFIG.http.urlencodedParameterLimit,
    );
  });

  test('the configured limits match the measured caps', () => {
    expect(APP_CONFIG.http.urlencodedBodyLimit).toBe('32kb');
    expect(APP_CONFIG.http.urlencodedParameterLimit).toBe(200);
  });

  test('a form body over the limit is rejected with 413', async () => {
    const limit = parseLimitBytes(APP_CONFIG.http.urlencodedBodyLimit);
    const res = await postForm(`pad=${'x'.repeat(limit)}`);

    expect(res.status).toBe(413);
  });

  test('a form with more parameters than the limit is rejected with 413', async () => {
    const tooMany = new URLSearchParams();
    for (let i = 0; i <= APP_CONFIG.http.urlencodedParameterLimit; i++) {
      tooMany.append('f', String(i));
    }
    // Well under the 32kb body cap — this asserts parameterLimit is doing the
    // rejecting, so the two knobs can't be confused for one another.
    expect(Buffer.byteLength(tooMany.toString())).toBeLessThan(
      parseLimitBytes(APP_CONFIG.http.urlencodedBodyLimit),
    );

    const res = await postForm(tooMany.toString());
    expect(res.status).toBe(413);
  });
});
