import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
    const { default: database } = await import('./service/database.js');
    try {
        console.log("Creating quotation_templates table...");
        await database.query(`
            CREATE TABLE IF NOT EXISTS quotation_templates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log("Creating quotation_template_items table...");
        await database.query(`
            CREATE TABLE IF NOT EXISTS quotation_template_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                template_id INT NOT NULL,
                description TEXT,
                quantity DECIMAL(10, 2) DEFAULT 1,
                unit VARCHAR(50),
                unit_price DECIMAL(15, 2),
                is_sub_item TINYINT(1) DEFAULT 0,
                sort_order INT DEFAULT 0,
                FOREIGN KEY (template_id) REFERENCES quotation_templates(id) ON DELETE CASCADE
            )
        `);

        console.log("Migration successful!");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
