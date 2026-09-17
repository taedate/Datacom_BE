import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
    const { default: database } = await import('./service/database.js');
    try {
        console.log("Checking caseRepair columns...");
        const [rows] = await database.query("SHOW COLUMNS FROM caseRepair");
        const columns = rows.map(c => c.Field);

        if (!columns.includes('repairDetails')) {
            console.log("Adding repairDetails column...");
            await database.query("ALTER TABLE caseRepair ADD COLUMN repairDetails TEXT DEFAULT NULL AFTER caseEquipment");
            console.log("repairDetails column added.");
        } else {
            console.log("repairDetails column already exists.");
        }

        if (!columns.includes('repairCost')) {
            console.log("Adding repairCost column...");
            await database.query("ALTER TABLE caseRepair ADD COLUMN repairCost DECIMAL(10,2) DEFAULT NULL AFTER repairDetails");
            console.log("repairCost column added.");
        } else {
            console.log("repairCost column already exists.");
        }

        if (!columns.includes('repairPrice')) {
            console.log("Adding repairPrice column...");
            await database.query("ALTER TABLE caseRepair ADD COLUMN repairPrice DECIMAL(10,2) DEFAULT NULL AFTER repairCost");
            console.log("repairPrice column added.");
        } else {
            console.log("repairPrice column already exists.");
        }

        console.log("Migration completed successfully!");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
