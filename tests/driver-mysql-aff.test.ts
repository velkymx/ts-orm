import { describe, it, expect } from 'vitest';
import { createMysqlDriver } from '../src/index.js';
import { buildCreateTable } from '../src/schema.js';
import { mysql } from '../src/dialect.js';

const LIVE = process.env['TS_ORM_TEST_MYSQL'] === '1';

describe.runIf(LIVE)('mysql matched-rows semantics (issue 185)', () => {
  it('reports matched rows on no-change updates via FOUND_ROWS default', async () => {
    const driver = createMysqlDriver();
    try {
      await driver.execute('DROP TABLE IF EXISTS `probe_aff`', []);
      await driver.execute('CREATE TABLE `probe_aff` (`id` INT AUTO_INCREMENT PRIMARY KEY, `n` INT)', []);
      await driver.execute('INSERT INTO `probe_aff` (`n`) VALUES (?)', [5]);
      const same = await driver.execute('UPDATE `probe_aff` SET `n` = ? WHERE `id` = ?', [5, 1]);
      expect(same.affectedRows).toBe(1);
      const changed = await driver.execute('UPDATE `probe_aff` SET `n` = ? WHERE `id` = ?', [6, 1]);
      expect(changed.affectedRows).toBe(1);
      const missing = await driver.execute('UPDATE `probe_aff` SET `n` = ? WHERE `id` = ?', [7, 999]);
      expect(missing.affectedRows).toBe(0);
      await driver.execute('CREATE TABLE `probe_big` (`b` BIGINT, `n` DECIMAL(10, 2))', []);
      await driver.execute('INSERT INTO `probe_big` (`b`, `n`) VALUES (?, ?)', ['9007199254740993', '12.50']);
      const big = await driver.query<Record<string, unknown>>('SELECT * FROM `probe_big`', []);
      expect(big[0]?.['b']).toBe('9007199254740993');
      expect(big[0]?.['n']).toBe('12.50');
      await driver.execute('DROP TABLE `probe_big`', []);
      const built = buildCreateTable(mysql, 'probe_dec', {
        amount: { type: 'decimal', required: true },
      });
      await driver.execute(built, []);
      await driver.execute('INSERT INTO `probe_dec` (`amount`) VALUES (?)', ['12.50']);
      const dec = await driver.query<Record<string, unknown>>('SELECT * FROM `probe_dec`', []);
      expect(String(dec[0]?.['amount'])).toMatch(/^12\.50/);
      await driver.execute('DROP TABLE `probe_dec`', []);
    } finally {
      await driver.execute('DROP TABLE IF EXISTS `probe_aff`', []);
      await driver.close();
    }
  });
});
