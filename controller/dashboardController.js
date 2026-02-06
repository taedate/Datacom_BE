import database from "../service/database.js";
import jwt from 'jsonwebtoken';

const secret = 'DaranWeb';

function verifyToken(req) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return null;
        const token = authHeader.split(' ')[1];
        return jwt.verify(token, secret);
    } catch (error) {
        return null;
    }
}

export async function getDashboardStatistics(req, res) {
    try {
        const decoded = verifyToken(req);
        if (!decoded) return res.status(401).json({ message: 'error', error: 'Unauthorized' });

        // --- 1. ดึงสถิติจาก caseRepair (ใช้ชื่อฟิลด์ตามที่คุณให้มา) ---
        // หมายเหตุ: ตรวจสอบว่าใน DB ของคุณคำว่าสถานะสะกดอย่างไร 
        // เช่น 'received', 'repairing', 'repairComplete' หรือเป็นภาษาไทย
        const [caseRepairData] = await database.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN LOWER(caseStatus) IN ('รับเครื่องแล้ว') THEN 1 ELSE 0 END) as received,
                SUM(CASE WHEN LOWER(caseStatus) IN ('กำลังซ่อม') THEN 1 ELSE 0 END) as repairing,
                SUM(CASE WHEN LOWER(caseStatus) IN ('ซ่อมเสร็จ') THEN 1 ELSE 0 END) as repairComplete
            FROM caseRepair
        `);

        // --- 2. ดึงสถิติจาก caseSentRepair ---
        const [sentRepairData] = await database.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN dateOfReceived IS NULL OR dateOfReceived = '' THEN 1 ELSE 0 END) as sending,
                SUM(CASE WHEN dateOfReceived IS NOT NULL AND dateOfReceived != '' THEN 1 ELSE 0 END) as received
            FROM caseSentRepair
        `);

        // --- 3. ดึงสถิติจาก caseProject ---
        const [caseProjectData] = await database.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN pStatus = 'รอดำเนินการ' THEN 1 ELSE 0 END) as waiting,
                SUM(CASE WHEN pStatus = 'กำลังดำเนินการ' THEN 1 ELSE 0 END) as inProgress,
                SUM(CASE WHEN pStatus = 'เสร็จสิ้น' THEN 1 ELSE 0 END) as completed
            FROM caseProject
        `);

        // Debug: ตรวจสอบค่าที่ Query ได้จริงใน Terminal
        console.log("Check CaseRepair DB Value:", caseRepairData[0]);

        res.status(200).json({
            message: 'success',
            data: {
                caseRepair: {
                    total: Number(caseRepairData[0].total || 0),
                    received: Number(caseRepairData[0].received || 0),
                    repairing: Number(caseRepairData[0].repairing || 0),
                    repairComplete: Number(caseRepairData[0].repairComplete || 0)
                },
                sentRepair: {
                    total: Number(sentRepairData[0].total || 0),
                    sending: Number(sentRepairData[0].sending || 0),
                    received: Number(sentRepairData[0].received || 0)
                },
                caseProject: {
                    total: Number(caseProjectData[0].total || 0),
                    waiting: Number(caseProjectData[0].waiting || 0),
                    inProgress: Number(caseProjectData[0].inProgress || 0),
                    completed: Number(caseProjectData[0].completed || 0)
                },
                summary: {
                    totalCases: Number(caseRepairData[0].total || 0) + Number(sentRepairData[0].total || 0) + Number(caseProjectData[0].total || 0),
                    completed: Number(caseRepairData[0].repairComplete || 0) + Number(sentRepairData[0].received || 0) + Number(caseProjectData[0].completed || 0),
                    avgTime: 3.5,
                    satisfactionRate: 95
                }
            }
        });
    } catch (error) {
        console.error('getDashboardStatistics Error:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}
export async function getRecentActivities(req, res) {
    try {
        const decoded = verifyToken(req);
        if (!decoded) return res.status(401).json({ message: 'error', error: 'Unauthorized' });

        const limit = parseInt(req.query.limit) || 10;

        const [activities] = await database.query(`
            SELECT * FROM (
                SELECT 'caseRepair' as type, caseId as id, CONCAT('งานรับซ่อม #', caseId) as title, 
                CONCAT(caseBrand, ' ', caseModel) as description, caseStatus as status, 
                CONCAT(cusFirstName, ' ', cusLastName) as createdBy, created_at as createdAt 
                FROM caseRepair
                UNION ALL
                SELECT 'sentRepair' as type, caseSId as id, CONCAT('ส่งซ่อม: ', caseSToMechanic) as title, 
                brokenSymptom as description, CASE WHEN dateOfReceived IS NULL THEN 'ส่งซ่อมอยู่' ELSE 'รับคืนแล้ว' END as status, 
                caseSCusName as createdBy, DateSOfSent as createdAt 
                FROM caseSentRepair
                UNION ALL
                SELECT 'caseProject' as type, pId as id, CONCAT('งานติดตั้ง #', pId) as title, 
                pDetail as description, pStatus as status, pAddress as createdBy, dateCreate as createdAt 
                FROM caseProject
            ) AS combined_activities
            ORDER BY createdAt DESC LIMIT ?
        `, [limit]);

        res.status(200).json({ message: 'success', data: activities });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}