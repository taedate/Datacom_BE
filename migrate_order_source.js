import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
    const { default: database } = await import('./service/database.js');
    try {
        console.log("Checking if order_source column exists...");
        const [rows] = await database.query("SHOW COLUMNS FROM document_items LIKE 'order_source'");
        if (rows.length === 0) {
            console.log("Column 'order_source' does not exist. Adding column...");
            await database.query("ALTER TABLE document_items ADD COLUMN order_source VARCHAR(255) DEFAULT NULL");
            console.log("Column 'order_source' added successfully!");
        } else {
            console.log("Column 'order_source' already exists. Skipping.");
        }
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
