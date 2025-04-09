import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const typeMap = {
  int: 'number',
  bigint: 'number',
  tinyint: 'boolean',
  varchar: 'string',
  char: 'string',
  text: 'string',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  enum: 'enum',
  json: 'string'
};

export async function generateStructFromTable(table) {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
  });

  const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``);

  const struct = columns.map(col => {
    const rawType = col.Type.toLowerCase();
    const lengthMatch = rawType.match(/\((.*?)\)/);
    const baseType = rawType.split('(')[0];
    const isEnum = baseType === 'enum';
    const isAuto = col.Extra.includes('auto_increment');

    const isUuid =
      (baseType === 'char' || baseType === 'varchar') &&
      parseInt(lengthMatch?.[1]) === 36 &&
      col.Field.toLowerCase().includes('id');

    const type = isUuid
      ? 'uuid'
      : typeMap[baseType] || 'string';

    let length = null;
    if (isEnum) {
      length = null;
    } else if (type === 'date') {
      length = 10; // YYYY-MM-DD
    } else if (type === 'datetime') {
      length = 19; // YYYY-MM-DD HH:MM:SS
    } else {
      length = parseInt(lengthMatch?.[1]) || null;
    }

    return {
      name: col.Field,
      type,
      required: col.Null === 'NO',
      length,
      default: isAuto
        ? 'auto_increment'
        : col.Default?.toLowerCase() === 'current_timestamp'
          ? 'current_timestamp'
          : col.Default === null
            ? (col.Null === 'NO' ? '' : null)
            : col.Default,
      ...(isEnum && {
        enum: rawType
          .match(/\((.*?)\)/)[1]
          .replace(/'/g, '')
          .split(',')
      })
    };
  });

  await pool.end();
  return struct;
}
