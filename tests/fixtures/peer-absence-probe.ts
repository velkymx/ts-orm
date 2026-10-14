import {
  createMssqlDriver,
  createMysqlDriver,
  createPostgresDriver,
  createSqliteDriver,
} from '../../src/index.js';

createPostgresDriver();
createMssqlDriver();
createMysqlDriver();
createSqliteDriver();
console.log('peer-absence-ok');
