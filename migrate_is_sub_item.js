import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
    const { default: database } = await import('./service/database.js');
    try {
        console.log("Checking if is_sub_item column exists...");
        const [rows] = await database.query("SHOW COLUMNS FROM document_items LIKE 'is_sub_item'");
        if (rows.length === 0) {
            console.log("Column 'is_sub_item' does not exist. Adding column...");
            await database.query("ALTER TABLE document_items ADD COLUMN is_sub_item TINYINT(1) DEFAULT 0");
            console.log("Column 'is_sub_item' added successfully!");
        } else {
            console.log("Column 'is_sub_item' already exists. Skipping.");
        }
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
