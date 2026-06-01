# Changelog

All notable changes to VibeORM. Format loosely follows Keep a Changelog.

## [Unreleased]

### Added
- CI: `Node.js CI` workflow runs `build` + `typecheck` + `test` on every push/PR across Node 20/22/24, using a MySQL 8.0 service container. The Vitest `globalSetup` now uses a provided DB (via `DB_HOST`/`DB_PORT`) when set, falling back to the local ephemeral server otherwise.
- `todo.md` task backlog as single source of truth.
- `tsconfig.json` typecheck gate — incremental migration config (`allowJs`, `checkJs` off, `strict`); `npm run typecheck`.
- Vitest + ephemeral real-MySQL test harness (`mysql-memory-server`, pinned MySQL 8.0.40) via `globalSetup`; removes the live-MySQL dependency. `crud`/`model` suites run with zero external DB.
- Configurable connection port: all pools and test connections honor `DB_PORT` (falls back to 3306).

### Changed
- **M3** Migrated `src/introspect.js` → `introspect.ts` (typed `SHOW COLUMNS` rows, returns `Field[]`). `bin/cli.js` now imports the built `dist/introspect.js`. Behavior unchanged.
- **M2** Migrated `src/validator.js` → `validator.ts`; exports shared `Field`/`FieldType`/`ValidateOptions` types. Behavior unchanged.
- **M1** Migrated `src/security.js` → `security.ts` (typed, strict). First file of the incremental TypeScript migration; behavior unchanged.
- **M0** Build pipeline: `npm run build` compiles `src` → `dist` (JS + `.d.ts`) via `tsconfig.build.json`; `package.json` `main`/`types`/`exports`/`files` now point at `dist`; `prepublishOnly` runs the build; `dist/` is gitignored. Tests continue to run against `src` via Vitest. Enables safe per-file TS migration without breaking runtime resolution.
- Test runner: **Jest → Vitest** (`npm test` → `vitest run`).
- Dependencies upgraded to latest: dotenv 17, mysql2 3.22, uuid 14, eslint 10, prettier 3.8, typescript 6. Removed jest.

### Security
- **S1** Comparison operators in `QueryBuilder` `where`/`orWhere` and all `*Join` builders are now validated against a fixed allowlist (`= != <> > < >= <= LIKE NOT LIKE`). Previously a caller-supplied operator was interpolated raw into SQL (operator-position injection, e.g. `where('age', '0 OR 1=1 OR age <', x)`); non-whitelisted operators now throw immediately.

### Fixed
- **S6** Numeric validation accepted empty/whitespace strings (`Number('')===0`). `type:'number'` now rejects blank strings and requires a finite value (also rejects `NaN`/`Infinity`).
- **S4** `update()` with no updatable columns (only the id key) emitted invalid `UPDATE ... SET  WHERE id = ?`. Now returns a clean `No fields to update` failure.
- **B1** `model.where()` forwarded `undefined` as a third argument, making the value parse as the SQL operator (`ER_PARSE_ERROR`). Now disambiguates via `arguments.length`.
- **S2** `OFFSET` emitted without `LIMIT` produced invalid MySQL; now prepends the documented max-row sentinel. **S3** (incidental): limit/offset use `!= null`, honoring an explicit `0`.
- **B2** DECIMAL `SUM`/`AVG` returned as strings (mysql2); now coerced to Number, leaving non-numeric (`MAX`/`MIN` of date/text) and null untouched.
- **B3** `update()` rejected partial payloads; now validates with partial semantics (absent required columns left as-is; explicit null on a required column still errors).
