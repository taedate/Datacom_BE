// สคริปต์รัน Migration: เพิ่มคอลัมน์ statusDate ในตาราง caseRepair
// วิธีใช้: node db/run_status_dates_migration.js

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function runMigration() {
    const connection = await mysql.createConnection({
        host: process.env.DBHOST || 'localhost',
        user: process.env.DBUSER,
        password: process.env.DBPWD,
        database: process.env.DB,
        port: process.env.DBPORT || 3306,
    });

    console.log('Connected to MySQL. Running migration...');

    const queries = [
        // เพิ่ม 6 คอลัมน์ใหม่ (ใช้ ADD COLUMN IF NOT EXISTS ไม่ได้ใน MySQL บางเวอร์ชัน จึงใช้ try-catch แทน)
        `ALTER TABLE caseRepair ADD COLUMN statusDateWaiting DATETIME DEFAULT NULL`,
        `ALTER TABLE caseRepair ADD COLUMN statusDateReceived DATETIME DEFAULT NULL`,
        `ALTER TABLE caseRepair ADD COLUMN statusDateWaitPart DATETIME DEFAULT NULL`,
        `ALTER TABLE caseRepair ADD COLUMN statusDateRepairing DATETIME DEFAULT NULL`,
        `ALTER TABLE caseRepair ADD COLUMN statusDateComplete DATETIME DEFAULT NULL`,
        `ALTER TABLE caseRepair ADD COLUMN statusDateDelivered DATETIME DEFAULT NULL`,
    ];

    for (const sql of queries) {
        try {
            await connection.query(sql);
            console.log('✅', sql.substring(0, 80));
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('⏭️  Column already exists, skipping:', sql.substring(40, 80));
            } else {
                console.error('❌ Error:', err.message);
            }
        }
    }

    // Backfill: ใส่ค่าเริ่มต้นให้เคสเดิม
    console.log('\nBackfilling existing data...');

    const backfillQueries = [
        `UPDATE caseRepair SET statusDateReceived = created_at WHERE statusDateReceived IS NULL AND caseStatus IS NOT NULL`,
        `UPDATE caseRepair SET statusDateComplete = dateComplete WHERE statusDateComplete IS NULL AND dateComplete IS NOT NULL`,
        `UPDATE caseRepair SET statusDateDelivered = dateDelivered WHERE statusDateDelivered IS NULL AND dateDelivered IS NOT NULL`,
    ];

    for (const sql of backfillQueries) {
        try {
            const [result] = await connection.query(sql);
            console.log(`✅ Updated ${result.affectedRows} rows`);
        } catch (err) {
            console.error('❌ Backfill error:', err.message);
        }
    }

    await connection.end();
    console.log('\n🎉 Migration completed!');
}

runMigration().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
