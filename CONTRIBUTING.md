# Contributing to ts-orm

Thanks for your interest in contributing. This project values clarity,
consistency, and practical functionality.

## Development setup

Requirements: Node 24 or later, npm, and optionally a local MySQL for
live exercises (see below).

```bash
git clone https://github.com/velkymx/ts-orm.git
cd ts-orm
npm install
npm run build
```

MySQL is optional. The suite runs on SQLite in memory by default. For a
live server, configure `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
`DB_DATABASE`, and `DB_PORT`, then run the demo app in `../ts-orm-demo`
(migrate, seed, start) to exercise the full stack by hand.

## Testing

```bash
npm run typecheck   # strict tsc, no emit
npm run lint        # oxlint over src, tests, bin
npm run build       # emit dist with declarations
npm run test        # vitest suite
```

CI runs all four on pushes and pull requests to `main` and `develop`,
across Node 24 and 26. New logic needs tests that fail before the fix
and pass after; sqlite-backed integration tests are preferred over
mocks. Runnable API samples live in `examples/` and must keep passing:
`node examples/basic-crud.mjs` and siblings run against the built
barrel, so rebuild first.

## Pull requests

- Open an issue before coding; one branch and one PR per issue, named
  `feat/issue-N-topic` or `fix/issue-N-topic`, branched from `develop`
  and targeted back at `develop` (never `main`).
- Keep PRs focused: no unrelated changes, formatting, or refactoring.
- All PRs require review before merge.

### Commit Message Convention

One logical change per commit, every commit keeps tests green. Format
follows the 7 rules popularized by Chris Beams and summarized in the
AJB Blog guide to Git best practices
(https://blog.ajb.bz/git-best-practices-a-guide-for-new-developers):

- Subject: `Imperative summary`, capitalized, no period, under 50 chars. No type or scope prefixes on new work (older history still carries them; do not mix styles).
- Blank line, then a body explaining what changed and why (wrap near 72 cols).
- Reference the issue in the body with `Refs #N`, and `Closes #N` only on the PR description.
- Never work directly on the primary branch; one branch and one PR per issue.

## Code style

- TypeScript strict, `erasableSyntaxOnly`: no enums, namespaces, or
  parameter properties. No `any`; narrow `unknown` instead.
- Prefer clarity over cleverness; small single-purpose functions.
- Identifiers pass the allowlist and are quoted; values are always
  bound, never interpolated. No em-dashes or en-dashes in prose.

## Release process

1. Land everything on `develop` first; `main` tracks releases.
2. Bump `version` in `package.json`.
3. Verify the gate: `npm run typecheck && npm run lint && npm run build && npm test`.
4. Verify the tarball ships only the runtime plus metadata:
   `npm pack --dry-run` must list `dist`, `bin`, `package.json`,
   plus the auto-included readme and license. No `src`, `tests`,
   `docs`, or `examples`.
5. Verify publish health with `npx publint` and
   `npx @arethetypeswrong/cli --pack` (the one expected note is the
   ESM-only CJS warning; the package is ESM-only by design).
6. Publish from a clean tree; `prepublishOnly` rebuilds and retests.
