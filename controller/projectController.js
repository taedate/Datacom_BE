import database from "../service/database.js";

// 1. ดึงข้อมูลลงตาราง (Search + Filter + Pagination)
export async function getProjectInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, pStatus, dateRange, sort_by, sort_order } = req.query;
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

// 3. สร้างงานติดตั้งใหม่ (สร้างเอกสารก่อน ยังไม่มีรูป)
export async function createProject(req, res) {
    try {
        const { pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // --- Gen ID (PJ-XXX) ---
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

        // สร้างใหม่: pImage เป็น null ไปก่อน (รูปจะมาตอน Update)
        await database.query(sql, [
            newId,
            pAddress || "",
            pDetail || "",
            pStatus || 'รอดำเนินการ',
            null, // pImage = null
            dateCreate || null,
            dateComplete || null
        ]);

        res.json({ message: 'success', pId: newId, status: 'created' });

    } catch (error) {
        console.error('Error in createProject:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 4. อัปเดตงาน (Update) - เพิ่มรูปเข้าโฟลเดอร์ตาม pId
export async function updateProject(req, res) {
    try {
        const { pId, pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // 1. ดึงข้อมูลเก่าเพื่อเอารูปเดิมมาตั้งต้น
        const [oldRows] = await database.query('SELECT pImage FROM caseProject WHERE pId = ?', [pId]);
        let currentImages = [];
        
        if (oldRows.length > 0 && oldRows[0].pImage) {
            try {
                currentImages = JSON.parse(oldRows[0].pImage);
            } catch (e) {
                // กันเหนียว กรณีข้อมูลเก่าไม่ใช่ JSON
                currentImages = [oldRows[0].pImage];
            }
            // แปลงให้เป็น Array เสมอ
            if (!Array.isArray(currentImages)) currentImages = [currentImages];
        }

        // 2. จัดการรูปภาพใหม่ (ถ้ามี)
        // Multer ได้นำไฟล์ไปวางใน uploads/projects/PJ-XXX ให้เรียบร้อยแล้ว
        if (req.files && req.files.length > 0) {
            const newPaths = req.files.map(file => {
                // สร้าง Path ที่ถูกต้องเพื่อเก็บใน DB (ใช้ / เสมอ)
                // ผลลัพธ์: uploads/projects/PJ-018/filename.jpg
                return `uploads/projects/${pId}/${file.filename}`;
            });
            
            // เอาของใหม่ต่อท้ายของเก่า
            currentImages = [...currentImages, ...newPaths];
        }

        // 3. แปลงเป็น JSON String เพื่อบันทึก
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
            pImageJSON, 
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
        // (Optional) ถ้าอยากลบไฟล์รูปภาพออกจาก Disk ด้วย ต้องเขียน Logic เพิ่มตรงนี้
        // โดยการ SELECT pImage มาก่อน แล้ววนลูป fs.unlinkSync

        await database.query('DELETE FROM caseProject WHERE pId = ?', [req.body.pId]);
        res.json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}