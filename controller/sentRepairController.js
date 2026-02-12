import database from "../service/database.js";

// --- Date Helper ---
function formatDateThai(dateStr) {
    if (!dateStr) return "";
    let day, month, year;
    dateStr = dateStr.split(' ')[0]; 
    if (dateStr.includes('/')) { [day, month, year] = dateStr.split('/'); } 
    else if (dateStr.includes('-')) { [day, month, year] = dateStr.split('-'); } 
    else { return dateStr; }
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const monthIndex = parseInt(month, 10) - 1;
    const dayInt = parseInt(day, 10);
    if (monthIndex >= 0 && monthIndex < 12) { return `${dayInt} ${thaiMonths[monthIndex]} ${year}`; }
    return dateStr;
}

// ------------------------------------------------------------------
// 1. CRUD Functions
// ------------------------------------------------------------------
export async function getSentRepairInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, caseSType, dateRange, sort_by, sort_order, status, lastDate } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;
        let sql = `SELECT caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at FROM caseSentRepair WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM caseSentRepair WHERE 1=1`;
        let params = [];

        if (search) {
            const searchCondition = ` AND (caseSId LIKE ? OR caseSCusName LIKE ? OR caseSToMechanic LIKE ? OR caseSOrderNo LIKE ? OR caseSSN LIKE ?)`;
            sql += searchCondition; countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
        }
        if (caseSType) { sql += ` AND caseSType = ?`; countSql += ` AND caseSType = ?`; params.push(caseSType); }
        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) { sql += ` AND DateSOfSent BETWEEN ? AND ?`; countSql += ` AND DateSOfSent BETWEEN ? AND ?`; params.push(start, end); }
        }
        if (status) {
            if (status === 'รับคืนแล้ว') { sql += ` AND dateOfReceived IS NOT NULL`; countSql += ` AND dateOfReceived IS NOT NULL`; } 
            else if (status === 'ส่งซ่อมอยู่') { sql += ` AND dateOfReceived IS NULL`; countSql += ` AND dateOfReceived IS NULL`; }
        }
        // keyset pagination support
        if (lastDate) {
            sql += ` AND date(created_at) < ?`;
            params.push(lastDate);
            sql += ` ORDER BY created_at DESC LIMIT ?`;
            const [rows] = await database.query(sql, [...params, limit]);
            const hasMore = rows.length === limit;
            return res.json({ message: 'success', data: rows, hasMore });
        }

        if (sort_by) { sql += ` ORDER BY ${sort_by} ${sort_order === 'asc' ? 'ASC' : 'DESC'}, caseSId DESC`; } 
        else { sql += ` ORDER BY created_at DESC, caseSId DESC`; }

        const queryParams = [...params, Number(itemsPerPage), Number(offset)];
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);
        
        res.json({ message: 'success', data: rows, totalItems: countResult[0].total, totalPages: Math.ceil(countResult[0].total / itemsPerPage) });
    } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
}

export async function getSentRepairDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseSentRepair WHERE caseSId = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'error', error: 'Case not found' });
        res.json({ message: 'success', data: rows[0] });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function createSentRepair(req, res) {
    try {
        const { caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient } = req.body;
        const prefix = "S"; 
        const [lastRows] = await database.query(`SELECT caseSId FROM caseSentRepair WHERE caseSId LIKE ? ORDER BY LENGTH(caseSId) DESC, caseSId DESC LIMIT 1`, [`${prefix}-%`]);
        let newId = `${prefix}-001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].caseSId;
            const lastNum = parseInt(lastId.split('-')[1]);
            newId = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
        }
        const sql = `INSERT INTO caseSentRepair (caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
        await database.query(sql, [newId, caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', caseSSN || '', brokenSymptom || '', caseSEquipment || '', dateOfReceived || null, caseSRecipient || '' ]);
        res.json({ message: 'success', caseSId: newId });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function updateSentRepair(req, res) {
    try {
        const { caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient } = req.body;
        const sql = `UPDATE caseSentRepair SET caseSToMechanic=?, caseSOrderNo=?, caseSCusName=?, DateSOfSent=?, caseSType=?, caseSBrand=?, caseSModel=?, caseSSN=?, brokenSymptom=?, caseSEquipment=?, dateOfReceived=?, caseSRecipient=? WHERE caseSId=?`;
        await database.query(sql, [caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', caseSSN || '', brokenSymptom || '', caseSEquipment || '', dateOfReceived || null, caseSRecipient || '', caseSId]);
        res.json({ message: 'success' });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function deleteSentRepair(req, res) {
    try {
        const { caseSId } = req.body;
        await database.query('DELETE FROM caseSentRepair WHERE caseSId = ?', [caseSId]);
        res.json({ message: 'success' });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

