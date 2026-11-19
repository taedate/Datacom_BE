import database from "../service/database.js";
import { getQuotationStatusConflict } from "../service/quotationStatus.js";
import { readAuditSnapshot } from "../service/auditEntityService.js";

// Helper: ตรวจสอบค่าว่าเป็น Null หรือ Empty String หรือไม่
const cleanVal = (val) => (val === "" || val === undefined || val === "null" ? null : val);

function resolveItemGroupName(data, previousName = null) {
    if (data.item_group_name === undefined) return previousName ?? null;
    if (data.item_group_name === null) return null;
    if (typeof data.item_group_name !== 'string' || data.item_group_name.trim().length > 255) {
        const error = new Error('ชื่อกลุ่มรายการรวมต้องเป็นข้อความไม่เกิน 255 ตัวอักษร');
        error.statusCode = 400;
        throw error;
    }
    return data.item_group_name.trim() || null;
}

// --------------------------------------------------------------------------
// 0a. GENERATE NEXT QUOTATION DOC ID
// --------------------------------------------------------------------------
export async function getNextQuotationDocId(req, res) {
    try {
        const customerName = (req.query.customerName || '').trim();
        if (!customerName) {
            return res.status(400).json({ message: 'error', error: 'customerName is required' });
        }

        // ใช้เวลาไทย (UTC+7) เป็นหลัก
        const now = new Date();
        const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));

        const ceYear = bangkokTime.getFullYear();           // ปี ค.ศ. เช่น 2026
        const thaiYear = (ceYear + 543) % 100;              // ปี พ.ศ. 2 หลัก เช่น 69
        const month = bangkokTime.getMonth() + 1;           // เดือน 1-12

        const thaiYearStr = String(thaiYear).padStart(2, '0');
        const monthStr = String(month).padStart(2, '0');

        const prefix = `DATA${thaiYearStr}-${monthStr}`;
        const suffix = `/${ceYear}`;

        const sql = `SELECT MAX(CAST(SUBSTRING(quotation_id, LENGTH(?) + 1) AS UNSIGNED)) as max_seq 
                     FROM documents 
                     WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
                     AND quotation_id LIKE CONCAT(?, '%', ?)
                     AND is_borrow = 0`;

        const [rows] = await database.query(sql, [prefix, customerName, prefix, suffix]);
        const maxSeq = rows[0].max_seq || 0;
        const nextSeq = maxSeq + 1;
        const seq = String(nextSeq).padStart(2, '0');

        const docId = `${prefix}${seq}${suffix}`;

        return res.json({ message: 'success', docId });
    } catch (error) {
        console.error('getNextQuotationDocId Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 0b. GENERATE NEXT DELIVERY NOTE ID (IV{ปีไทย}{เดือน}{ลำดับ 3 หลัก})
// --------------------------------------------------------------------------
export async function getNextDeliveryDocId(req, res) {
    try {
        // ใช้เวลาไทย (UTC+7)
        const now = new Date();
        const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));

        const ceYear = bangkokTime.getFullYear();
        const thaiYear = (ceYear + 543) % 100;
        const month = bangkokTime.getMonth() + 1;

        const thaiYearStr = String(thaiYear).padStart(2, '0');
        const monthStr = String(month).padStart(2, '0');

        // prefix ที่ต้อง match เช่น "IV6904"
        const prefix = `IV${thaiYearStr}${monthStr}`;

        // ค้นหาเลขรันลำดับสูงสุดที่ขึ้นต้นด้วย prefix นี้
        const sql = `SELECT MAX(CAST(SUBSTRING(delivery_note_no, LENGTH(?) + 1) AS UNSIGNED)) as max_seq 
                     FROM documents
                     WHERE delivery_note_no IS NOT NULL
                     AND delivery_note_no LIKE CONCAT(?, '%')`;

        const [rows] = await database.query(sql, [prefix, prefix]);

        const maxSeq = rows[0].max_seq || 0;
        const nextSeq = maxSeq + 1;
        const seq = String(nextSeq).padStart(3, '0');

        const docId = `${prefix}${seq}`;

        return res.json({ message: 'success', docId });
    } catch (error) {
        console.error('getNextDeliveryDocId Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 0b2. SUGGEST DELIVERY NOTES (Autocomplete/List for Requisitions & Tracking)
// --------------------------------------------------------------------------
export async function suggestDeliveryNotes(req, res) {
    try {
        const rawQ = req.query.q;
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
            : 30;

        let whereClause = "";
        const params = [];

        if (typeof rawQ === 'string' && rawQ.trim() !== '') {
            const q = rawQ.trim();
            whereClause = " AND (LOWER(d.delivery_note_no) LIKE CONCAT('%', LOWER(?), '%') OR LOWER(d.customer_name) LIKE CONCAT('%', LOWER(?), '%'))";
            params.push(q, q);
        }

        const sql = `
            SELECT
                x.delivery_note_no,
                x.customer_name,
                x.delivery_date_str,
                x.issue_date_str,
                x.document_id,
                x.lastUsedAt
            FROM (
                SELECT
                    TRIM(d.delivery_note_no) AS delivery_note_no,
                    TRIM(d.customer_name) AS customer_name,
                    d.delivery_date_str,
                    d.issue_date_str,
                    d.id AS document_id,
                    COALESCE(d.delivery_date, d.issue_date, d.created_at) AS lastUsedAt,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(TRIM(d.delivery_note_no))
                        ORDER BY COALESCE(d.delivery_date, d.issue_date, d.created_at) DESC, d.id DESC
                    ) AS rn
                FROM documents d
                WHERE d.delivery_note_no IS NOT NULL
                  AND TRIM(d.delivery_note_no) <> ''
                  ${whereClause}
            ) x
            WHERE x.rn = 1
            ORDER BY x.lastUsedAt DESC, x.delivery_note_no DESC
            LIMIT ?
        `;
        params.push(limit);

        const [rows] = await database.query(sql, params);
        return res.status(200).json({ message: 'success', data: rows || [] });
    } catch (error) {
        console.error('suggestDeliveryNotes Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 0c. PRICE HISTORY (ค้นหาประวัติราคาสินค้าแต่ละหน่วยงาน)
// --------------------------------------------------------------------------
export async function getPriceHistory(req, res) {
    try {
        const { page = 1, itemsPerPage = 15, customerName, productName, sort_by, sort_order } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 15;

        let sql = `
            SELECT 
                d.id as document_id,
                d.quotation_id,
                d.customer_name,
                d.issue_date,
                d.issue_date_str,
                d.created_at,
                d.updated_at,
                d.current_status,
                ds.section_name,
                di.description as product_name,
                di.quantity,
                di.unit,
                di.unit_price
            FROM document_items di
            JOIN document_sections ds ON ds.id = di.section_id
            JOIN documents d ON d.id = ds.document_id
            WHERE d.is_borrow = 0
        `;

        let countSql = `
            SELECT COUNT(*) as total 
            FROM document_items di
            JOIN document_sections ds ON ds.id = di.section_id
            JOIN documents d ON d.id = ds.document_id
            WHERE d.is_borrow = 0
        `;

        let params = [];

        if (customerName) {
            const cond = ` AND d.customer_name LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${customerName}%`);
        }

        if (productName) {
            const cond = ` AND di.description LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${productName}%`);
        }

        // Count
        const countParams = [...params];
        const [countRows] = await database.query(countSql, countParams);
        const totalItems = countRows[0].total;

        // Sorting
        const allowedSort = {
            'customer_name': 'd.customer_name',
            'product_name': 'di.description',
            'unit_price': 'di.unit_price',
            'issue_date_str': 'COALESCE(d.issue_date, d.created_at, d.updated_at)',
        };
        const sortCol = allowedSort[sort_by] || 'COALESCE(d.issue_date, d.created_at, d.updated_at)';
        const order = sort_order === 'asc' ? 'ASC' : 'DESC';
        sql += ` ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [rows] = await database.query(sql, params);

        return res.json({ message: 'success', data: rows, totalItems });
    } catch (error) {
        console.error('getPriceHistory Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 0d. CUSTOMER SUGGEST (Autocomplete)
// --------------------------------------------------------------------------
export async function suggestQuotationCustomers(req, res) {
    try {
        const rawQ = req.query.q;
        if (typeof rawQ !== 'string') {
            return res.status(400).json({ message: 'error', error: 'q is required' });
        }

        const q = rawQ.trim();
        if (!q) {
            return res.status(400).json({ message: 'error', error: 'q is required' });
        }

        const requestedLimit = Number(req.query.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(20, Math.floor(requestedLimit)))
            : 10;

        const sql = `
            SELECT
                x.customerName,
                x.customerTaxId,
                x.customerPhone,
                x.customerAddress,
                x.lastUsedAt
            FROM (
                SELECT
                    TRIM(d.customer_name) AS customerName,
                    d.customer_tax_id AS customerTaxId,
                    d.customer_phone AS customerPhone,
                    d.customer_address AS customerAddress,
                    COALESCE(d.updated_at, d.issue_date, d.created_at) AS lastUsedAt,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(TRIM(d.customer_name))
                        ORDER BY COALESCE(d.updated_at, d.issue_date, d.created_at) DESC, d.id DESC
                    ) AS rn,
                    CASE
                        WHEN LOWER(TRIM(d.customer_name)) LIKE CONCAT(LOWER(?), '%') THEN 2
                        ELSE 1
                    END AS matchPriority
                FROM documents d
                WHERE d.customer_name IS NOT NULL
                  AND TRIM(d.customer_name) <> ''
                  AND LOWER(d.customer_name) LIKE CONCAT('%', LOWER(?), '%')
            ) x
            WHERE x.rn = 1
            ORDER BY x.matchPriority DESC, x.lastUsedAt DESC
            LIMIT ?
        `;

        const [rows] = await database.query(sql, [q, q, limit]);
        return res.status(200).json({ data: rows || [] });
    } catch (error) {
        console.error('suggestQuotationCustomers Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 1. GET ALL QUOTATIONS (Optimized for List View)
// --------------------------------------------------------------------------
export async function getAllQuotations(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, quotationId, deliveryNoteNo, receiptNo, customerName, productName, status, startDate, endDate, sort_by, sort_order, isBorrow } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;

        // Optimized Query: Select only necessary columns and calculate total in DB
        // This avoids N+1 query problem and fetching heavy nested data for the list view
        let sql = `
            SELECT 
                d.id, 
                d.quotation_id, 
                d.item_group_name,
                d.delivery_note_no, 
                d.receipt_no, 
                d.customer_name, 
                d.contact_person,
                d.current_status, 
                d.issue_date, 
                d.issue_date_str,
                d.created_at,
                d.updated_at,
                d.is_borrow,
                d.borrow_status,
                d.from_borrow_id,
                d.from_borrow_no,
                (SELECT GROUP_CONCAT(ds.section_name SEPARATOR ', ') 
                 FROM document_sections ds 
                 WHERE ds.document_id = d.id) as section_names,
                COALESCE((
                    SELECT SUM(di.quantity * di.unit_price)
                    FROM document_sections ds
                    JOIN document_items di ON di.section_id = ds.id
                    WHERE ds.document_id = d.id
                ), 0) as total
            FROM documents d 
            WHERE 1=1
        `;

        let countSql = `SELECT COUNT(*) as total FROM documents d WHERE 1=1`;
        let params = [];

        if (isBorrow !== undefined) {
            const cond = ` AND d.is_borrow = ?`;
            sql += cond;
            countSql += cond;
            params.push(Number(isBorrow) ? 1 : 0);
        } else {
            const cond = ` AND d.is_borrow = 0`;
            sql += cond;
            countSql += cond;
        }

        // ค้นหาแบบแยกแต่ละฟิลด์
        if (quotationId) {
            const cond = ` AND d.quotation_id LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${quotationId}%`);
        }

        if (deliveryNoteNo) {
            const cond = ` AND d.delivery_note_no LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${deliveryNoteNo}%`);
        }

        if (receiptNo) {
            const cond = ` AND d.receipt_no LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${receiptNo}%`);
        }

        if (customerName) {
            const cond = ` AND d.customer_name LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${customerName}%`);
        }

        const contactPerson = req.query.contactPerson;
        if (contactPerson) {
            const cond = ` AND d.contact_person LIKE ?`;
            sql += cond;
            countSql += cond;
            params.push(`%${contactPerson}%`);
        }

        if (productName) {
            const cond = ` AND EXISTS (
                SELECT 1 FROM document_sections ds
                JOIN document_items di ON di.section_id = ds.id
                WHERE ds.document_id = d.id AND di.description LIKE ?
            )`;
            sql += cond;
            countSql += cond;
            params.push(`%${productName}%`);
        }

        // Fallback: ค้นจาก search รวม (ถ้าไม่ได้ใช้ filter แยก)
        if (search) {
            const term = `%${search}%`;
            const searchCond = ` AND (d.id LIKE ? OR d.customer_name LIKE ? OR d.quotation_id LIKE ? OR d.delivery_note_no LIKE ? OR d.receipt_no LIKE ? OR d.item_group_name LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term, term, term, term, term);
        }

        if (status) {
            const statusCol = (isBorrow !== undefined && Number(isBorrow) === 1) ? 'd.borrow_status' : 'd.current_status';
            sql += ` AND ${statusCol} = ?`;
            countSql += ` AND ${statusCol} = ?`;
            params.push(status);
        }
        
        if (startDate) {
             sql += ` AND COALESCE(d.issue_date, DATE(d.created_at)) >= ?`;
             countSql += ` AND COALESCE(d.issue_date, DATE(d.created_at)) >= ?`;
             params.push(startDate);
        }
        if (endDate) {
             sql += ` AND COALESCE(d.issue_date, DATE(d.created_at)) <= ?`;
             countSql += ` AND COALESCE(d.issue_date, DATE(d.created_at)) <= ?`;
             params.push(endDate);
        }

        // Sorting
        if (sort_by) {
            const sortMap = {
                'id': 'd.id',
                'quotationId': 'd.quotation_id',
                'deliveryNoteNo': 'd.delivery_note_no',
                'receiptNo': 'd.receipt_no',
                'customerName': 'd.customer_name',
                'status': 'd.current_status',
                'issueDate': 'd.issue_date',
                'updatedDate': 'd.updated_at',
                'total': 'total' // Calculated column, no table alias
            };

            const sortCol = sortMap[sort_by] || 'd.created_at';
            sql += ` ORDER BY ${sortCol} ${sort_order === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            sql += ` ORDER BY d.created_at DESC`;
        }

        const queryParams = [...params, limit, offset];
        const [docs] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);

        // Process docs to ensure quotation key compatibility
        for (const doc of docs) {
             // Ensure both casing are available for Frontend
            doc.quotation_Id = doc.quotation_Id || doc.quotation_id || null;
            doc.quotation_id = doc.quotation_Id; 
        }

        res.json({
            message: "success",
            data: docs,
            totalItems: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / limit)
        });
    } catch (error) {
        console.error("Error getting all quotations:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 2. GET SINGLE QUOTATION (BY ID)
// --------------------------------------------------------------------------
export async function getQuotationById(req, res) {
    try {
        const { id } = req.params; // รับ System ID (QT-00x)
        
        const pDocs = database.query(`SELECT * FROM documents WHERE id = ?`, [id]);
        const pSections = database.query(`SELECT * FROM document_sections WHERE document_id = ? ORDER BY sort_order ASC`, [id]);
        const pItems = database.query(`
            SELECT di.* 
            FROM document_items di 
            JOIN document_sections ds ON di.section_id = ds.id 
            WHERE ds.document_id = ? 
            ORDER BY di.sort_order ASC`, 
            [id]
        );

        const [[docs], [sections], [items]] = await Promise.all([pDocs, pSections, pItems]);

        if (docs.length === 0) {
            return res.status(404).json({ message: "Document not found" });
        }
        
        const document = Object.assign({}, docs[0]); 

        const productSections = sections.map(section => {
            return {
                ...section,
                items: items.filter(item => item.section_id === section.id)
            };
        });

        const result = {
            ...document,
            productSections
        };

        res.json(result);
    } catch (error) {
        console.error("Error getting quotation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 3. CREATE NEW QUOTATION (Auto Generate System ID: QT-00x or BR-00x)
// --------------------------------------------------------------------------
export async function createQuotation(req, res) {
    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        const data = req.body;
        const itemGroupName = resolveItemGroupName(data);
        
        // --- 1. GENERATE SYSTEM ID (QT-XXX or BR-XXX) ---
        // Logic: หา QT-XXX หรือ BR-XXX ตัวล่าสุด แล้วบวก 1
        const isBorrow = data.is_borrow !== undefined ? (Number(data.is_borrow) ? 1 : 0) : 0;
        const prefix = isBorrow ? "BR-" : "QT-";

        const [lastRows] = await conn.query(
            `SELECT id FROM documents WHERE id LIKE ? AND id NOT LIKE ? ORDER BY LENGTH(id) DESC, id DESC LIMIT 1`,
            [`${prefix}%`, `${prefix}____-%`]
        );
        
        let nextId = `${prefix}001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].id; // e.g., QT-005 or BR-005
            const parts = lastId.split('-'); // ['QT', '005'] or ['BR', '005']
            if (parts.length === 2 && !isNaN(parts[1])) {
                const nextNum = parseInt(parts[1], 10) + 1; 
                nextId = `${prefix}${String(nextNum).padStart(3, '0')}`;
            }
        }

        const systemId = nextId; // นี่คือ Primary Key (id)
        
        // ถ้า User ไม่ได้กรอกเลขที่ใบเสนอราคา (quotation_id) ให้ใช้ System ID ไปก่อน
        const userDocId = data.quotation_id || systemId;

        // 2. Insert Document Header
        const docSql = `INSERT INTO documents (
            id, quotation_id, current_status, customer_name, contact_person, customer_tax_id, customer_phone, customer_address,
            salesman, remark, 
            issue_date_str, issue_date, price_validity_days, valid_until_str, valid_until, offerer_name,
            delivery_note_no, delivery_date_str, delivery_date, payment_term, due_date_str, due_date, delivery_address,
            receiver_name, received_date_str, received_date, sender_name, sent_date_str, sent_date, delivery_authorized_signer,
            receipt_no, receipt_issue_date_str, receipt_issue_date, payment_method, 
            cheque_bank, cheque_branch, cheque_no, cheque_amount, cheque_date_str, cheque_date,
            goods_received_check_date_str, goods_received_check_date, money_receiver_name, money_receive_date_str, money_receive_date, receipt_authorized_signer,
            delivery_copy_date, delivery_copy_date_str, receipt_copy_date, receipt_copy_date_str,
            is_borrow, borrow_status, item_group_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const docParams = [
            systemId,   // id (Primary Key generated by Backend)
            userDocId,  // quotation_id (User input or Fallback)
            data.current_status || 'QUOTATION', 
            data.customer_name, data.contact_person, data.customer_tax_id, data.customer_phone, data.customer_address,
            data.salesman, data.remark,
            
            data.issue_date_str, cleanVal(data.issue_date), data.price_validity_days, data.valid_until_str, cleanVal(data.valid_until), data.offerer_name,
            
            data.delivery_note_no, data.delivery_date_str, cleanVal(data.delivery_date), data.payment_term, data.due_date_str, cleanVal(data.due_date), data.delivery_address,
            data.receiver_name, data.received_date_str, cleanVal(data.received_date), data.sender_name, data.sent_date_str, cleanVal(data.sent_date), data.delivery_authorized_signer,
            
            data.receipt_no, data.receipt_issue_date_str, cleanVal(data.receipt_issue_date), data.payment_method,
            data.cheque_bank, data.cheque_branch, data.cheque_no, data.cheque_amount, data.cheque_date_str, cleanVal(data.cheque_date),
            data.goods_received_check_date_str, cleanVal(data.goods_received_check_date), data.money_receiver_name, data.money_receive_date_str, cleanVal(data.money_receive_date), data.receipt_authorized_signer,
            cleanVal(data.delivery_copy_date), data.delivery_copy_date_str, cleanVal(data.receipt_copy_date), data.receipt_copy_date_str,
            isBorrow,
            data.borrow_status || null,
            itemGroupName
        ];

        await conn.query(docSql, docParams);

        // 3. Insert Sections & Items (Optimized Batch Insert)
        if (data.productSections && Array.isArray(data.productSections) && data.productSections.length > 0) {
            const sectionsValues = data.productSections.map((section, index) => [
                systemId,
                section.section_name,
                index + 1
            ]);

            const [secResult] = await conn.query(
                `INSERT INTO document_sections (document_id, section_name, sort_order) VALUES ?`,
                [sectionsValues]
            );

            let firstInsertId = secResult.insertId;
            const itemsValues = [];
            data.productSections.forEach((section, secIndex) => {
                const sectionId = firstInsertId + secIndex;
                if (section.items && Array.isArray(section.items)) {
                    section.items.forEach((item, itemIndex) => {
                        const isSubItem = item.is_sub_item ? 1 : 0;
                        const isDescOnly = item.is_desc_only ? 1 : 0;
                        itemsValues.push([
                            sectionId,
                            item.description,
                            cleanVal(item.quantity),
                            item.unit,
                            cleanVal(item.unit_price),
                            itemIndex + 1,
                            isSubItem,
                            item.order_source || null,
                            isDescOnly
                        ]);
                    });
                }
            });

            if (itemsValues.length > 0) {
                await conn.query(
                    `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source, is_desc_only) VALUES ?`,
                    [itemsValues]
                );
            }
        }

        res.locals.auditSnapshots = { before: null, after: await readAuditSnapshot('quotation', systemId, conn) };
        await conn.commit();
        // ส่ง ID กลับไปให้ Frontend ใช้ Redirect
        res.status(201).json({ message: "Quotation created successfully", id: systemId });

    } catch (error) {
        try {
            await conn.rollback();
        } catch (rbError) {
            // Ignore rollback error if connection is already closed
        }
        console.error("Error creating quotation:", error);
        res.status(error.statusCode || 500).json({ message: error.statusCode === 400 ? error.message : "Failed to create quotation", error: error.message });
    } finally {
        if (conn) conn.release();
    }
}

// --------------------------------------------------------------------------
// 4. UPDATE EXISTING QUOTATION
// --------------------------------------------------------------------------
export async function updateQuotation(req, res) {
    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        const { id } = req.params; // System ID (QT-00x) จาก URL
        const data = req.body;     // Data จาก Form

        // 1. Check if exists
        const [existing] = await conn.query("SELECT id, is_borrow, borrow_status, current_status, delivery_note_no, item_group_name FROM documents WHERE id = ? FOR UPDATE", [id]);
        if (existing.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }
        const existingDoc = existing[0];
        const itemGroupName = resolveItemGroupName(data, existingDoc.item_group_name);
        res.locals.quotationBefore = existingDoc;
        res.locals.auditSnapshots = { before: await readAuditSnapshot('quotation', id, conn) };
        const statusConflict = getQuotationStatusConflict(existingDoc, data);
        if (statusConflict) {
            await conn.rollback();
            return res.status(409).json(statusConflict);
        }

        // Safely determine is_borrow and borrow_status
        const isBorrowValue = data.is_borrow !== undefined ? (Number(data.is_borrow) ? 1 : 0) : existingDoc.is_borrow;
        const borrowStatusValue = data.borrow_status !== undefined ? data.borrow_status : existingDoc.borrow_status;

        // 2. Update Document Fields
        // * quotation_id = ? คืออัปเดตเลขที่ใบเสนอราคาตามที่ User แก้ไข
        const updateSql = `UPDATE documents SET 
            quotation_id = ?,
            current_status = ?, customer_name = ?, contact_person = ?, customer_tax_id = ?, customer_phone = ?, customer_address = ?,
            salesman = ?, remark = ?, 
            issue_date_str = ?, issue_date = ?, price_validity_days = ?, valid_until_str = ?, valid_until = ?, offerer_name = ?,
            delivery_note_no = ?, delivery_date_str = ?, delivery_date = ?, payment_term = ?, due_date_str = ?, due_date = ?, delivery_address = ?,
            receiver_name = ?, received_date_str = ?, received_date = ?, sender_name = ?, sent_date_str = ?, sent_date = ?, delivery_authorized_signer = ?,
            receipt_no = ?, receipt_issue_date_str = ?, receipt_issue_date = ?, payment_method = ?, 
            cheque_bank = ?, cheque_branch = ?, cheque_no = ?, cheque_amount = ?, cheque_date_str = ?, cheque_date = ?,
            goods_received_check_date_str = ?, goods_received_check_date = ?, money_receiver_name = ?, money_receive_date_str = ?, money_receive_date = ?, receipt_authorized_signer = ?,
            delivery_copy_date = ?, delivery_copy_date_str = ?, receipt_copy_date = ?, receipt_copy_date_str = ?,
            is_borrow = ?, borrow_status = ?, item_group_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`; // Update record ที่มี System ID ตรงกัน

        const updateParams = [
            data.quotation_id, // Parameter 1: เลขที่ใบเสนอราคาที่ User กรอก
            data.current_status ?? existingDoc.current_status,
            data.customer_name, data.contact_person, data.customer_tax_id, data.customer_phone, data.customer_address,
            data.salesman, data.remark,
            
            data.issue_date_str, cleanVal(data.issue_date), data.price_validity_days, data.valid_until_str, cleanVal(data.valid_until), data.offerer_name,
            
            data.delivery_note_no, data.delivery_date_str, cleanVal(data.delivery_date), data.payment_term, data.due_date_str, cleanVal(data.due_date), data.delivery_address,
            data.receiver_name, data.received_date_str, cleanVal(data.received_date), data.sender_name, data.sent_date_str, cleanVal(data.sent_date), data.delivery_authorized_signer,
            
            data.receipt_no, data.receipt_issue_date_str, cleanVal(data.receipt_issue_date), data.payment_method,
            data.cheque_bank, data.cheque_branch, data.cheque_no, data.cheque_amount, data.cheque_date_str, cleanVal(data.cheque_date),
            data.goods_received_check_date_str, cleanVal(data.goods_received_check_date), data.money_receiver_name, data.money_receive_date_str, cleanVal(data.money_receive_date), data.receipt_authorized_signer,
            cleanVal(data.delivery_copy_date), data.delivery_copy_date_str, cleanVal(data.receipt_copy_date), data.receipt_copy_date_str,
            isBorrowValue,
            borrowStatusValue,
            itemGroupName,
            
            id // Parameter สุดท้าย: System ID (Primary Key)
        ];

        await conn.query(updateSql, updateParams);

        // 3. Clear & Re-insert Sections (Optimized Batch Insert)
        await conn.query(`DELETE FROM document_sections WHERE document_id = ?`, [id]);

        if (data.productSections && Array.isArray(data.productSections) && data.productSections.length > 0) {
            const sectionsValues = data.productSections.map((section, index) => [
                id,
                section.section_name,
                index + 1
            ]);

            const [secResult] = await conn.query(
                `INSERT INTO document_sections (document_id, section_name, sort_order) VALUES ?`,
                [sectionsValues]
            );

            let firstInsertId = secResult.insertId;
            const itemsValues = [];
            data.productSections.forEach((section, secIndex) => {
                const sectionId = firstInsertId + secIndex;
                if (section.items && Array.isArray(section.items)) {
                    section.items.forEach((item, itemIndex) => {
                        const isSubItem = item.is_sub_item ? 1 : 0;
                        const isDescOnly = item.is_desc_only ? 1 : 0;
                        itemsValues.push([
                            sectionId,
                            item.description,
                            cleanVal(item.quantity),
                            item.unit,
                            cleanVal(item.unit_price),
                            itemIndex + 1,
                            isSubItem,
                            item.order_source || null,
                            isDescOnly
                        ]);
                    });
                }
            });

            if (itemsValues.length > 0) {
                await conn.query(
                    `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source, is_desc_only) VALUES ?`,
                    [itemsValues]
                );
            }
        }

        res.locals.auditSnapshots.after = await readAuditSnapshot('quotation', id, conn);
        await conn.commit();
        res.json({ message: "Quotation updated successfully", id });

    } catch (error) {
        try {
            await conn.rollback();
        } catch (rbError) {
            // Ignore rollback error if connection is already closed
        }
        console.error("Error updating quotation:", error);
        res.status(error.statusCode || 500).json({ message: error.statusCode === 400 ? error.message : "Failed to update quotation", error: error.message });
    } finally {
        if (conn) conn.release();
    }
}

// --------------------------------------------------------------------------
// 5. DELETE QUOTATION
// --------------------------------------------------------------------------
export async function deleteQuotation(req, res) {
    try {
        const { id } = req.params;
        const [result] = await database.query(`DELETE FROM documents WHERE id = ?`, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Document not found" });
        }
        
        res.json({ message: "Quotation deleted successfully" });
    } catch (error) {
        console.error("Error deleting quotation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 6. GENERATE NEXT BORROW DOC ID
// --------------------------------------------------------------------------
export async function getNextBorrowDocId(req, res) {
    try {
        const customerName = (req.query.customerName || '').trim();
        if (!customerName) {
            return res.status(400).json({ message: 'error', error: 'customerName is required' });
        }

        const now = new Date();
        const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));

        const ceYear = bangkokTime.getFullYear();           // ปี ค.ศ. เช่น 2026
        const thaiYear = (ceYear + 543) % 100;              // ปี พ.ศ. 2 หลัก เช่น 69
        const month = bangkokTime.getMonth() + 1;           // เดือน 1-12

        const thaiYearStr = String(thaiYear).padStart(2, '0');
        const monthStr = String(month).padStart(2, '0');

        const prefix = `BR${thaiYearStr}-${monthStr}`;
        const suffix = `/${ceYear}`;

        const sql = `SELECT MAX(CAST(SUBSTRING(quotation_id, LENGTH(?) + 1) AS UNSIGNED)) as max_seq 
                     FROM documents 
                     WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
                     AND quotation_id LIKE CONCAT(?, '%', ?)
                     AND is_borrow = 1`;

        const [rows] = await database.query(sql, [prefix, customerName, prefix, suffix]);
        const maxSeq = rows[0].max_seq || 0;
        const nextSeq = maxSeq + 1;
        const seq = String(nextSeq).padStart(2, '0');

        const docId = `${prefix}${seq}${suffix}`;

        return res.json({ message: 'success', docId });
    } catch (error) {
        console.error('getNextBorrowDocId Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 7. MOVE BORROW TO QUOTATION
// --------------------------------------------------------------------------
export async function moveBorrowToQuotation(req, res) {
    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        const [docs] = await conn.query(`SELECT * FROM documents WHERE id = ? FOR UPDATE`, [id]);
        if (docs.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }

        const doc = docs[0];
        res.locals.auditSnapshots = { before: await readAuditSnapshot('quotation', id, conn) };
        if (!doc.is_borrow) {
            await conn.rollback();
            return res.status(400).json({ message: "This document is not a borrow slip" });
        }

        const customerName = (doc.customer_name || '').trim();
        if (!customerName) {
            await conn.rollback();
            return res.status(400).json({ message: "Customer name is missing on the borrow slip" });
        }

        const now = new Date();
        const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
        const ceYear = bangkokTime.getFullYear();
        const thaiYear = (ceYear + 543) % 100;
        const month = bangkokTime.getMonth() + 1;
        const date = bangkokTime.getDate();

        const thaiYearStr = String(thaiYear).padStart(2, '0');
        const monthStr = String(month).padStart(2, '0');
        const dateStr = String(date).padStart(2, '0');

        // 1. Generate new Quotation ID (DATA...)
        const prefix = `DATA${thaiYearStr}-${monthStr}`;
        const suffix = `/${ceYear}`;

        const sql = `SELECT MAX(CAST(SUBSTRING(quotation_id, LENGTH(?) + 1) AS UNSIGNED)) as max_seq 
                     FROM documents 
                     WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
                     AND quotation_id LIKE CONCAT(?, '%', ?)`;

        const [rows] = await conn.query(sql, [prefix, customerName, prefix, suffix]);
        const maxSeq = rows[0].max_seq || 0;
        const nextSeq = maxSeq + 1;
        const seq = String(nextSeq).padStart(2, '0');
        const newQuotationId = `${prefix}${seq}${suffix}`;

        // 2. Generate new Delivery Note ID (IV...) if not already present
        let newDeliveryNoteNo = doc.delivery_note_no;
        if (!newDeliveryNoteNo) {
            const ivPrefix = `IV${thaiYearStr}${monthStr}`;
            const ivSql = `SELECT MAX(CAST(SUBSTRING(delivery_note_no, LENGTH(?) + 1) AS UNSIGNED)) as max_seq 
                           FROM documents
                           WHERE delivery_note_no IS NOT NULL
                           AND delivery_note_no LIKE CONCAT(?, '%')`;

            const [ivRows] = await conn.query(ivSql, [ivPrefix, ivPrefix]);
            const ivMaxSeq = ivRows[0].max_seq || 0;
            const nextIvSeq = ivMaxSeq + 1;
            const ivSeq = String(nextIvSeq).padStart(3, '0');
            newDeliveryNoteNo = `${ivPrefix}${ivSeq}`;
        }

        // 3. Generate new System ID (QT-xxx)
        const [lastRows] = await conn.query(
            `SELECT id FROM documents WHERE id LIKE 'QT-%' AND id NOT LIKE 'QT-____-%' ORDER BY LENGTH(id) DESC, id DESC LIMIT 1`
        );
        
        let nextId = "QT-001";
        if (lastRows.length > 0) {
            const lastId = lastRows[0].id;
            const parts = lastId.split('-');
            if (parts.length === 2 && !isNaN(parts[1])) {
                const nextNum = parseInt(parts[1], 10) + 1; 
                nextId = `QT-${String(nextNum).padStart(3, '0')}`;
            }
        }
        const newSystemId = nextId;

        // 4. Set today's date as delivery date
        const todayThaiStr = `${dateStr}-${monthStr}-${thaiYear + 543}`;
        const todaySql = `${ceYear}-${monthStr}-${dateStr}`;

        // 5. Insert new Quotation Document (is_borrow = 0, current_status = 'DELIVERY_NOTE')
        const insertDocSql = `INSERT INTO documents (
            id, quotation_id, current_status, customer_name, contact_person, customer_tax_id, customer_phone, customer_address,
            salesman, remark, 
            issue_date_str, issue_date, price_validity_days, valid_until_str, valid_until, offerer_name,
            delivery_note_no, delivery_date_str, delivery_date, payment_term, due_date_str, due_date, delivery_address,
            receiver_name, received_date_str, received_date, sender_name, sent_date_str, sent_date, delivery_authorized_signer,
            receipt_no, receipt_issue_date_str, receipt_issue_date, payment_method, 
            cheque_bank, cheque_branch, cheque_no, cheque_amount, cheque_date_str, cheque_date,
            goods_received_check_date_str, goods_received_check_date, money_receiver_name, money_receive_date_str, money_receive_date, receipt_authorized_signer,
            is_borrow, borrow_status, from_borrow_id, from_borrow_no, item_group_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        await conn.query(insertDocSql, [
            newSystemId,
            newQuotationId,
            'DELIVERY_NOTE',
            doc.customer_name, doc.contact_person, doc.customer_tax_id, doc.customer_phone, doc.customer_address,
            doc.salesman, doc.remark,
            doc.issue_date_str, doc.issue_date, doc.price_validity_days, doc.valid_until_str, doc.valid_until, doc.offerer_name,
            newDeliveryNoteNo, todayThaiStr, todaySql, doc.payment_term, doc.due_date_str, doc.due_date, doc.delivery_address,
            doc.receiver_name, doc.received_date_str, doc.received_date, doc.sender_name, doc.sent_date_str, doc.sent_date, doc.delivery_authorized_signer,
            doc.receipt_no, doc.receipt_issue_date_str, doc.receipt_issue_date, doc.payment_method,
            doc.cheque_bank, doc.cheque_branch, doc.cheque_no, doc.cheque_amount, doc.cheque_date_str, doc.cheque_date,
            doc.goods_received_check_date_str, doc.goods_received_check_date, doc.money_receiver_name, doc.money_receive_date_str, doc.money_receive_date, doc.receipt_authorized_signer,
            0,
            null,
            id,
            doc.quotation_id,
            doc.item_group_name || null
        ]);

        // 6. Copy sections & items
        const [sections] = await conn.query(`SELECT * FROM document_sections WHERE document_id = ? ORDER BY sort_order`, [id]);
        for (const sec of sections) {
            const [secRes] = await conn.query(
                `INSERT INTO document_sections (document_id, section_name, sort_order) VALUES (?, ?, ?)`,
                [newSystemId, sec.section_name, sec.sort_order]
            );
            const newSecId = secRes.insertId;

            const [items] = await conn.query(`SELECT * FROM document_items WHERE section_id = ? ORDER BY sort_order`, [sec.id]);
            if (items.length > 0) {
                const itemsValues = items.map(item => [
                    newSecId,
                    item.description,
                    item.quantity,
                    item.unit,
                    item.unit_price,
                    item.sort_order,
                    item.is_sub_item,
                    item.order_source,
                    item.is_desc_only
                ]);
                await conn.query(
                    `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source, is_desc_only) VALUES ?`,
                    [itemsValues]
                );
            }
        }

        // 7. Update source borrow slip status to REQUISITIONED and ensure delivery note number is saved
        await conn.query(
            `UPDATE documents SET borrow_status = 'REQUISITIONED', delivery_note_no = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [newDeliveryNoteNo, id]
        );

        res.locals.auditSnapshots.after = await readAuditSnapshot('quotation', id, conn);
        await conn.commit();
        res.json({ 
            message: "success", 
            quotation_id: newQuotationId,
            delivery_note_no: newDeliveryNoteNo,
            new_id: newSystemId
        });

    } catch (error) {
        await conn.rollback();
        console.error("moveBorrowToQuotation Error:", error);
        res.status(500).json({ message: "Internal server error" });
    } finally {
        conn.release();
    }
}

export async function updateQuotationStatus(req, res) {
    const conn = await database.pool.getConnection();
    try {
        const { id } = req.params;
        const { current_status, borrow_status, delivery_note_no } = req.body;
        
        if (!current_status && !borrow_status && delivery_note_no === undefined) {
            return res.status(400).json({ message: "No fields provided to update (current_status, borrow_status, or delivery_note_no)" });
        }

        await conn.beginTransaction();
        const [existing] = await conn.query(
            "SELECT current_status, delivery_note_no FROM documents WHERE id = ? FOR UPDATE", [id]
        );
        if (existing.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }
        res.locals.quotationBefore = existing[0];
        res.locals.auditSnapshots = { before: await readAuditSnapshot('quotation', id, conn) };
        const statusConflict = getQuotationStatusConflict(existing[0], req.body);
        if (statusConflict) {
            await conn.rollback();
            return res.status(409).json(statusConflict);
        }

        const setClauses = [];
        const params = [];

        if (current_status !== undefined) {
            setClauses.push("current_status = ?");
            params.push(current_status);
        }
        if (borrow_status !== undefined) {
            setClauses.push("borrow_status = ?");
            params.push(borrow_status);
        }
        if (delivery_note_no !== undefined) {
            setClauses.push("delivery_note_no = ?");
            params.push(delivery_note_no ? String(delivery_note_no).trim() : null);
        }
        setClauses.push("updated_at = CURRENT_TIMESTAMP");

        params.push(id);
        
        // 1. Update document
        await conn.query(
            `UPDATE documents SET ${setClauses.join(", ")} WHERE id = ?`,
            params
        );
        
        // 2. If changing to ORDERING, create or update the order note automatically!
        if (current_status === "ORDERING") {
            // Fetch quotation header and items to build note body
            const [docs] = await conn.query("SELECT customer_name FROM documents WHERE id = ?", [id]);
            if (docs.length > 0) {
                const customerName = docs[0].customer_name;
                
                // Fetch sections and items
                const [items] = await conn.query(
                    `SELECT di.description, di.quantity, di.unit 
                     FROM document_items di
                     JOIN document_sections ds ON di.section_id = ds.id
                     WHERE ds.document_id = ?
                     ORDER BY ds.sort_order, di.sort_order`,
                    [id]
                );
                
                let noteBody = "";
                items.forEach((item) => {
                    const qty = item.quantity || 1;
                    const unit = item.unit || "ชิ้น";
                    noteBody += `[ ] ${item.description} - ${qty} ${unit}\n`;
                });
                
                if (noteBody.trim()) {
                    // Check if note already exists
                    const [existing] = await conn.query(
                        "SELECT id FROM order_notes WHERE quotation_id = ?",
                        [id]
                    );
                    
                    const department = customerName || "ฝ่ายจัดซื้อ";
                    const bodyText = noteBody.trim();
                    
                    if (existing.length > 0) {
                        await conn.query(
                            "UPDATE order_notes SET department = ?, body = ? WHERE quotation_id = ?",
                            [department, bodyText, id]
                        );
                    } else {
                        await conn.query(
                            "INSERT INTO order_notes (department, body, quotation_id) VALUES (?, ?, ?)",
                            [department, bodyText, id]
                        );
                    }
                }
            }
        } else if (current_status) {
            // 3. If status changed AWAY from ORDERING, delete the linked order note
            await conn.query(
                "DELETE FROM order_notes WHERE quotation_id = ?",
                [id]
            );
        }
        
        res.locals.auditSnapshots.after = await readAuditSnapshot('quotation', id, conn);
        await conn.commit();
        res.json({ message: "Quotation status updated successfully" });
    } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            // The connection may already be closed.
        }
        console.error("Error updating quotation status:", error);
        res.status(500).json({ message: "Failed to update quotation status", error: error.message });
    } finally {
        conn.release();
    }
}

// --------------------------------------------------------------------------
// 0e. GET DELIVERY NOTES SUMMARY (สรุปเลขใบส่งของ/ใบกำกับภาษี)
// --------------------------------------------------------------------------
export async function getDeliveryNotesSummary(req, res) {
    try {
        const now = new Date();
        const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));

        const currentCeYear = bangkokTime.getFullYear();
        const currentMonth = bangkokTime.getMonth() + 1;

        // Parse year & month from query (default to current Bangkok year & month)
        let targetCeYear = currentCeYear;
        if (req.query.year) {
            const parsedY = parseInt(req.query.year, 10);
            if (!isNaN(parsedY)) {
                targetCeYear = parsedY > 2400 ? parsedY - 543 : parsedY;
            }
        }

        let targetMonth = currentMonth;
        if (req.query.month !== undefined && req.query.month !== '' && req.query.month !== null) {
            const parsedM = parseInt(req.query.month, 10);
            if (!isNaN(parsedM) && parsedM >= 1 && parsedM <= 12) {
                targetMonth = parsedM;
            }
        }

        const thaiYear = (targetCeYear + 543) % 100;
        const thaiYearStr = String(thaiYear).padStart(2, '0');
        const monthStr = String(targetMonth).padStart(2, '0');
        const prefix = `IV${thaiYearStr}${monthStr}`;

        const { search = '', statusFilter = 'all' } = req.query;

        // Fetch documents belonging to this month by prefix or date
        const sql = `
            SELECT 
                d.id,
                d.quotation_id,
                d.item_group_name,
                d.delivery_note_no,
                d.receipt_no,
                d.customer_name,
                d.contact_person,
                d.customer_phone,
                d.current_status,
                d.delivery_date,
                d.delivery_date_str,
                d.issue_date,
                d.issue_date_str,
                d.salesman,
                d.remark,
                d.created_at,
                (SELECT GROUP_CONCAT(ds.section_name SEPARATOR ', ') 
                 FROM document_sections ds 
                 WHERE ds.document_id = d.id) as section_names,
                COALESCE((
                    SELECT SUM(di.quantity * di.unit_price)
                    FROM document_sections ds
                    JOIN document_items di ON di.section_id = ds.id
                    WHERE ds.document_id = d.id
                ), 0) as total
            FROM documents d
            WHERE d.is_borrow = 0
              AND d.delivery_note_no LIKE CONCAT(?, '%')
            ORDER BY d.delivery_note_no ASC, d.id ASC
        `;

        const [docs] = await database.query(sql, [prefix]);

        // Group documents by trimmed uppercase delivery_note_no
        const docMap = new Map();
        let maxSeq = 0;

        docs.forEach(doc => {
            const rawNo = (doc.delivery_note_no || '').trim();
            if (!rawNo) return;
            const upperNo = rawNo.toUpperCase();
            if (!docMap.has(upperNo)) {
                docMap.set(upperNo, []);
            }
            docMap.get(upperNo).push(doc);

            if (upperNo.startsWith(prefix.toUpperCase())) {
                const suffix = rawNo.substring(prefix.length);
                const seqMatch = suffix.match(/^\d+/);
                if (seqMatch) {
                    const seqVal = parseInt(seqMatch[0], 10);
                    if (!isNaN(seqVal) && seqVal > maxSeq) {
                        maxSeq = seqVal;
                    }
                }
            }
        });

        const allItems = [];
        const processedKeys = new Set();

        const formatThaiDate = (dateVal) => {
            if (!dateVal) return '-';
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return '-';
            const bangkokStr = d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
            const bDate = new Date(bangkokStr);
            const day = String(bDate.getDate()).padStart(2, '0');
            const month = String(bDate.getMonth() + 1).padStart(2, '0');
            const yearBE = bDate.getFullYear() + 543;
            return `${day}-${month}-${yearBE}`;
        };

        const mapStatusLabel = (status) => {
            const map = {
                QUOTATION: "ใบเสนอราคา",
                ORDERING: "กำลังสั่งของ",
                ITEMS_READY: "ของครบพร้อมส่ง",
                DELIVERY_NOTE: "ใบส่งของ",
                RECEIPT: "ใบเสร็จรับเงิน",
                BORROW: "ใบยืม",
                CANCELLED: "ยกเลิก"
            };
            return map[status] || status || "ไม่ระบุ";
        };

        // 1. Build sequence from 1 to maxSeq (ordered from least to greatest)
        for (let s = 1; s <= maxSeq; s++) {
            const seqStr = String(s).padStart(3, '0');
            const ivNo = `${prefix}${seqStr}`;
            processedKeys.add(ivNo.toUpperCase());

            const docsForIv = docMap.get(ivNo.toUpperCase()) || [];
            const activeDoc = docsForIv.find(d => d.current_status !== 'CANCELLED');
            const cancelledDoc = docsForIv.find(d => d.current_status === 'CANCELLED');

            if (activeDoc) {
                const creationDateStr = activeDoc.created_at ? formatThaiDate(activeDoc.created_at) : (activeDoc.issue_date_str || '-');
                allItems.push({
                    seq: s,
                    delivery_note_no: activeDoc.delivery_note_no,
                    display_no: activeDoc.delivery_note_no,
                    is_cash_sale: false,
                    status: activeDoc.current_status,
                    status_label: mapStatusLabel(activeDoc.current_status),
                    document_id: activeDoc.id,
                    quotation_id: activeDoc.quotation_id || '-',
                    customer_name: activeDoc.customer_name || '-',
                    original_customer: null,
                    contact_person: activeDoc.contact_person || '',
                    customer_phone: activeDoc.customer_phone || '',
                    created_at: activeDoc.created_at || null,
                    created_date: creationDateStr,
                    delivery_date: creationDateStr,
                    total: Number(activeDoc.total) || 0,
                    section_names: activeDoc.section_names || '-',
                    item_group_name: activeDoc.item_group_name || null,
                    salesman: activeDoc.salesman || '',
                    remark: activeDoc.remark || '',
                    cash_sale_reason: ''
                });
            } else if (cancelledDoc) {
                // Quotation has delivery note cancelled -> display as "ขายสด"
                const creationDateStr = cancelledDoc.created_at ? formatThaiDate(cancelledDoc.created_at) : (cancelledDoc.issue_date_str || '-');
                allItems.push({
                    seq: s,
                    delivery_note_no: ivNo,
                    display_no: 'ขายสด',
                    is_cash_sale: true,
                    status: 'CASH_SALE',
                    status_label: 'ขายสด',
                    document_id: cancelledDoc.id,
                    quotation_id: cancelledDoc.quotation_id || cancelledDoc.id || '-',
                    customer_name: 'ขายสด',
                    original_customer: cancelledDoc.customer_name,
                    contact_person: cancelledDoc.contact_person || '',
                    customer_phone: cancelledDoc.customer_phone || '',
                    created_at: cancelledDoc.created_at || null,
                    created_date: creationDateStr,
                    delivery_date: creationDateStr,
                    total: 0,
                    section_names: cancelledDoc.section_names || '-',
                    item_group_name: cancelledDoc.item_group_name || null,
                    salesman: cancelledDoc.salesman || '',
                    remark: cancelledDoc.remark || '',
                    cash_sale_reason: `ยกเลิกใบส่งของ (${cancelledDoc.quotation_id || cancelledDoc.id})`
                });
            } else {
                // Gap in sequence -> display as "ขายสด"
                allItems.push({
                    seq: s,
                    delivery_note_no: ivNo,
                    display_no: 'ขายสด',
                    is_cash_sale: true,
                    status: 'CASH_SALE',
                    status_label: 'ขายสด',
                    document_id: null,
                    quotation_id: '-',
                    customer_name: 'ขายสด',
                    original_customer: null,
                    contact_person: '',
                    customer_phone: '',
                    created_at: null,
                    created_date: '-',
                    delivery_date: '-',
                    total: 0,
                    section_names: '-',
                    item_group_name: null,
                    salesman: '',
                    remark: '',
                    cash_sale_reason: 'ขายสด (ไม่มีในระบบใบเสนอราคา)'
                });
            }
        }

        // 2. Include any other delivery notes that weren't in the prefix 1..maxSeq sequence
        docs.forEach(doc => {
            const rawNo = (doc.delivery_note_no || '').trim();
            if (!rawNo) return;
            const key = rawNo.toUpperCase();
            if (!processedKeys.has(key)) {
                processedKeys.add(key);
                const isCancelled = doc.current_status === 'CANCELLED';
                const creationDateStr = doc.created_at ? formatThaiDate(doc.created_at) : (doc.issue_date_str || '-');
                allItems.push({
                    seq: null,
                    delivery_note_no: doc.delivery_note_no,
                    display_no: isCancelled ? 'ขายสด' : doc.delivery_note_no,
                    is_cash_sale: isCancelled,
                    status: isCancelled ? 'CASH_SALE' : doc.current_status,
                    status_label: isCancelled ? 'ขายสด' : mapStatusLabel(doc.current_status),
                    document_id: doc.id,
                    quotation_id: doc.quotation_id || doc.id || '-',
                    customer_name: isCancelled ? 'ขายสด' : (doc.customer_name || '-'),
                    original_customer: isCancelled ? doc.customer_name : null,
                    contact_person: doc.contact_person || '',
                    customer_phone: doc.customer_phone || '',
                    created_at: doc.created_at || null,
                    created_date: creationDateStr,
                    delivery_date: creationDateStr,
                    total: isCancelled ? 0 : (Number(doc.total) || 0),
                    section_names: doc.section_names || '-',
                    item_group_name: doc.item_group_name || null,
                    salesman: doc.salesman || '',
                    remark: doc.remark || '',
                    cash_sale_reason: isCancelled ? `ยกเลิกใบส่งของ (${doc.quotation_id || doc.id})` : ''
                });
            }
        });

        // 3. Sort descending (from greatest to least: มากไปน้อย)
        allItems.sort((a, b) => {
            if (a.seq !== null && b.seq !== null) {
                return b.seq - a.seq;
            }
            if (a.seq !== null) return -1;
            if (b.seq !== null) return 1;
            return (b.delivery_note_no || '').localeCompare(a.delivery_note_no || '', undefined, { numeric: true });
        });

        // 4. Calculate summary stats
        const summary = {
            total: allItems.length,
            activeCount: allItems.filter(i => !i.is_cash_sale).length,
            cashSaleCount: allItems.filter(i => i.is_cash_sale).length,
            totalAmount: allItems.reduce((acc, curr) => acc + (curr.total || 0), 0),
            prefix,
            maxSeq
        };

        // 5. Apply filters if requested
        let filteredItems = allItems;

        if (statusFilter === 'active') {
            filteredItems = filteredItems.filter(i => !i.is_cash_sale);
        } else if (statusFilter === 'cash_sale') {
            filteredItems = filteredItems.filter(i => i.is_cash_sale);
        }

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filteredItems = filteredItems.filter(i => {
                return (
                    (i.delivery_note_no && i.delivery_note_no.toLowerCase().includes(q)) ||
                    (i.quotation_id && i.quotation_id.toLowerCase().includes(q)) ||
                    (i.customer_name && i.customer_name.toLowerCase().includes(q)) ||
                    (i.original_customer && i.original_customer.toLowerCase().includes(q)) ||
                    (i.document_id && i.document_id.toLowerCase().includes(q)) ||
                    (i.display_no && i.display_no.toLowerCase().includes(q))
                );
            });
        }

        return res.json({
            message: 'success',
            year: targetCeYear,
            thaiYear,
            month: targetMonth,
            prefix,
            summary,
            items: filteredItems,
            totalItems: filteredItems.length
        });
    } catch (error) {
        console.error('getDeliveryNotesSummary Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}
