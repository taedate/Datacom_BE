import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import database from '../service/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    try {
        console.log('Reading migration file...');
        const sqlPath = path.join(__dirname, 'stocks_migration.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Executing migration...');
        await database.query(sql);

        console.log('Stocks migration completed successfully!');
    } catch (error) {
        console.error('Error running stocks migration:', error);
    } finally {
        process.exit();
    }
}

runMigration();
