import database from "../service/database.js";
import puppeteer from 'puppeteer-core';

export async function getCaseInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, caseStatus, caseType, dateRange, sort_by, sort_order, lastDate } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;

        // Optimized: Select only columns needed for List View
        let sql = `SELECT 
            caseId, 
            cusFirstName, 
            cusLastName, 
            cusPhone, 
            brokenSymptom, 
            caseType, 
            caseStatus, 
            datePickUp, 
            refSentRepairId,
            created_at
        FROM caseRepair WHERE 1=1`;

        let countSql = `SELECT COUNT(*) as total FROM caseRepair WHERE 1=1`;
        let params = [];

        // Logic การค้นหา (Search)
        if (search) {
            // เพิ่มการค้นหาด้วย refSentRepairId ด้วยก็ได้ (เผื่ออยากค้นหาจากเลขใบส่งซ่อม)
            const searchCondition = ` AND (caseId LIKE ? OR cusFirstName LIKE ? OR cusLastName LIKE ? OR cusPhone LIKE ? OR refSentRepairId LIKE ?)`;
            sql += searchCondition;
            countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
        }

        // Logic การกรอง (Filter)
        if (caseStatus) {
            sql += ` AND caseStatus = ?`;
            countSql += ` AND caseStatus = ?`;
            params.push(caseStatus);
        }

        if (caseType) {
            sql += ` AND caseType = ?`;
            countSql += ` AND caseType = ?`;
            params.push(caseType);
        }

        // Logic กรองวันที่ (String Match)
        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) {
                 sql += ` AND datePickUp BETWEEN ? AND ?`;
                 countSql += ` AND datePickUp BETWEEN ? AND ?`;
                 params.push(start, end);
             }
        }

        // If client provides lastDate -> use keyset pagination (more efficient for large offsets)
        if (lastDate) {
            sql += ` AND date(created_at) < ?`;
            params.push(lastDate);
            sql += ` ORDER BY created_at DESC LIMIT ?`;
            
            // ต้อง execute query ตรงนี้และ return เลยถ้าใช้ lastDate
            const [rows] = await database.query(sql, [...params, limit]);
            const hasMore = rows.length === limit;
            return res.json({ message: 'success', data: rows, hasMore });
        }

        // Logic Sorting (fallback to created_at)
        if (sort_by) {
            // ป้องกัน SQL Injection ตรง sort_by เล็กน้อย (ควร validate ว่า column มีจริงไหม)
            const allowedSorts = ['caseId', 'created_at', 'datePickUp', 'cusFirstName'];
            const safeSort = allowedSorts.includes(sort_by) ? sort_by : 'created_at';
            sql += ` ORDER BY ${safeSort} ${sort_order === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            sql += ` ORDER BY created_at DESC`;
        }

        // Pagination (offset-based for smaller page numbers)
        // ต้อง push limit กับ offset เข้าไปท้ายสุด
        // params เดิมมี search/filter values อยู่แล้ว
        
        // Execute SQL หลัก (เอา Data)
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, [...params, limit, offset]);
        
        // Execute SQL นับจำนวน (เอา Total)
        const [countResult] = await database.query(countSql, params);
        
        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / limit)
        });

    } catch (error) {
        console.error('Error fetching cases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// API สำหรับดึงตัวเลือกมาใส่ Dropdown
export async function getFilterOptions(req, res) {
    try {
        // cache filter options for 5 minutes to reduce DB hits
        const cacheKey = 'repair:filterOptions';
        try {
            const cache = (await import('../service/cache.js')).default;
            const cached = cache.get(cacheKey);
            if (cached) return res.json({ message: 'success', data: cached });

            const [statusRows] = await database.query('SELECT DISTINCT caseStatus FROM caseRepair');
            const [typeRows] = await database.query('SELECT DISTINCT caseType FROM caseRepair');
            const data = { statuses: statusRows.map(r => r.caseStatus).filter(Boolean), types: typeRows.map(r => r.caseType).filter(Boolean) };
            cache.set(cacheKey, data, 300);
            return res.json({ message: 'success', data });
        } catch (e) {
            // fallback without cache
            const [statusRows] = await database.query('SELECT DISTINCT caseStatus FROM caseRepair');
            const [typeRows] = await database.query('SELECT DISTINCT caseType FROM caseRepair');
            return res.json({ message: 'success', data: { statuses: statusRows.map(r => r.caseStatus).filter(Boolean), types: typeRows.map(r => r.caseType).filter(Boolean) } });
        }
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
}


// 1. ดึงรายละเอียดงานซ่อมรายเคส (Get Detail)
export async function getCaseDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseRepair WHERE caseId = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Case not found' });
        }
        res.json({ message: 'success', data: rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 2. สร้างงานซ่อมใหม่ (Create)
export async function createCase(req, res) {
    try {
        const {
            cusFirstName, cusLastName, cusPhone, caseInstitution,
            brokenSymptom, caseType, caseStatus,
            caseBrand, caseModel, caseSN, caseDurableArticles, caseEquipment,
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered
        } = req.body;

        // 1. กำหนด Prefix ตามประเภท
        let prefix = "CT"; 
        switch (caseType) {
            case "ซ่อมคอมพิวเตอร์": prefix = "PC"; break;
            case "ซ่อมโน็ตบุ๊ค": prefix = "NB"; break;
            case "ซ่อมปริ้นเตอร์": prefix = "PR"; break;
            case "ซ่อมมือถือ/แท็บเล็ต": prefix = "MB"; break;
            case "ลงโปรแกรม/OS": prefix = "SW"; break;
            default: prefix = "CT";
        }

        // 2. หา ID ล่าสุดของ Prefix นี้
        const [lastRows] = await database.query(
            `SELECT caseId FROM caseRepair WHERE caseId LIKE ? ORDER BY LENGTH(caseId) DESC, caseId DESC LIMIT 1`,
            [`${prefix}-%`]
        );

        // 3. รันเลขใหม่
        let newId = `${prefix}-001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].caseId;
            const lastNum = parseInt(lastId.split('-')[1]);
            newId = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
        }

        // 4. บันทึก (ใส่ NOW() ใน created_at)
        const sql = `INSERT INTO caseRepair 
        (caseId, cusFirstName, cusLastName, cusPhone, caseInstitution, 
         brokenSymptom, caseType, caseStatus, 
         caseBrand, caseModel, caseSN, caseDurableArticles, caseEquipment,
         datePickUp, dateBeforePicUp, dateComplete, dateDelivered, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

        await database.query(sql, [
            newId, cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, caseStatus || 'รับเครื่องแล้ว',
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', caseEquipment || '',
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null
        ]);

        res.json({ message: 'success', caseId: newId });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}
// 3. อัปเดตงานซ่อม (Update)
export async function updateCase(req, res) {
    try {
        const {
            caseId, cusFirstName, cusLastName, cusPhone, caseInstitution,
            brokenSymptom, caseType, caseStatus,
            caseBrand, caseModel, caseSN, caseDurableArticles, 
            caseEquipment, // ✅ เพิ่มตรงนี้
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered
        } = req.body;

        const sql = `UPDATE caseRepair SET 
            cusFirstName=?, cusLastName=?, cusPhone=?, caseInstitution=?,
            brokenSymptom=?, caseType=?, caseStatus=?,
            caseBrand=?, caseModel=?, caseSN=?, caseDurableArticles=?, caseEquipment=?,
            datePickUp=?, dateBeforePicUp=?, dateComplete=?, dateDelivered=?
            WHERE caseId=?`;

        await database.query(sql, [
            cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, caseStatus,
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', 
            caseEquipment || '', // ✅ เพิ่มค่า
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null,
            caseId
        ]);

        res.json({ message: 'success' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}


