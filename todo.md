# VibeORM — Task Backlog (single source of truth)

Rules: one item per cycle, atomic commit per item, tests must pass first.
Decisions locked:
- Production driver stays **mysql2** (VibeORM is a MySQL ORM).
- Test isolation via **ephemeral real MySQL** (mysql-memory-server, no Docker, no live DB) — NOT SQLite (avoids dialect drift / false-green tests).
- TypeScript migration is **incremental** (allowJs bridge, one file per commit).

---

## Cycle 0 — Infrastructure Recovery

- [x] 0.1 Establish `todo.md` as single source of truth.
- [x] 0.2 Add `tsconfig.json` (NodeNext, `allowJs`, `checkJs` off, `strict`, `noEmit` for typecheck gate). + dependency upgrade to latest (jest held for 0.3).
- [ ] 0.3 Replace Jest with Vitest; stand up ephemeral real-MySQL harness (mysql-memory-server) via Vitest globalSetup; remove live-DB dependency from existing tests.
- [ ] 0.4 Wire npm scripts: `test` (vitest run), `typecheck` (tsc --noEmit). Verify existing 61 tests pass against ephemeral MySQL.

## Security / correctness (from review — exploitable now, do before migration)

- [ ] S1 CRITICAL: Whitelist comparison operators in `QueryBuilder` `where`/`orWhere` and all `*Join` builders. Raw operator is interpolated into SQL (injection). Add failing test first.
- [ ] S2 HIGH: `OFFSET` emitted without `LIMIT` is invalid MySQL. Fix limit/offset clause in `QueryBuilder` + `orm.read`/`readWith`.

## TypeScript migration (incremental, one file per commit)

- [ ] M1 `src/security.js` -> `.ts` (pure, no deps — safest first).
- [ ] M2 `src/validator.js` -> `.ts`.
- [ ] M3 `src/introspect.js` -> `.ts`.
- [ ] M4 `src/QueryBuilder.js` -> `.ts`.
- [ ] M5 `src/orm.js` -> `.ts`.
- [ ] M6 `src/model.js` -> `.ts`.
- [ ] M7 `src/index.js` + `bin/cli.js` -> `.ts`; add build step (`tsc` -> `dist`); update `package.json` exports/`types`/`bin`.

## Lower-priority correctness (from review)

- [ ] S3 MED: `limit(0)` silently dropped (falsy check) — use `!= null`.
- [ ] S4 MED: empty UPDATE (no matching fields) builds invalid `SET` SQL — guard.
- [ ] S5 MED: three separate mysql2 pools (`orm`, `QueryBuilder`, `introspect`); consolidate into one shared connection module. REQUIRES APPROVAL (cross-file refactor).
- [ ] S6 MED: `Number('')===0` passes `number` validation in `validator` — reject empty/non-finite.
- [ ] S7 LOW: dedupe `formatResponse`; rename stale `[ts-orm]` log prefix -> `[vibeorm]`.

---

## Done

(none yet)
