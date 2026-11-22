import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { productDescriptionSeeds } from './product_description_seeds.js';
import { normalizeProductDescription } from '../service/productDescriptions.js';

export async function migrateProductDescriptions(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS product_descriptions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        description TEXT NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'อื่นๆ',
        fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        search_text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_product_description_fingerprint (fingerprint), KEY idx_product_description_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    // Remember the seed run so edited/deleted defaults do not reappear on a later migration.
    await connection.query(`CREATE TABLE IF NOT EXISTS product_description_seeds (
        version VARCHAR(100) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await connection.beginTransaction();
    try {
        const version = 'initial-products-2026-11';
        const [applied] = await connection.query('SELECT version FROM product_description_seeds WHERE version = ? FOR UPDATE', [version]);
        let inserted = 0;
        if (!applied.length) {
            const values = productDescriptionSeeds.map(seed => {
                const row = normalizeProductDescription(seed);
                return [row.description, row.category, row.fingerprint, row.searchText];
            });
            const [result] = await connection.query('INSERT IGNORE INTO product_descriptions (description, category, fingerprint, search_text) VALUES ?', [values]);
            inserted = result.affectedRows;
            await connection.query('INSERT INTO product_description_seeds (version) VALUES (?)', [version]);
        }
        await connection.commit();
        return { inserted };
    } catch (error) { await connection.rollback(); throw error; }
}

async function main() {
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    const connection = await mysql.createConnection({ host: process.env.DBHOST || 'localhost', user: process.env.DBUSER, password: process.env.DBPWD, database: process.env.DB, port: process.env.DBPORT || 3306 });
    try { console.log('Product descriptions migration complete:', await migrateProductDescriptions(connection)); }
    finally { await connection.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error('Product descriptions migration failed:', error.message); process.exitCode = 1; });
