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

export async function read(table, conditions = {}) {
    const keys = Object.keys(conditions);
    const where = keys.length
        ? `WHERE ${keys.map(k => `${k} = ?`).join(' AND ')}`
        : '';

    const sql = `SELECT * FROM ${table} ${where}`;

    try {
        const [rows] = await pool.execute(sql, keys.map(k => conditions[k]));
        return formatResponse(true, 'Data retrieved', rows);
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
