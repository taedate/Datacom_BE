import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ensureNoteAuthorColor } from '../service/sharedNoteColors.js';

export async function createSharedNotesTable(connection) {
    const sql = await readFile(new URL('./shared_notes_migration.sql', import.meta.url), 'utf8');
    await connection.query(sql);
    const attachments = await readFile(new URL('./shared_note_attachments_migration.sql', import.meta.url), 'utf8');
    for (const statement of attachments.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
    await connection.query(await readFile(new URL('./shared_note_colors_migration.sql', import.meta.url), 'utf8'));
    const [authors] = await connection.query('SELECT DISTINCT created_by FROM shared_notes ORDER BY created_by');
    for (const author of authors) await ensureNoteAuthorColor(connection, author.created_by);
}

async function main() {
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    const connection = await mysql.createConnection({
        host: process.env.DBHOST || 'localhost', user: process.env.DBUSER,
        password: process.env.DBPWD, database: process.env.DB, port: process.env.DBPORT || 3306,
    });
    try {
        await createSharedNotesTable(connection);
        console.log('Shared notes table is ready. Existing data was preserved.');
    } finally {
        await connection.end();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error('Shared notes migration failed:', error.message); process.exitCode = 1; });
}
