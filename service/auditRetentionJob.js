import cron from 'node-cron';
import database from './database.js';

const RETENTION_DAYS = 180;

export async function cleanupAuditLogs() {
    await database.query(
        `DELETE FROM audit_logs
         WHERE createdAt < (NOW() - INTERVAL ? DAY)`,
        [RETENTION_DAYS]
    );
}

export function startAuditRetentionJob() {
    // Run monthly on day 1 at 03:15 server time.
    cron.schedule('15 3 1 * *', async () => {
        try {
            await cleanupAuditLogs();
            console.log('Audit retention cleanup completed');
        } catch (error) {
            console.error('Audit retention cleanup failed:', error.message);
        }
    });
}
