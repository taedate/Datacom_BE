import database from "../service/database.js";

// Helper: แมปสถานะ -> คอลัมน์วันที่ในฐานข้อมูล
function getStatusDateColumn(status) {
    const map = {
        'รอรับเครื่อง':   'statusDateWaiting',
        'รับเครื่องแล้ว':  'statusDateReceived',
        'รออะไหล่':       'statusDateWaitPart',
        'รอสินค้า':       'statusDateWaitPart',
        'กำลังซ่อม':      'statusDateRepairing',
        'ส่งซ่อมอยู่':     'statusDateRepairing',
        'ซ่อมเสร็จ':      'statusDateComplete',
        'ส่งมอบ':         'statusDateDelivered',
    };
    const col = map[status] || null;
    return {
        column: col,
        // สำหรับ INSERT: เพิ่มชื่อคอลัมน์ + ค่า NOW()
        sqlColumn: col ? `, ${col}` : '',
        sqlValue: col ? ', NOW()' : '',
        // สำหรับ UPDATE: เพิ่ม SET clause
        sqlUpdate: col ? `, ${col}=NOW()` : '',
    };
}

// Helper: แปลง Date เป็นรูปแบบไทย (คืน null ถ้าแปลงไม่ได้)
function formatThaiDate(dateValue) {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('th-TH', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Bangkok'
    }) + ' น.';
}

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
            caseInstitution,
            brokenSymptom, 
            caseType, 
            caseStatus,
            datePickUp, 
            refSentRepairId,
            staffName,
            caseBrand,
            caseModel,
            caseSN,
            caseEquipment,
            created_at
        FROM caseRepair WHERE 1=1`;

        let countSql = `SELECT COUNT(*) as total FROM caseRepair WHERE 1=1`;
        let params = [];

        // Logic การค้นหา (Search)
        if (search) {
            // เพิ่มการค้นหาด้วย refSentRepairId ด้วยก็ได้ (เผื่ออยากค้นหาจากเลขใบส่งซ่อม)
            const searchCondition = ` AND (caseId LIKE ? OR cusFirstName LIKE ? OR cusLastName LIKE ? OR cusPhone LIKE ? OR caseInstitution LIKE ? OR refSentRepairId LIKE ?)`;
            sql += searchCondition;
            countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
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
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered, staffName
        } = req.body;

        // 1. กำหนด Prefix ตามประเภท
        console.log("Create Case Request Type:", caseType, "| Length:", caseType ? caseType.length : 0);
        let prefix = "CT"; 
        switch (caseType) {
            case "ซ่อมคอมพิวเตอร์": prefix = "PC"; break;
            case "ซ่อมโน็ตบุ๊ค": prefix = "NB"; break;
            case "ซ่อมปริ้นเตอร์": prefix = "PR"; break;
            case "ซ่อมมือถือ/แท็บเล็ต": prefix = "MB"; break;
            case "ลงโปรแกรม/OS": prefix = "SW"; break;
            case "UPS": prefix = "UP"; break;
            case "เปลี่ยนอะไหล่": prefix = "SP"; break; // SP = Spare Part
            case "กู้ข้อมูล": prefix = "DR"; break;   // DR = Data Recovery
            case "อื่นๆ": prefix = "OT"; break;       // OT = Other
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

        // 4. กำหนด statusDate ตามสถานะเริ่มต้น
        const initialStatus = caseStatus || 'รับเครื่องแล้ว';
        const statusDateColumns = getStatusDateColumn(initialStatus);

        // 5. บันทึก (ใส่ NOW() ใน created_at + statusDate)
        const sql = `INSERT INTO caseRepair 
        (caseId, cusFirstName, cusLastName, cusPhone, caseInstitution, 
         brokenSymptom, caseType, caseStatus, 
         caseBrand, caseModel, caseSN, caseDurableArticles, caseEquipment,
         datePickUp, dateBeforePicUp, dateComplete, dateDelivered, staffName,
         created_at${statusDateColumns.sqlColumn}) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()${statusDateColumns.sqlValue})`;

        await database.query(sql, [
            newId, cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, initialStatus,
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', caseEquipment || '',
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null, staffName || ''
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
            caseEquipment,
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered, staffName
        } = req.body;

        // ตรวจสอบว่าสถานะเปลี่ยนหรือไม่ เพื่อ auto-set statusDate
        const [currentRows] = await database.query('SELECT caseStatus FROM caseRepair WHERE caseId = ?', [caseId]);
        const oldStatus = currentRows.length > 0 ? currentRows[0].caseStatus : null;
        const statusChanged = oldStatus !== caseStatus;

        // สร้าง SQL แบบ dynamic: ถ้าสถานะเปลี่ยนจะ set statusDate ด้วย
        let statusDateSql = '';
        if (statusChanged && caseStatus) {
            const col = getStatusDateColumn(caseStatus);
            statusDateSql = col.sqlUpdate;
        }

        const sql = `UPDATE caseRepair SET 
            cusFirstName=?, cusLastName=?, cusPhone=?, caseInstitution=?,
            brokenSymptom=?, caseType=?, caseStatus=?,
            caseBrand=?, caseModel=?, caseSN=?, caseDurableArticles=?, caseEquipment=?,
            datePickUp=?, dateBeforePicUp=?, dateComplete=?, dateDelivered=?, staffName=?,
            updated_at=NOW()${statusDateSql}
            WHERE caseId=?`;

        await database.query(sql, [
            cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, caseStatus,
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', 
            caseEquipment || '',
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null, staffName || '',
            caseId
        ]);

        res.json({ message: 'success' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

export async function updateCaseStatus(req, res) {
    try {
        const { caseId, caseStatus } = req.body;
        if (!caseId || !caseStatus) {
            return res.status(400).json({ message: 'error', error: 'caseId and caseStatus are required' });
        }

        const [currentRows] = await database.query('SELECT caseStatus, dateComplete, dateDelivered FROM caseRepair WHERE caseId = ?', [caseId]);
        if (currentRows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Case not found' });
        }
        const oldStatus = currentRows[0].caseStatus;
        const statusChanged = oldStatus !== caseStatus;

        if (statusChanged) {
            const col = getStatusDateColumn(caseStatus);
            let statusDateSql = col.sqlUpdate;

            const now = new Date();
            const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
            const yyyy = bangkokTime.getFullYear();
            const mm = String(bangkokTime.getMonth() + 1).padStart(2, '0');
            const dd = String(bangkokTime.getDate()).padStart(2, '0');
            const todayFormatted = `${yyyy}-${mm}-${dd}`;

            let extraFieldsSql = '';
            let extraParams = [];

            if (caseStatus === "ซ่อมเสร็จ" && !currentRows[0].dateComplete) {
                extraFieldsSql += `, dateComplete = ?`;
                extraParams.push(todayFormatted);
            }
            if (caseStatus === "ส่งมอบ" && !currentRows[0].dateDelivered) {
                if (!currentRows[0].dateComplete) {
                    extraFieldsSql += `, dateComplete = ?`;
                    extraParams.push(todayFormatted);
                }
                extraFieldsSql += `, dateDelivered = ?`;
                extraParams.push(todayFormatted);
            }

            const sql = `UPDATE caseRepair SET 
                caseStatus = ?${statusDateSql}${extraFieldsSql},
                updated_at = NOW()
                WHERE caseId = ?`;

            await database.query(sql, [caseStatus, ...extraParams, caseId]);
        }

        res.json({ message: 'success' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 4. Tracking Status for Customer (Public)
export async function getTrackingByPhone(req, res) {
    try {
        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        // Clean phone number (ลบขีดและเว้นวรรคออก)
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        if (cleanPhone.length < 3) {
             return res.json({ message: 'success', data: [] });
        }

        const sql = `
            SELECT 
                caseId as jobId,
                caseType as type,
                CONCAT(caseBrand, ' ', caseModel) as device,
                caseStatus as statusStr,
                created_at,
                IF(YEAR(updated_at) = 0 OR updated_at IS NULL, created_at, updated_at) as last_updated,
                statusDateWaiting,
                statusDateReceived,
                statusDateWaitPart,
                statusDateRepairing,
                statusDateComplete,
                statusDateDelivered,
                brokenSymptom
            FROM caseRepair 
            WHERE REPLACE(REPLACE(cusPhone, '-', ''), ' ', '') LIKE ? 
            ORDER BY last_updated DESC
        `;

        const [rows] = await database.query(sql, [`%${cleanPhone}%`]);

        // ปรับ Map Status ให้ตรงกับ 6 สเต็ปในหน้า UI ของลูกค้า
        // 0=รอรับเครื่อง, 1=รับเครื่องแล้ว, 2=รออะไหล่, 3=กำลังซ่อม/ส่งซ่อมอยู่, 4=ซ่อมเสร็จ, 5=ส่งมอบ, -1=ยกเลิก
        const statusMap = (status) => {
            if (!status) return 0;
            if (status === 'รอรับเครื่อง') return 0;
            if (status === 'รับเครื่องแล้ว') return 1;
            if (status.includes('รออะไหล่') || status.includes('รอสินค้า')) return 2;
            if (status.includes('กำลังซ่อม') || status.includes('ส่งซ่อม')) return 3;
            if (status.includes('ซ่อมเสร็จ')) return 4;
            if (status.includes('ส่งมอบ')) return 5;
            if (status === 'ยกเลิก') return -1;
            return 0; // Default
        };

        const results = rows.map(row => {
            // ดักจับและซ่อนคำว่า "ส่งซ่อม" ให้ลูกค้าเห็นเป็น "กำลังซ่อม"
            let displayStatus = row.statusStr;
            if (displayStatus && displayStatus.includes('ส่งซ่อม')) {
                displayStatus = 'กำลังซ่อม';
            }

            return {
                jobId: row.jobId,
                type: row.type,
                device: row.device || row.type, // Fallback ถ้าไม่มี Brand/Model
                currentStatus: statusMap(row.statusStr), // ส่ง Index 0-5 หรือ -1 ไปให้ UI จัดการ
                displayStatus: displayStatus, // ใช้ข้อความที่ถูกกรองแล้วส่งไปแสดงผล
                
                // แปลงเวลาให้เป็นโซนเวลาไทย
                lastUpdate: row.last_updated ? formatThaiDate(row.last_updated) : '-',

                // วันที่เปลี่ยนสถานะแต่ละขั้น (สำหรับ Stepper UI)
                statusDates: {
                    waiting: row.statusDateWaiting ? formatThaiDate(row.statusDateWaiting) : null,
                    received: row.statusDateReceived ? formatThaiDate(row.statusDateReceived) : formatThaiDate(row.created_at),
                    waitPart: row.statusDateWaitPart ? formatThaiDate(row.statusDateWaitPart) : null,
                    repairing: row.statusDateRepairing ? formatThaiDate(row.statusDateRepairing) : null,
                    complete: row.statusDateComplete ? formatThaiDate(row.statusDateComplete) : null,
                    delivered: row.statusDateDelivered ? formatThaiDate(row.statusDateDelivered) : null,
                },
                symptom: row.brokenSymptom
            };
        });

        res.json({ message: 'success', data: results });

    } catch (error) {
        console.error('Error tracking:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 5. ลบงานซ่อม (Delete)
export async function deleteCase(req, res) {
    try {
        const { caseId } = req.body;

        if (!caseId) {
            return res.status(400).json({ message: 'error', error: 'caseId is required' });
        }

        const [result] = await database.query('DELETE FROM caseRepair WHERE caseId = ?', [caseId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Case not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error deleting case:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}