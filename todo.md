# VibeORM — QA Audit Checklist

Audit date: 2026-06-01. Baseline: all `src` is TypeScript; build → `dist` (104K); 68/68 tests; typecheck clean; `npm test` uses ephemeral/CI MySQL (no live DB).

Rules: one item per cycle, atomic commit per item, tests pass before commit. Completed work → `CHANGELOG.md`.
Locked decisions: prod driver = mysql2 (MySQL-only); tests = ephemeral real MySQL (not SQLite); migration done (M0–M7).

---

## P0 — Critical / Blocker

- None. No active perf regression, security vuln, or broken core logic. (Operator-injection S1 fixed; identifier escaping covers table/column/order/join paths.)

## P1 — High

- [ ] A2 **Test coverage gaps in core query paths (0 coverage on 18 builder methods + 3 model methods).**
  - File: `src/QueryBuilder.ts` — untested: `whereNot, whereLike, orWhereLike, whereNotLike, orWhereNotLike, orWhereNot, whereAny, whereAll, whereNone, orWhereIn, whereNotIn(direct), orWhereNull, orWhereNotNull, leftJoin, rightJoin, outerJoin, pluck, clone`; `innerJoin` has only the operator-throw test (no functional JOIN result asserted). `src/model.ts` — `pluck, deleteWhere, readWith` untested.
  - Coverage delta: the entire JOIN builder family and `whereAny/All/All/None` emit SQL with `validateAndEscapeIdentifier` on caller input — security-relevant escaping is currently unverified.
  - Resolution: add functional integration tests (real ephemeral MySQL) asserting result rows for each, plus an injection test per join builder (malicious table/column → `success:false`, `data` contains `Invalid`). Highest priority: `leftJoin/rightJoin/innerJoin` result correctness + `whereAny/whereNone` SQL shape.

- [ ] A3 **Type safety: `any` in public signatures and bindings.**
  - File/Line: `src/orm.ts:41,68,103,131,206` (`payload`/`conditions: Record<string, any>`), `src/orm.ts:249` (`values: any[]`), `src/model.ts:94,101,108,115,136,200` (`Record<string, any>`), `src/QueryBuilder.ts:502,510` (`bindings: any[]`).
  - Coverage delta: n/a (type-level).
  - Resolution: public surface uses `Record<string, unknown>` / `unknown[]`; isolate the single unavoidable driver cast at the `pool.execute` boundary, commented:
    ```ts
    // orm.ts / QueryBuilder.ts public params: Record<string, unknown>, bindings: unknown[]
    const [rows] = await pool.execute(sql, bindings as mysql.ExecuteValues[]); // single mysql2 boundary cast
    ```
    Removes `any` from every exported signature; one documented boundary cast remains (mysql2's `ExecuteValues` requirement).

## P2 — Medium

- [ ] A5 **Three mysql2 pools + three `dotenv.config()` calls.**
  - File: `src/orm.ts:11`, `src/QueryBuilder.ts:9`, `src/introspect.ts:31` (pools); `dotenv.config()` at `orm.ts:9`, `QueryBuilder.ts:7`, `introspect.ts:5`.
  - Memory justification: three pools hold three independent idle-connection sets (default 10 each → up to 30 sockets) for one database. One shared pool caps idle connections and centralizes config.
  - Resolution: new `src/db.ts` exporting a single `pool` (+ one `dotenv.config({ quiet: true })`); the three modules import it. (Cross-file refactor — needs sign-off per minimalist rule.)

- [ ] A6 **`update()` filters `struct` twice.**
  - File: `src/orm.ts:199-204`.
  - Justification: two `.filter` passes over the struct per update; one pass removes a full array allocation + iteration.
  - Resolution:
    ```ts
    const setFields = struct.filter(f => payload[f.name] !== undefined && f.name !== idKey);
    const updates = setFields.map(f => `${validateAndEscapeIdentifier(f.name, 'column name')} = ?`);
    const values = setFields.map(f => payload[f.name]);
    ```

- [ ] A7 **Duplicate `formatResponse`.**
  - File: `src/orm.ts:38`, `src/QueryBuilder.ts:29`.
  - Resolution: move to `src/db.ts` (or a `response.ts`) and import in both. Fold into A5.

## P3 — Low

- [ ] A8 Stale log prefix `[ts-orm]` → `[vibeorm]` — `src/security.ts:172`.
- [ ] A9 dotenv 17 prints a tip on every import; pass `{ quiet: true }` (folds into A5).
- [ ] A10 Tighten non-null assertions / casts where cheap: `src/QueryBuilder.ts:516,519,526,534,542,550` (`where.field!`/`where.fields!`), `src/introspect.ts:88` (`lengthMatch!`), `src/validator.ts:87` (`value as string`). Use discriminated `WhereClause` union so `field`/`fields` narrow without `!`.

## P4 — Enhancement

- [ ] A11 Streaming/lazy reads: `get()` buffers all rows in memory. Add `stream()`/`cursor()` via `pool.query(...).stream()` for large result sets.
- [ ] A12 CI coverage gate (depends on A4): fail the build under threshold.

## P5 — Backlog / Icebox

- [ ] A13 Multi-dialect driver abstraction (conflicts with current MySQL-only/minimal mandate).
