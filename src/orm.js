import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { validatePayload } from './validator.js';

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

function formatResponse(success, message, data = null) {
    return { success, message, data };
}

export async function create(table, struct, payload) {
    const errors = validatePayload(struct, payload);
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    const columns = struct.map(f => f.name);
    const values = struct.map(f => payload[f.name] ?? f.default);

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    try {
        const [result] = await pool.execute(sql, values);
        return formatResponse(true, 'Record created', { id: result.insertId });
    } catch (error) {
        return formatResponse(false, 'DB Error', error.message);
    }
}

export async function read(table, conditions = {}, options = {}) {
    const keys = Object.keys(conditions);
    const whereClause = keys.length
        ? `WHERE ${keys.map(k => `${k} = ?`).join(' AND ')}`
        : '';

    const orderClause = options.orderBy
        ? `ORDER BY ${options.orderBy} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`
        : '';

    const limitClause = options.limit ? `LIMIT ${parseInt(options.limit)}` : '';
    const offsetClause = options.offset ? `OFFSET ${parseInt(options.offset)}` : '';

    const sql = `SELECT * FROM ${table} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

    try {
        const [rows] = await pool.execute(sql, keys.map(k => conditions[k]));
        return formatResponse(true, 'Data retrieved', rows);
    } catch (error) {
        return formatResponse(false, 'DB Error', error.message);
    }
}

export async function readOne(table, conditions = {}) {
    const result = await read(table, conditions); // just use it directly
  
    if (!result.success || !Array.isArray(result.data)) {
      return { success: false, message: 'Query failed', data: null };
    }
  
    if (result.data.length === 0) {
      return { success: false, message: 'Record not found', data: null };
    }
  
    return {
      success: true,
      message: 'Record found',
      data: result.data[0]
    };
  }
  
  export async function findOrFail(table, key, value) {
    const result = await readOne(table, { [key]: value });
  
    if (!result.success || !result.data) {
      throw new Error(`Record not found in table '${table}' with ${key} = ${value}`);
    }
  
    return result.data;
  }

  export async function readWith(table, conditions = {}, joins = [], options = {}) {
    try {
        const whereKeys = Object.keys(conditions);
        const whereClause = whereKeys.length
            ? `WHERE ${whereKeys.map(k => `${table}.${k} = ?`).join(' AND ')}`
            : '';

        const joinClause = joins.map(join => {
            const joinType = (join.type || 'inner').toUpperCase(); // INNER, LEFT, RIGHT
            const joinTable = join.table;
            const [leftCol, rightCol] = join.on;
            return `${joinType} JOIN ${joinTable} ON ${leftCol} = ${rightCol}`;
        }).join(' ');

        const orderClause = options.orderBy
            ? `ORDER BY ${options.orderBy} ${options.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`
            : '';

        const limitClause = options.limit ? `LIMIT ${parseInt(options.limit)}` : '';
        const offsetClause = options.offset ? `OFFSET ${parseInt(options.offset)}` : '';

        const sql = `SELECT * FROM ${table} ${joinClause} ${whereClause} ${orderClause} ${limitClause} ${offsetClause}`.trim();

        const values = whereKeys.map(k => conditions[k]);

        const [rows] = await pool.execute(sql, values);

        return formatResponse(true, 'Data retrieved with join', rows);
    } catch (error) {
        return formatResponse(false, 'DB Error', error.message);
    }
}

 

export async function update(table, struct, payload, idKey = 'id') {
    const errors = validatePayload(struct, payload);
    if (errors.length) return formatResponse(false, 'Validation failed', errors);

    const updates = struct
        .filter(f => payload[f.name] !== undefined && f.name !== idKey)
        .map(f => `${f.name} = ?`);
    const values = struct
        .filter(f => payload[f.name] !== undefined && f.name !== idKey)
        .map(f => payload[f.name]);

    values.push(payload[idKey]);
    const sql = `UPDATE ${table} SET ${updates.join(', ')} WHERE ${idKey} = ?`;

    try {
        const [result] = await pool.execute(sql, values);
        return formatResponse(true, 'Record updated', result);
    } catch (error) {
        return formatResponse(false, 'DB Error', error.message);
    }
}

export async function remove(table, idKey, idVal) {
    const sql = `DELETE FROM ${table} WHERE ${idKey} = ?`;

    try {
        const [result] = await pool.execute(sql, [idVal]);
        return formatResponse(true, 'Record deleted', result);
    } catch (error) {
        return formatResponse(false, 'DB Error', error.message);
    }
}
