import database from "../service/database.js";

// 1. ดึงข้อมูลลงตาราง (Search + Filter + Pagination)
export async function getProjectInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, pStatus, dateRange, sort_by, sort_order } = req.query;
        const offset = (page - 1) * itemsPerPage;

        let sql = `SELECT * FROM caseProject WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM caseProject WHERE 1=1`;
        let params = [];

        if (search) {
            const term = `%${search}%`;
            const cond = ` AND (pId LIKE ? OR pAddress LIKE ? OR pDetail LIKE ?)`;
            sql += cond; countSql += cond;
            params.push(term, term, term);
        }

        if (pStatus) {
            sql += ` AND pStatus = ?`; countSql += ` AND pStatus = ?`;
            params.push(pStatus);
        }

        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) {
                 sql += ` AND dateCreate BETWEEN ? AND ?`;
                 countSql += ` AND dateCreate BETWEEN ? AND ?`;
                 params.push(start, end);
             }
        }

        if (sort_by) {
            sql += ` ORDER BY ${sort_by} ${sort_order === 'desc' ? 'DESC' : 'ASC'}`;
        } else {
            sql += ` ORDER BY pId DESC`;
        }

        const queryParams = [...params, Number(itemsPerPage), Number(offset)];
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);

        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// 2. ดึงรายละเอียดตาม ID (Get Detail)
export async function getProjectDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseProject WHERE pId = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Project not found' });
        }

        res.json({ message: 'success', data: rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 3. สร้างงานติดตั้งใหม่ (Create - Auto ID PJ-XXX)
export async function createProject(req, res) {
    try {
        const { pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // หา ID ล่าสุดที่ขึ้นต้นด้วย PJ-
        const [lastRows] = await database.query(
            `SELECT pId FROM caseProject WHERE pId LIKE 'PJ-%' ORDER BY LENGTH(pId) DESC, pId DESC LIMIT 1`
        );

        let newId = "PJ-001";
        if (lastRows.length > 0) {
            const lastId = lastRows[0].pId; // เช่น PJ-005
            const lastNum = parseInt(lastId.split('-')[1]); 
            newId = `PJ-${String(lastNum + 1).padStart(3, '0')}`; // ได้ PJ-006
        }

        // บันทึกข้อมูล (แปลงค่าว่างเป็น null)
        const sql = `INSERT INTO caseProject 
            (pId, pAddress, pDetail, pStatus, dateCreate, dateComplete) 
            VALUES (?, ?, ?, ?, ?, ?)`;

        await database.query(sql, [
            newId,
            pAddress,
            pDetail,
            pStatus || 'รอดำเนินการ',
            dateCreate || null,
            dateComplete || null
        ]);

        res.json({ message: 'success', pId: newId });

    } catch (error) {
        console.error('Error create project:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 4. อัปเดตงานติดตั้ง (Update)
export async function updateProject(req, res) {
    try {
        const { pId, pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        const sql = `UPDATE caseProject SET 
            pAddress = ?, pDetail = ?, pStatus = ?, dateCreate = ?, dateComplete = ?
            WHERE pId = ?`;

        await database.query(sql, [
            pAddress, 
            pDetail, 
            pStatus, 
            dateCreate || null, 
            dateComplete || null, 
            pId
        ]);

        res.json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 5. ลบงาน
export async function deleteProject(req, res) {
    try {
        await database.query('DELETE FROM caseProject WHERE pId = ?', [req.body.pId]);
        res.json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}