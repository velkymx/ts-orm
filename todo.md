# VibeORM — Task Backlog (single source of truth)

Rules: one item per cycle, atomic commit per item, tests must pass first.
Completed work lives in `CHANGELOG.md`.

Decisions locked:
- Production driver stays **mysql2** (VibeORM is a MySQL ORM).
- Test isolation via **ephemeral real MySQL** (mysql-memory-server, pinned 8.0.40) — NOT SQLite (avoids dialect drift / false-green tests).
- TypeScript migration is **incremental** (allowJs bridge, one file per commit).

---

## P2 — TypeScript migration (incremental, one file per commit)

- [ ] M3 `src/introspect.js` -> `.ts`.
- [ ] M4 `src/QueryBuilder.js` -> `.ts`.
- [ ] M5 `src/orm.js` -> `.ts`.
- [ ] M6 `src/model.js` -> `.ts`.
- [ ] M7 `src/index.js` + `bin/cli.js` -> `.ts`; add build step (`tsc` -> `dist`); update `package.json` exports/`types`/`bin`.

## P3 — Cleanup / refactor

- [ ] S5 Three separate mysql2 pools (`orm`, `QueryBuilder`, `introspect`); consolidate into one shared connection module. REQUIRES APPROVAL (cross-file refactor).
- [ ] S7 Dedupe `formatResponse`; rename stale `[ts-orm]` log prefix -> `[vibeorm]`.
