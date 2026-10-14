import { describe, it, expect } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.js';
import { mysql } from '../src/dialect.js';
import type { BindValue, Driver, ExecuteResult } from '../src/driver.js';
import type { ShowColumnRow } from '../src/introspect.js';

/** A real Driver stub (no mocking library) that replays canned SHOW COLUMNS rows. */
function stubDriver(
  rows: ShowColumnRow[],
  opts: { failQuery?: Error; closed: { value: boolean } },
): Driver {
  return {
    dialect: mysql,
    async query<Row>(_sql: string, _params: readonly BindValue[]): Promise<Row[]> {
      if (opts.failQuery) throw opts.failQuery;
      return rows as unknown as Row[];
    },
    async execute(): Promise<ExecuteResult> {
      return { affectedRows: 0 };
    },
    async close(): Promise<void> {
      opts.closed.value = true;
    },
    async [Symbol.asyncDispose](): Promise<void> {
      opts.closed.value = true;
    },
  };
}

/** Capture writes and log lines so the orchestration is assertable without IO. */
function recordingDeps(driver: Driver): {
  deps: CliDeps;
  writes: Array<{ path: string; data: string }>;
  out: string[];
  err: string[];
  created: number;
} {
  const writes: Array<{ path: string; data: string }> = [];
  const out: string[] = [];
  const err: string[] = [];
  let created = 0;
  const deps: CliDeps = {
    createDriver: () => {
      created += 1;
      return driver;
    },
    writeFile: (path, data) => writes.push({ path, data }),
    log: (msg) => out.push(msg),
    errorLog: (msg) => err.push(msg),
  };
  return {
    deps,
    writes,
    out,
    err,
    get created() {
      return created;
    },
  };
}

const COLUMNS: ShowColumnRow[] = [
  { Field: 'id', Type: 'int(11)', Null: 'NO', Default: null, Extra: 'auto_increment' },
  { Field: 'email', Type: 'varchar(255)', Null: 'NO', Default: null, Extra: '' },
];

describe('runCli struct (issue 43)', () => {
  it('writes mapped fields to <table>.json, logs the path, and closes the pool', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);

    const code = await runCli(['struct', 'users'], rec.deps);

    expect(code).toBe(0);
    expect(rec.writes).toHaveLength(1);
    expect(rec.writes[0]!.path).toBe('./users.json');
    const parsed = JSON.parse(rec.writes[0]!.data) as Array<{ name: string; type: string }>;
    expect(parsed.map((f) => f.name)).toEqual(['id', 'email']);
    expect(parsed[0]).toMatchObject({ type: 'number', default: 'auto_increment' });
    expect(rec.out.some((line) => line.includes('./users.json'))).toBe(true);
    expect(closed.value).toBe(true);
  });

  it('reports a friendly message and exits non-zero when introspection fails', async () => {
    const closed = { value: false };
    const driver = stubDriver([], { failQuery: new Error('boom'), closed });
    const rec = recordingDeps(driver);

    const code = await runCli(['struct', 'users'], rec.deps);

    expect(code).toBe(1);
    expect(rec.writes).toHaveLength(0);
    expect(rec.err.join('\n')).toContain('users');
    expect(closed.value).toBe(true);
  });

  it('closes the pool and exits non-zero when the write fails', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);
    rec.deps.writeFile = () => {
      throw new Error('disk full');
    };

    const code = await runCli(['struct', 'users'], rec.deps);

    expect(code).toBe(1);
    expect(rec.err.join('\n')).toContain('users');
    expect(closed.value).toBe(true);
  });

  it('closes the pool and exits non-zero on a hostile table name', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);

    const code = await runCli(['struct', 'users; DROP TABLE users'], rec.deps);

    expect(code).toBe(1);
    expect(rec.writes).toHaveLength(0);
    expect(closed.value).toBe(true);
  });
});

describe('runCli usage (issue 43)', () => {
  it('prints usage and exits non-zero with no command', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);

    const code = await runCli([], rec.deps);

    expect(code).toBe(1);
    expect(rec.out.concat(rec.err).join('\n')).toContain('make:migration');
    expect(rec.created).toBe(0);
  });

  it('prints usage when struct is given without a table name', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);

    const code = await runCli(['struct'], rec.deps);

    expect(code).toBe(1);
    expect(rec.out.concat(rec.err).join('\n')).toContain('make:migration');
    expect(rec.created).toBe(0);
  });

  it('prints usage and creates no driver when given surplus arguments', async () => {
    const closed = { value: false };
    const driver = stubDriver(COLUMNS, { closed });
    const rec = recordingDeps(driver);

    const code = await runCli(['struct', 'users', 'extra'], rec.deps);

    expect(code).toBe(1);
    expect(rec.out.concat(rec.err).join('\n')).toContain('make:migration');
    expect(rec.created).toBe(0);
  });
});
