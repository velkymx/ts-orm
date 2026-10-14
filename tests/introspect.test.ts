import { describe, it, expect } from 'vitest';
import { mapColumnToField, generateStructFromTable, type ShowColumnRow } from '../src/introspect.js';
import { createMysqlDriver } from '../src/drivers/mysql.js';

function col(over: Partial<ShowColumnRow> = {}): ShowColumnRow {
  return {
    Field: 'id',
    Type: 'int(11)',
    Null: 'NO',
    Default: null,
    Extra: 'auto_increment',
    ...over,
  };
}

describe('mapColumnToField (issue 42)', () => {
  it('maps auto_increment ints to required numbers', () => {
    expect(mapColumnToField(col())).toEqual({
      name: 'id',
      type: 'number',
      required: true,
      length: 11,
      default: 'auto_increment',
    });
  });

  it('maps tinyint(1) to boolean but wider tinyints to number', () => {
    expect(mapColumnToField(col({ Field: 'flag', Type: 'tinyint(1)', Extra: '' })).type).toBe('boolean');
    expect(mapColumnToField(col({ Field: 'small', Type: 'tinyint(2)', Extra: '' })).type).toBe('number');
    expect(mapColumnToField(col({ Field: 'bare', Type: 'tinyint', Extra: '' })).type).toBe('number');
  });

  it('maps text families to strings and dates to sized types', () => {
    expect(mapColumnToField(col({ Field: 't', Type: 'varchar(120)', Extra: '' })).length).toBe(120);
    expect(mapColumnToField(col({ Field: 'd', Type: 'date', Extra: '' }))).toMatchObject({ type: 'date', length: 10 });
    expect(mapColumnToField(col({ Field: 'dt', Type: 'datetime', Extra: '' }))).toMatchObject({
      type: 'datetime',
      length: 19,
    });
    expect(mapColumnToField(col({ Field: 'ts', Type: 'timestamp', Extra: '' })).type).toBe('datetime');
    expect(mapColumnToField(col({ Field: 'j', Type: 'json', Extra: '' })).type).toBe('string');
  });

  it('detects uuids by 36-char id-named columns', () => {
    expect(mapColumnToField(col({ Field: 'user_id', Type: 'char(36)', Extra: '' })).type).toBe('uuid');
    expect(mapColumnToField(col({ Field: 'code', Type: 'char(36)', Extra: '' })).type).toBe('string');
    expect(mapColumnToField(col({ Field: 'user_id', Type: 'varchar(37)', Extra: '' })).type).toBe('string');
  });

  it('parses enum values and nulls the length', () => {
    expect(mapColumnToField(col({ Field: 'role', Type: "enum('a','b')", Extra: '' }))).toEqual({
      name: 'role',
      type: 'enum',
      required: true,
      length: null,
      default: '',
      enum: ['a', 'b'],
    });
  });

  it('resolves defaults: timestamps, nulls, and raw values', () => {
    expect(
      mapColumnToField(col({ Field: 'c', Type: 'datetime', Default: 'current_timestamp', Extra: '' })).default,
    ).toBe('current_timestamp');
    expect(
      mapColumnToField(col({ Field: 'c', Type: 'datetime', Default: 'CURRENT_TIMESTAMP()', Extra: '' })).default,
    ).toBe('current_timestamp');
    expect(mapColumnToField(col({ Field: 'n', Type: 'text', Null: 'YES', Default: null, Extra: '' })).default).toBeNull();
    expect(mapColumnToField(col({ Field: 's', Type: "varchar(5)", Default: 'hi', Extra: '' })).default).toBe('hi');
  });

  it('falls back to string for unknown types', () => {
    expect(mapColumnToField(col({ Field: 'g', Type: 'geometry', Extra: '' })).type).toBe('string');
  });

  it('rejects hostile table names', async () => {
    const driver = createMysqlDriver();
    await expect(generateStructFromTable(driver, 'x; DROP')).rejects.toThrow();
    await driver.close();
  });
});

const LIVE = process.env['TS_ORM_TEST_MYSQL'] === '1';

describe.runIf(LIVE)('generateStructFromTable live (issue 42)', () => {
  it('round-trips a varied table through SHOW COLUMNS', async () => {
    const driver = createMysqlDriver();
    await driver.execute('DROP TABLE IF EXISTS `probe_structs`', []);
    await driver.execute(
      'CREATE TABLE `probe_structs` (' +
        '`id` INT AUTO_INCREMENT PRIMARY KEY, ' +
        '`flag` TINYINT(1) NOT NULL, ' +
        '`small` TINYINT(2) NULL, ' +
        '`user_id` CHAR(36) NOT NULL, ' +
        "`role` ENUM('a','b') NOT NULL, " +
        '`meta` JSON NULL, ' +
        '`made` DATETIME DEFAULT CURRENT_TIMESTAMP, ' +
        '`born` DATE NULL)',
      [],
    );
    const fields = await generateStructFromTable(driver, 'probe_structs');
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName['id']).toMatchObject({ type: 'number', default: 'auto_increment' });
    expect(byName['flag']).toMatchObject({ type: 'boolean' });
    expect(byName['small']).toMatchObject({ type: 'number', required: false });
    expect(byName['user_id']).toMatchObject({ type: 'uuid' });
    expect(byName['role']).toMatchObject({ type: 'enum', enum: ['a', 'b'] });
    expect(byName['meta']).toMatchObject({ type: 'string' });
    expect(byName['made']).toMatchObject({ type: 'datetime', default: 'current_timestamp' });
    expect(byName['born']).toMatchObject({ type: 'date', length: 10 });
    await driver.execute('DROP TABLE `probe_structs`', []);
    await driver.close();
  });
});
