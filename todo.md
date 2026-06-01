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

- None remaining.

## P3 — Low

- [ ] A8 Stale log prefix `[ts-orm]` → `[vibeorm]` — `src/security.ts`.
- [ ] A10 Tighten non-null assertions / casts where cheap: `src/QueryBuilder.ts:516,519,526,534,542,550` (`where.field!`/`where.fields!`), `src/introspect.ts:88` (`lengthMatch!`), `src/validator.ts:87` (`value as string`). Use discriminated `WhereClause` union so `field`/`fields` narrow without `!`.

## P4 — Enhancement

- [ ] A11 Streaming/lazy reads: `get()` buffers all rows in memory. Add `stream()`/`cursor()` via `pool.query(...).stream()` for large result sets.
- [ ] A12 CI coverage gate (depends on A4): fail the build under threshold.

## P5 — Backlog / Icebox

- [ ] A13 Multi-dialect driver abstraction (conflicts with current MySQL-only/minimal mandate).
