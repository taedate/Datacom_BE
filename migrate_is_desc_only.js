import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
    const { default: database } = await import('./service/database.js');
    try {
        console.log("Checking if is_desc_only column exists in document_items...");
        const [rows1] = await database.query("SHOW COLUMNS FROM document_items LIKE 'is_desc_only'");
        if (rows1.length === 0) {
            console.log("Column 'is_desc_only' does not exist in document_items. Adding column...");
            await database.query("ALTER TABLE document_items ADD COLUMN is_desc_only TINYINT(1) DEFAULT 0");
            console.log("Column 'is_desc_only' added successfully to document_items!");
        } else {
            console.log("Column 'is_desc_only' already exists in document_items. Skipping.");
        }

        console.log("Checking if is_desc_only column exists in quotation_template_items...");
        const [rows2] = await database.query("SHOW COLUMNS FROM quotation_template_items LIKE 'is_desc_only'");
        if (rows2.length === 0) {
            console.log("Column 'is_desc_only' does not exist in quotation_template_items. Adding column...");
            await database.query("ALTER TABLE quotation_template_items ADD COLUMN is_desc_only TINYINT(1) DEFAULT 0");
            console.log("Column 'is_desc_only' added successfully to quotation_template_items!");
        } else {
            console.log("Column 'is_desc_only' already exists in quotation_template_items. Skipping.");
        }
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
