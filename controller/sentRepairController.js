import database from "../service/database.js";


// ------------------------------------------------------------------
// 1. CRUD Functions
// ------------------------------------------------------------------
export async function getSentRepairInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, caseSType, dateRange, sort_by, sort_order, status, lastDate } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;
        let sql = `SELECT caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at, (SELECT caseId FROM caseRepair WHERE refSentRepairId COLLATE utf8mb4_unicode_ci = caseSentRepair.caseSId COLLATE utf8mb4_unicode_ci LIMIT 1) AS refCaseId FROM caseSentRepair WHERE 1=1`;
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
    } catch (error) { 
        console.error("GET INFO ERROR:", error);
        res.status(500).json({ error: error.message }); 
    }
}

export async function getSentRepairDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at, (SELECT caseId FROM caseRepair WHERE refSentRepairId COLLATE utf8mb4_unicode_ci = caseSentRepair.caseSId COLLATE utf8mb4_unicode_ci LIMIT 1) AS refCaseId FROM caseSentRepair WHERE caseSId = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'error', error: 'Case not found' });
        res.json({ message: 'success', data: rows[0] });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function createSentRepair(req, res) {
    try {
        const { 
            caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, 
            caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, 
            caseSEquipment, dateOfReceived, caseSRecipient,
            refCaseId // <--- ค่านี้สำคัญ
        } = req.body;

        // 🔍 DEBUG 1: เช็คว่า Frontend ส่งค่ามาครบไหม
        console.log("📌 DEBUG PAYLOAD:", { 
            caseSCusName, 
            refCaseId: refCaseId // ถ้าตรงนี้เป็น undefined หรือ null แสดงว่า Frontend ผิด
        });

        const prefix = "S"; 
        
        // --- Gen ID ---
        const [lastRows] = await database.query(`SELECT caseSId FROM caseSentRepair WHERE caseSId LIKE ? ORDER BY LENGTH(caseSId) DESC, caseSId DESC LIMIT 1`, [`${prefix}-%`]);
        let newId = `${prefix}-001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].caseSId;
            const lastNum = parseInt(lastId.split('-')[1]); 
            newId = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
        }

        // --- Insert ---
        const sql = `INSERT INTO caseSentRepair (caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
        
        await database.query(sql, [
            newId, caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', 
            DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', 
            caseSSN || '', brokenSymptom || '', caseSEquipment || '', 
            dateOfReceived || null, caseSRecipient || '' 
        ]);

        // ============================================================
        // Update Link Back
        // ============================================================
        if (refCaseId) {
            console.log(`🔄 กำลังอัปเดต caseRepair ID: ${refCaseId} ด้วย SentID: ${newId}`);
            
            const updateSql = `
                UPDATE caseRepair 
                SET 
                    refSentRepairId = ?, 
                    caseStatus = 'ส่งซ่อมอยู่' 
                WHERE caseId = ?
            `;
            
            // 🔍 DEBUG 2: ดูผลลัพธ์การอัปเดต
            const [result] = await database.query(updateSql, [newId, refCaseId]);
            console.log("✅ Update Result:", result);

            if (result.affectedRows === 0) {
                console.error("⚠️ อัปเดตไม่สำเร็จ! ไม่เจอ caseId นี้ในตาราง caseRepair");
            }
        } else {
            console.warn("⚠️ ไม่มีการอัปเดตกลับ เพราะ refCaseId เป็นค่าว่าง (Frontend ไม่ได้ส่งมา)");
        }
        // ============================================================

        res.json({ message: 'success', caseSId: newId });

    } catch (error) { 
        console.error("❌ ERROR:", error);
        res.status(500).json({ message: 'error', error: error.message }); 
    }
}

export async function updateSentRepair(req, res) {
    try {
        const { caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient } = req.body;
        const sql = `UPDATE caseSentRepair SET caseSToMechanic=?, caseSOrderNo=?, caseSCusName=?, DateSOfSent=?, caseSType=?, caseSBrand=?, caseSModel=?, caseSSN=?, brokenSymptom=?, caseSEquipment=?, dateOfReceived=?, caseSRecipient=? WHERE caseSId=?`;
        await database.query(sql, [caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', caseSSN || '', brokenSymptom || '', caseSEquipment || '', dateOfReceived || null, caseSRecipient || '', caseSId]);
        
        // Auto-sync status back to the main CaseRepair
        if (dateOfReceived && dateOfReceived !== '' && dateOfReceived !== 'null') {
             const updateCaseSql = `UPDATE caseRepair SET caseStatus = 'ซ่อมเสร็จ', dateComplete = ? WHERE refSentRepairId COLLATE utf8mb4_unicode_ci = ?`;
             const [result] = await database.query(updateCaseSql, [dateOfReceived, caseSId]);
             console.log(`Auto-Sync CaseRepair Result for ${caseSId}:`, result.affectedRows, "rows affected.");
        }
        
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

