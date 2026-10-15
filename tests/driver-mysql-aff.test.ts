import { describe, it, expect } from 'vitest';
import { createMysqlDriver } from '../src/index.js';

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
    } finally {
      await driver.execute('DROP TABLE IF EXISTS `probe_aff`', []);
      await driver.close();
    }
  });
});
