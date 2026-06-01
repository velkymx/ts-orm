# VibeORM — QA Audit Checklist

Audit date: 2026-06-01. Baseline: all `src` is TypeScript; build → `dist` (104K); 68/68 tests; typecheck clean; `npm test` uses ephemeral/CI MySQL (no live DB).

Rules: one item per cycle, atomic commit per item, tests pass before commit. Completed work → `CHANGELOG.md`.
Locked decisions: prod driver = mysql2 (MySQL-only); tests = ephemeral real MySQL (not SQLite); migration done (M0–M7).

---

## P0 — Critical / Blocker

- None. No active perf regression, security vuln, or broken core logic. (Operator-injection S1 fixed; identifier escaping covers table/column/order/join paths.)

## P1 — High

- None remaining.

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
