# VibeORM — QA Audit Checklist

Audit date: 2026-06-01. Baseline: all `src` is TypeScript; build → `dist` (104K); 68/68 tests; typecheck clean; `npm test` uses ephemeral/CI MySQL (no live DB).

Rules: one item per cycle, atomic commit per item, tests pass before commit. Completed work → `CHANGELOG.md`.
Locked decisions: prod driver = mysql2 (MySQL-only); tests = ephemeral real MySQL (not SQLite); migration done (M0–M7).

---

## Code Review — Round 2 (2026-06-01)

Full-project review. Severity-tagged; not yet scheduled into the P-tiers below. No code changed.

### Framework reality check (review items 7 & 8 — "Laravel 13 / The Laravel Way")
- **Category mismatch.** This is a **Node.js + TypeScript + MySQL2 ORM library**, not a Laravel/PHP application. **"Laravel 13" does not exist** (Laravel is ~v12-era). Laravel/Eloquent practices — Artisan, migrations, Eloquent model classes, relationships, casts, service container — **do not apply to a standalone Node library**, and there is no meaningful "compliance" to score.
- **What is true:** the public API is *Eloquent-flavored* — `model()`, fluent `where/orWhere/whereLike/whereIn`, `findOrFail`, aggregates, `readWith`. That is the extent of the "Laravel feel".
- **Divergences from the Eloquent idiom** (not bugs — design): returns `{success,message,data}` envelopes instead of model instances/exceptions; **no relationships / eager loading / casts / soft-deletes / auto timestamps / migrations**. These are roadmap *features* (P4/P5), not defects.
- **Recommendation:** reframe the goal as an *"Eloquent-inspired Node ORM"*. Scoring it against Laravel will keep producing non-actionable noise.

### HIGH
- [ ] R1 **CLI hangs after success (regression from A5).** `src/cli.ts:8-13` — `generateStructFromTable` now uses the shared `db.ts` pool, which is never closed, so the event loop stays alive and `vibeorm struct <t>` writes the file then **never exits**. (Pre-A5, `introspect` called `pool.end()`.) Fix: in `cli.ts` success path, `await pool.end()` (export/import it) or `process.exit(0)` after the write.
- [ ] R2 **`create()` binds `current_timestamp` (and similar keyword defaults) as a literal string.** `src/orm.ts:35` — `payload[f.name] ?? f.default`; when a `datetime` column is omitted, `f.default` is the string `'current_timestamp'` (from introspect) and gets **bound as a parameter**, so MySQL receives the literal text `'current_timestamp'` for a DATETIME → insert error / zero-date. Validator even whitelists this string (`validator.ts:72`), masking it. Fix: omit columns whose resolved value is a server-side default keyword (`'current_timestamp'`, `'auto_increment'`) from the INSERT and let MySQL apply the column default.

### MEDIUM
- [ ] R3 **Empty `whereIn`/`whereNotIn` → invalid SQL.** `QueryBuilder._buildWhereClause` `in` branch — `[].map(()=>'?').join()` yields `` → `col IN ()`, a MySQL syntax error. Fix: empty `IN` → `0=1`, empty `NOT IN` → `1=1`.
- [ ] R4 **Inconsistent error contract.** `findOrFail` (`orm.ts:104`) throws; every other op returns `{success:false,...}`. Callers must handle two paths. (Behavioral — flag only; decide intentionally.)
- [ ] R5 **`introspect.generateStructFromTable` has no try/catch** (`introspect.ts:30`) — raw DB errors (schema/credential detail) propagate unsanitized, unlike every CRUD path. Wrap and route through `sanitizeError`/logger or return a typed failure.
- [ ] R6 **Limit/offset clause duplicated 4×** (`orm.read`, `orm.readWith`, `QueryBuilder.get`, `QueryBuilder.pluck`) — drift risk; extract one helper (needs sign-off).
- [ ] R7 **`SELECT *` everywhere; no column projection.** `read`/`get` always fetch all columns (over-fetch); no `.select(cols)`. Perf + bandwidth. (Feature — P4.)
- [ ] R8 **introspect parsing edges:** `enum('a', 'b')` (space after comma) yields `' b'` (leading space) — `introspect.ts:77`; `decimal(10,2)` length parse keeps only `10`, drops scale — `introspect.ts:60`.

### LOW
- [ ] R9 Non-finite `limit`/`offset` (e.g. `limit('abc')`) → `LIMIT NaN` → query error instead of being ignored. Guard with `Number.isFinite`. `orm.ts:70-71`, `QueryBuilder.limit/offset`.
- [ ] R10 Loose types: `ReadOptions.direction: string` should be `'ASC'|'DESC'`; `JoinSpec.on` `[string,string]|string[]` permits wrong-length arrays.
- [ ] R11 `readOne`/`findOrFail` use 2-space indent vs 4-space elsewhere (`orm.ts:86-112`) — cosmetic.
- [ ] R12 `QueryBuilder.first()` overwrites any user-set `limit` with `1` (minor surprise).

### Confirmed clean
- **Security/injection:** identifiers validated+`escapeId`-escaped (table/column/order/join, qualified parts); values fully parameterized; operators allowlisted (S1); `SHOW COLUMNS` table escaped. No injection paths found.
- **Concurrency:** no shared mutable query state (per-instance builders); module-level pool/logger singletons are swap-only.
- **N+1:** none in the library (single statements; `readWith` uses JOINs).

---

## Code Review — TypeScript 6+ (2026-06-01)

Type-safety / TS6-practices pass. Bug/security/perf findings R1–R12 (above) still stand. Positive: `src` is `any`-free (A3) and uses `import type` + `.js` ESM specifiers correctly.

### MEDIUM
- [ ] T1 **`tsconfig` carries migration leftovers.** `tsconfig.json:9-10` `allowJs:true`/`checkJs:false` are obsolete — all `src` is `.ts`, no `.js` remains; keeping `allowJs` lets a stray `.js` silently compile and ship. Set `allowJs:false`, drop `checkJs`. Also `include` lists `bin/**/*` (`tsconfig.json:19`) but `bin/` was removed (CLI moved to `src/cli.ts`) — stale.
- [ ] T2 **`noUncheckedIndexedAccess` is off.** Index/array access is typed as always-present, which is exactly what masks the `!`/`as` smells and the edge bugs already filed: `introspect.ts:77` `lengthMatch![1]`, `orm.ts:144-145` `leftCol.split('.')` destructure, `QueryBuilder` `where.fields![i]`, `rows[0].count`. Enabling it is the highest-value TS6 hardening for the "strict type safety" mandate — it surfaces R3 (empty IN) / R8 (split edges) at compile time. (Will require fixing the spots it flags.)
- [ ] T3 **Generics not threaded — public API returns `data: unknown`.** `OrmResponse<T>` exists but `model()`/`find`/`get`/`read`/`first` all resolve `unknown`, so every consumer casts each row. For a "strict type safety" ORM, `model<User>()` should flow `OrmResponse<User[]>` / `OrmResponse<User>`. Currently zero row-level type safety at call sites. (Behavioral/API-surface change — flag only, needs sign-off.)

### LOW
- [ ] T4 `verbatimModuleSyntax` not set — recommended for ESM/TS to lock consistent `import type` + predictable emit (code already follows it; flag enforces it).
- [ ] T5 Recommended strict-family flags off: `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`. Cheap dead-code/correctness signal.
- [ ] T6 `skipLibCheck:true` (`tsconfig.json:14`) — pragmatic, but hides dependency `.d.ts` errors for a package that publishes types; periodic check advisable.
- [ ] T7 Build emits `.d.ts` but no `declarationMap` — consumers can't jump to source types. Add `declarationMap:true` in `tsconfig.build.json` for DX.
- [ ] T8 Tests are `.mjs` → not typechecked. `.ts` tests would give type coverage on the public API and catch T3-style regressions.
- [ ] T9 Boundary casts `as RowDataPacket[]` / `as ExecuteValues[]` are acceptable but scattered; routing all `pool.execute` through one typed helper (ties to R6) confines them to a single audited spot (consider `satisfies`).

---

## P0 — Critical / Blocker

- None. No active perf regression, security vuln, or broken core logic. (Operator-injection S1 fixed; identifier escaping covers table/column/order/join paths.)

## P1 — High

- None remaining.

## P2 — Medium

- None remaining.

## P3 — Low

- [ ] A10 Tighten non-null assertions / casts where cheap: `src/QueryBuilder.ts:516,519,526,534,542,550` (`where.field!`/`where.fields!`), `src/introspect.ts:88` (`lengthMatch!`), `src/validator.ts:87` (`value as string`). Use discriminated `WhereClause` union so `field`/`fields` narrow without `!`.

## P4 — Enhancement

- [ ] A11 Streaming/lazy reads: `get()` buffers all rows in memory. Add `stream()`/`cursor()` via `pool.query(...).stream()` for large result sets.
- [ ] A12 CI coverage gate (depends on A4): fail the build under threshold.
- [ ] A14 Logging — query/slow-query events: route all `pool.execute` through a single `db.ts` helper that emits `debug` (SQL) + `warn` (slow query over threshold) via `getLogger()`. (Core logger done; this adds the query-level events. Refactors ~10 execute call sites — confirm wrapper approach.)
- [ ] A15 README: document a pino + pino-roll daily-rotation + `redact` recipe for enterprise injection. (Blocked by the `.md` exclusion filter — needs an exception like CHANGELOG.)

## P5 — Backlog / Icebox

- [ ] A13 Multi-dialect driver abstraction (conflicts with current MySQL-only/minimal mandate).
