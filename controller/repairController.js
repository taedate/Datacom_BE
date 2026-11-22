import database from "../service/database.js";
import { makeAuditSnapshot } from '../service/auditEntityService.js';
import { mergeRepairInput, repairFields, repairResponse, repairRevision } from '../service/repairRecord.js';

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
    res.set('Cache-Control', 'no-store');
    try {
        const { page = 1, itemsPerPage = 10, search, caseStatus, caseType, dateRange, sort_by, sort_order, lastDate, customerName, caseInstitution, caseSN, caseBrand, caseModel } = req.query;
        const parsedItemsPerPage = Number(itemsPerPage);
        const limit = parsedItemsPerPage === -1 || parsedItemsPerPage >= 10000 ? 1000000 : (parsedItemsPerPage || 10);
        const offset = (Number(page) - 1) * (parsedItemsPerPage === -1 || parsedItemsPerPage >= 10000 ? 0 : (parsedItemsPerPage || 10));

        // Optimized: Select columns needed for List View including joined sent repair info
        let sql = `SELECT 
            c.caseId, 
            c.cusFirstName, 
            c.cusLastName, 
            c.cusPhone, 
            c.caseInstitution,
            c.brokenSymptom, 
            c.caseType, 
            c.caseStatus,
            c.datePickUp, 
            c.refSentRepairId,
            c.staffName,
            c.caseBrand,
            c.caseModel,
            c.caseSN,
            c.caseDurableArticles,
            c.caseEquipment,
            c.repairDetails,
            c.repairCost,
            c.repairPrice,
            c.dateComplete,
            c.dateDelivered,
            c.created_at,
            s.caseSToMechanic AS refSentRepairMechanicName,
            s.dateOfReceived AS sentRepairDateOfReceived
        FROM caseRepair c
        LEFT JOIN caseSentRepair s ON c.refSentRepairId COLLATE utf8mb4_unicode_ci = s.caseSId COLLATE utf8mb4_unicode_ci
        WHERE 1=1`;

        let countSql = `SELECT COUNT(*) as total FROM caseRepair WHERE 1=1`;
        let params = [];

        // Logic การค้นหา (Search)
        if (search) {
            // เพิ่มการค้นหาด้วย refSentRepairId, caseSN, caseBrand, caseModel (เผื่ออยากค้นหาจากเลขใบส่งซ่อม, S/N, ยี่ห้อ, รุ่น)
            const searchCondition = ` AND (caseId LIKE ? OR cusFirstName LIKE ? OR cusLastName LIKE ? OR cusPhone LIKE ? OR caseInstitution LIKE ? OR refSentRepairId LIKE ? OR caseSN LIKE ? OR caseBrand LIKE ? OR caseModel LIKE ?)`;
            sql += searchCondition;
            countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
        }

        // Logic ค้นหาแยกฟิลด์ (Individual Field Search)
        if (customerName) {
            const cond = ` AND (cusFirstName LIKE ? OR cusLastName LIKE ?)`;
            sql += cond;
            countSql += cond;
            const searchParam = `%${customerName}%`;
            params.push(searchParam, searchParam);
        }
        if (caseInstitution) {
            const cond = ` AND caseInstitution LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${caseInstitution}%`);
        }
        if (caseSN) {
            const cond = ` AND caseSN LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${caseSN}%`);
        }
        if (caseBrand) {
            const cond = ` AND caseBrand LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${caseBrand}%`);
        }
        if (caseModel) {
            const cond = ` AND caseModel LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${caseModel}%`);
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

        // Logic กรองวันที่ (รองรับทั้งช่วงข้ามเดือน/ข้ามปี)
        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) {
                 const cleanStart = start.trim().replace(/\//g, '-');
                 const cleanEnd = end.trim().replace(/\//g, '-');
                 sql += ` AND STR_TO_DATE(REPLACE(datePickUp, '/', '-'), '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%d-%m-%Y') AND STR_TO_DATE(?, '%d-%m-%Y')`;
                 countSql += ` AND STR_TO_DATE(REPLACE(datePickUp, '/', '-'), '%d-%m-%Y') BETWEEN STR_TO_DATE(?, '%d-%m-%Y') AND STR_TO_DATE(?, '%d-%m-%Y')`;
                 params.push(cleanStart, cleanEnd);
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
            sql += ` ORDER BY c.${safeSort} ${sort_order === 'asc' ? 'ASC' : 'DESC'}${safeSort === 'caseId' ? '' : ', c.caseId DESC'}`;
        } else {
            sql += ` ORDER BY c.created_at DESC, c.caseId DESC`;
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
        res.set('Cache-Control', 'no-store');
        const data = repairResponse(rows[0]);
        res.json({ message: 'success', data, revision: data.revision });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 2. สร้างงานซ่อมใหม่ (Create)
export async function createCase(req, res) {
    let values;
    try { values = mergeRepairInput({ ...req.body, caseStatus: req.body.caseStatus || 'รับเครื่องแล้ว' }); }
    catch (error) { return res.status(400).json({ message: 'error', detail: error.message }); }
    const prefixes = { 'ซ่อมคอมพิวเตอร์': 'PC', 'ซ่อมโน็ตบุ๊ค': 'NB', 'ซ่อมปริ้นเตอร์': 'PR', 'ซ่อมมือถือ/แท็บเล็ต': 'MB', 'ลงโปรแกรม/OS': 'SW', UPS: 'UP', 'เปลี่ยนอะไหล่': 'SP', 'กู้ข้อมูล': 'DR', 'อื่นๆ': 'OT' };
    const prefix = prefixes[values.caseType] || 'CT';
    let connection, locked = false;
    try {
        connection = await database.pool.getConnection();
        const [[lock]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':repair-create:', ?), 256), 5) AS acquired", [prefix]);
        locked = Number(lock.acquired) === 1;
        if (!locked) return res.status(503).json({ message: 'error', detail: 'มีรายการกำลังบันทึก กรุณาลองใหม่อีกครั้ง' });
        await connection.beginTransaction();
        const [lastRows] = await connection.query(`SELECT caseId FROM caseRepair WHERE caseId REGEXP ?
            ORDER BY CAST(SUBSTRING_INDEX(caseId, '-', -1) AS UNSIGNED) DESC LIMIT 1`, [`^${prefix}-[0-9]+$`]);
        const next = lastRows.length ? Number(lastRows[0].caseId.split('-')[1]) + 1 : 1;
        const caseId = `${prefix}-${String(next).padStart(3, '0')}`;
        const dates = getStatusDateColumn(values.caseStatus);
        await connection.query(`INSERT INTO caseRepair (caseId, ${repairFields.join(', ')}, created_at, updated_at${dates.sqlColumn})
            VALUES (${Array(repairFields.length + 1).fill('?').join(', ')}, NOW(), NOW()${dates.sqlValue})`, [caseId, ...repairFields.map(field => values[field])]);
        const [[saved]] = await connection.query('SELECT * FROM caseRepair WHERE caseId = ?', [caseId]);
        await connection.commit();
        res.locals.auditSnapshots = { after: makeAuditSnapshot('caseRepair', saved) };
        const data = repairResponse(saved);
        res.json({ message: 'success', caseId, revision: data.revision, data });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('Create repair case failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'บันทึกงานซ่อมไม่สำเร็จ กรุณาลองใหม่' });
    } finally {
        if (locked) await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':repair-create:', ?), 256))", [prefix]).catch(() => {});
        connection?.release();
    }
}
// 3. อัปเดตงานซ่อม (Update)
export async function updateCase(req, res) {
    const { caseId, expected_revision } = req.body;
    if (typeof caseId !== 'string' || !caseId.trim()) return res.status(400).json({ message: 'error', detail: 'ไม่พบเลขงานซ่อม กรุณาโหลดรายการใหม่' });
    let connection;
    try {
        connection = await database.pool.getConnection(); await connection.beginTransaction();
        const [rows] = await connection.query('SELECT * FROM caseRepair WHERE caseId = ? FOR UPDATE', [caseId]);
        if (!rows.length || (expected_revision && expected_revision !== repairRevision(rows[0]))) {
            await connection.rollback();
            return res.status(rows.length ? 409 : 404).json({ message: 'error', detail: rows.length ? 'มีผู้อื่นแก้ไขงานนี้แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก ข้อมูลที่กรอกยังไม่ได้ถูกเขียนทับ' : 'ไม่พบงานซ่อมนี้ในระบบ ข้อมูลยังไม่ได้บันทึก' });
        }
        let values;
        try { values = mergeRepairInput(req.body, rows[0]); }
        catch (error) { await connection.rollback(); return res.status(400).json({ message: 'error', detail: error.message }); }
        const dates = rows[0].caseStatus !== values.caseStatus ? getStatusDateColumn(values.caseStatus).sqlUpdate : '';
        await connection.query(`UPDATE caseRepair SET ${repairFields.map(field => `${field}=?`).join(', ')}, updated_at=NOW()${dates} WHERE caseId=?`, [...repairFields.map(field => values[field]), caseId]);
        const [[saved]] = await connection.query('SELECT * FROM caseRepair WHERE caseId = ?', [caseId]);
        await connection.commit();
        res.locals.auditSnapshots = { before: makeAuditSnapshot('caseRepair', rows[0]), after: makeAuditSnapshot('caseRepair', saved) };
        const data = repairResponse(saved);
        res.json({ message: 'success', caseId, revision: data.revision, data });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error('Update repair case failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'บันทึกงานซ่อมไม่สำเร็จ กรุณาลองใหม่' });
    } finally { connection?.release(); }
}

// Reading persisted data for printing does not alter or delete the repair record.
export async function prepareCasePrint(req, res) {
    const { caseId, expected_revision } = req.body;
    if (typeof caseId !== 'string' || !caseId.trim()) return res.status(400).json({ message: 'error', detail: 'กรุณาบันทึกงานซ่อมก่อนพิมพ์' });
    try {
        const [rows] = await database.query('SELECT * FROM caseRepair WHERE caseId = ?', [caseId]);
        if (!rows.length) return res.status(404).json({ message: 'error', detail: 'ไม่พบข้อมูลที่บันทึกในระบบ จึงยังไม่ออกใบรับซ่อม' });
        const data = repairResponse(rows[0]);
        if (expected_revision && expected_revision !== data.revision) return res.status(409).json({ message: 'error', detail: 'ข้อมูลถูกแก้ไขจากที่อื่น กรุณาโหลดข้อมูลล่าสุดก่อนพิมพ์' });
        res.locals.auditSnapshots = { before: makeAuditSnapshot('caseRepair', rows[0]), after: makeAuditSnapshot('caseRepair', rows[0]) };
        res.set('Cache-Control', 'no-store');
        res.json({ message: 'success', caseId, revision: data.revision, data });
    } catch (error) {
        console.error('Prepare repair print failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'ยังยืนยันข้อมูลก่อนพิมพ์ไม่ได้ กรุณาลองอีกครั้ง ข้อมูลบนหน้าจอยังคงอยู่' });
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
