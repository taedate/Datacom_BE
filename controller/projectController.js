import database from "../service/database.js";

// 1. ดึงข้อมูลลงตาราง (Search + Filter + Pagination)
export async function getProjectInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, pStatus, dateRange, sort_by, sort_order, lastDate } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;

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
            sql += ` ORDER BY pId DESC`; // Default sort
        }

        const queryParams = [...params, Number(limit), Number(offset)];
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);

        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}

// 2. ดึงรายละเอียดตาม ID
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

// 3. สร้างงานติดตั้งใหม่
export async function createProject(req, res) {
    try {
        const { pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // --- Logic จัดการรูปภาพหลายรูป ---
        let imagePaths = [];
        // req.files (มี s) จะมาเป็น Array
        if (req.files && req.files.length > 0) {
            imagePaths = req.files.map(file => file.path.replace(/\\/g, "/"));
        }
        // แปลง Array เป็น String เพื่อเก็บใน Database (เช่น '["uploads/a.jpg", "uploads/b.jpg"]')
        const pImageJSON = imagePaths.length > 0 ? JSON.stringify(imagePaths) : null;


        // --- Gen ID ---
        const [lastRows] = await database.query(
            `SELECT pId FROM caseProject WHERE pId LIKE 'PJ-%' ORDER BY LENGTH(pId) DESC, pId DESC LIMIT 1`
        );
        let newId = "PJ-001";
        if (lastRows.length > 0) {
            const lastId = lastRows[0].pId;
            const parts = lastId.split('-');
            if (parts.length === 2) {
                const lastNum = parseInt(parts[1]); 
                newId = `PJ-${String(lastNum + 1).padStart(3, '0')}`;
            }
        }

        const sql = `INSERT INTO caseProject 
            (pId, pAddress, pDetail, pStatus, pImage, dateCreate, dateComplete, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;

        await database.query(sql, [
            newId,
            pAddress || null,
            pDetail || null,
            pStatus || 'รอดำเนินการ',
            pImageJSON, // ใส่ JSON String ลงไป
            dateCreate || null,
            dateComplete || null
        ]);

        res.json({ message: 'success', pId: newId, status: 'created' });

    } catch (error) {
        console.error('Error in createProject:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 4. อัปเดตงาน (Update) - แบบเพิ่มรูปใหม่เข้าไปต่อท้ายรูปเดิม
export async function updateProject(req, res) {
    try {
        const { pId, pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // 1. หาข้อมูลเก่าก่อน เพื่อเอารูปเก่ามา
        const [oldRows] = await database.query('SELECT pImage FROM caseProject WHERE pId = ?', [pId]);
        let currentImages = [];
        
        if (oldRows.length > 0 && oldRows[0].pImage) {
            try {
                // แปลงจาก String ใน DB กลับเป็น Array
                currentImages = JSON.parse(oldRows[0].pImage);
            } catch (e) {
                // เผื่อข้อมูลเก่าไม่ได้เป็น JSON (เช่นเป็น path เดี่ยวๆ ของระบบเก่า)
                currentImages = [oldRows[0].pImage];
            }
        }

        // 2. ถ้ามีรูปใหม่เข้ามา ให้เอาไปต่อ (Push) ใส่ Array เดิม
        if (req.files && req.files.length > 0) {
            const newPaths = req.files.map(file => file.path.replace(/\\/g, "/"));
            currentImages = [...currentImages, ...newPaths]; // รวมเก่า + ใหม่
        }

        // 3. แปลงกลับเป็น JSON String เพื่อเตรียมบันทึก
        const pImageJSON = currentImages.length > 0 ? JSON.stringify(currentImages) : null;

        const sql = `UPDATE caseProject SET 
            pAddress = ?, pDetail = ?, pStatus = ?, dateCreate = ?, dateComplete = ?, pImage = ?
            WHERE pId = ?`;

        await database.query(sql, [
            pAddress, 
            pDetail, 
            pStatus, 
            dateCreate || null, 
            dateComplete || null,
            pImageJSON, // อัปเดต list รูปภาพใหม่
            pId
        ]);

        res.json({ message: 'success' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 5. ลบงาน
export async function deleteProject(req, res) {
    try {
        // (Optional) คุณอาจจะอยากดึงข้อมูลมาเพื่อลบไฟล์รูปภาพออกจาก Disk ด้วยก่อนลบจาก DB
        // const [rows] = await database.query('SELECT pImage FROM caseProject WHERE pId = ?', [req.body.pId]);
        // if (rows.length > 0 && rows[0].pImage) { fs.unlinkSync(rows[0].pImage); }

        await database.query('DELETE FROM caseProject WHERE pId = ?', [req.body.pId]);
        res.json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}