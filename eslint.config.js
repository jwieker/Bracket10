// eslint.config.js — Bracket 10 linter
//
// ESLint 9+ flat config. Intentionally SMALL: correctness + a few security rules, no formatting.
// The point is to catch the class of bugs tests miss (typo'd refs, dead vars, == vs ===,
// bad import paths) on a repo where changes land direct to main with no human reviewer.
//
// Subtask A (#283) — baseline: @eslint/js recommended + no-undef / eqeqeq / no-unused-vars /
//   n/no-missing-import; no-console as a non-blocking warn.
// Subtask B (#284) — security: console.* in app code routed through Logger (no-restricted-syntax,
//   error) to enforce the CLAUDE.md no-leak rule; eslint-plugin-no-unsanitized for raw DOM sinks.
//   Type-aware floating-promise detection is tracked separately (needs typescript-eslint).

import js from '@eslint/js';
import globals from 'globals';
import n from 'eslint-plugin-n';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// vitest.config.js sets `test.globals: true`, so test files use vi/describe/it/expect/etc.
// as globals (only ~6 of 52 test files import them from 'vitest'). The `globals` package
// has no vitest preset, so declare them here or `no-undef` flags every test file.
const vitestGlobals = {
  suite: 'readonly',
  test: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  assert: 'readonly',
  expectTypeOf: 'readonly',
  assertType: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  onTestFailed: 'readonly',
  onTestFinished: 'readonly',
};

// Subtask B: flag any console.* call. Used to route app-code logging through the Logger.
const noConsoleViaLogger = {
  selector: "CallExpression[callee.object.name='console']",
  message:
    'Use Logger (src/utils/logger.js), not console.* — keeps logs structured (JSON) and avoids ' +
    'leaking stack traces, Firestore paths, or user IDs into raw output (see CLAUDE.md / AGENTS.md).',
};

export default [
  // 1. Global ignores — generated/private/data trees. `public/` client JS is linted (block 3b);
  //    only vendored minified bundles are skipped via *.min.js.
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'databasebackup/**',
      'data/**',
      'ai_private/**',
      'scripts/private/**',
      'docs/**',
      '**/*.min.js',
    ],
  },

  // 2. ESLint's own recommended correctness rules.
  js.configs.recommended,

  // 3. Server-side ESM: server.js, src/, jobs/, scripts/.
  //    `.mjs` is matched too — scripts/ ships Node CLIs as ESM `.mjs`.
  //    `public/` is excluded so Node globals / sourceType:module don't leak into
  //    browser scripts — those get their own layer in 3b.
  {
    files: ['**/*.{js,mjs}'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { n, 'no-unsanitized': nounsanitized },
    rules: {
      // High-value, bug-catching. Errors block CI.
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Typo'd / dead import paths — common in agent-written code. Disable if noisy.
      'n/no-missing-import': 'error',

      // Subtask B (#284): unsanitized DOM sinks (innerHTML, insertAdjacentHTML, document.write…).
      // A forward-looking ratchet for server code; the real DOM lives in `public/` client JS,
      // which gets the same rules in 3b (.ejs inline scripts remain the open follow-up).
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',

      // Surfaced but NON-blocking by default (warn). Promoted to error for app code below.
      'no-console': 'warn',
    },
  },

  // 3b. Browser client JS (#284 follow-up). Classic scripts (no import/export), browser
  //     globals, and the same correctness rules as the server layer. The no-unsanitized
  //     DOM-sink rules matter most here — this is where innerHTML actually runs.
  //     editEntry.js / registration.js read globals injected by inline <script> blocks
  //     in their EJS views; declare them so no-undef doesn't fire on real code.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Page-vendor libraries loaded via <script> tags in the views:
        $: 'readonly',
        jQuery: 'readonly',
        bootstrap: 'readonly',
        // Injected by views/*.ejs inline scripts:
        gameData: 'readonly',
        regionData: 'readonly',
        teamData: 'readonly',
        entryPicksFromServer: 'readonly',
        conferenceStatsData: 'readonly',
      },
    },
    plugins: { 'no-unsanitized': nounsanitized },
    rules: {
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-console': 'warn',
    },
  },

  // 3c. PWA service workers run in a worker scope (self/caches/clients), not a window.
  {
    files: ['public/**/*service-worker*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },

  // 4. Tests — add Vitest globals; allow console; skip import resolution (vitest aliases).
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...vitestGlobals },
    },
    plugins: { n },
    rules: {
      'no-console': 'off',
      'n/no-missing-import': 'off',
    },
  },

  // 5. CLI tooling & the poll job legitimately write to stdout.
  {
    files: ['scripts/**/*.{js,mjs}', 'jobs/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // 6. Subtask B (#284): app code must log through the Logger, not console.*.
  //    Enforces the CLAUDE.md no-leak rule and keeps Cloud Run logs structured. Errors here;
  //    scripts/jobs/tests keep console (stdout is their interface) and the Logger is exempt (7).
  {
    files: ['src/**/*.{js,mjs}', 'server.js'],
    ignores: ['**/*.test.js', 'src/utils/logger.js'],
    rules: {
      'no-restricted-syntax': ['error', noConsoleViaLogger],
    },
  },

  // 7. Subtask B (#284): type-aware floating-promise detection for production JS.
  //    A floating Firestore promise can crash the Express 5 process on Cloud Run —
  //    exactly the class of bug the plain-AST rules can't see. Needs the TS parser
  //    + tsconfig (checkJs). Scoped to src/ + server.js; tests are excluded.
  {
    files: ['src/**/*.js', 'server.js'],
    ignores: ['**/*.test.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // 8. The Logger is the one sanctioned console boundary.
  {
    files: ['src/utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
];
