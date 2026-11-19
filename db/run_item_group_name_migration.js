import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function addItemGroupNameColumn(connection) {
    const [columns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'item_group_name'`);
    if (columns.length) return false;
    try {
        await connection.query('ALTER TABLE documents ADD COLUMN item_group_name VARCHAR(255) NULL DEFAULT NULL AFTER quotation_id');
        return true;
    } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') return false;
        throw error;
    }
}

async function main() {
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    const connection = await mysql.createConnection({
        host: process.env.DBHOST || 'localhost', user: process.env.DBUSER,
        password: process.env.DBPWD, database: process.env.DB, port: process.env.DBPORT || 3306,
    });
    try {
        const added = await addItemGroupNameColumn(connection);
        console.log(added ? 'Added optional item_group_name column. Existing document and section names were not changed.' : 'item_group_name already exists; no changes needed.');
    } finally {
        await connection.end();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error('Item group name migration failed:', error.message); process.exitCode = 1; });
}
