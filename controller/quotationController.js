import database from "../service/database.js";

// Helper: ตรวจสอบค่าว่าเป็น Null หรือ Empty String หรือไม่
const cleanVal = (val) => (val === "" || val === undefined || val === "null" ? null : val);

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
                d.delivery_note_no, 
                d.receipt_no, 
                d.customer_name, 
                d.contact_person,
                d.current_status, 
                d.issue_date, 
                d.issue_date_str,
                d.created_at,
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
            const searchCond = ` AND (d.id LIKE ? OR d.customer_name LIKE ? OR d.quotation_id LIKE ? OR d.delivery_note_no LIKE ? OR d.receipt_no LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term, term, term, term);
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
            is_borrow, borrow_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
            isBorrow,
            data.borrow_status || null
        ];

        await conn.query(docSql, docParams);

        // 3. Insert Sections & Items
        if (data.productSections && Array.isArray(data.productSections)) {
            let secOrder = 0;
            for (const section of data.productSections) {
                secOrder++;
                const [secResult] = await conn.query(
                    `INSERT INTO document_sections (document_id, section_name, sort_order) VALUES (?, ?, ?)`,
                    [systemId, section.section_name, secOrder]
                );
                
                const sectionId = secResult.insertId;

                if (section.items && Array.isArray(section.items) && section.items.length > 0) {
                    let itemOrder = 0;
                    const itemsData = section.items.map(item => {
                        itemOrder++;
                        const isSubItem = item.is_sub_item ? 1 : 0;
                        return [sectionId, item.description, cleanVal(item.quantity), item.unit, cleanVal(item.unit_price), itemOrder, isSubItem, item.order_source || null];
                    });
                    
                    await conn.query(
                        `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source) VALUES ?`,
                        [itemsData]
                    );
                }
            }
        }

        await conn.commit();
        // ส่ง ID กลับไปให้ Frontend ใช้ Redirect
        res.status(201).json({ message: "Quotation created successfully", id: systemId });

    } catch (error) {
        await conn.rollback();
        console.error("Error creating quotation:", error);
        res.status(500).json({ message: "Failed to create quotation", error: error.message });
    } finally {
        conn.release();
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
        const [existing] = await conn.query("SELECT id, is_borrow, borrow_status FROM documents WHERE id = ?", [id]);
        if (existing.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }
        const existingDoc = existing[0];

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
            is_borrow = ?, borrow_status = ?
            WHERE id = ?`; // Update record ที่มี System ID ตรงกัน

        const updateParams = [
            data.quotation_id, // Parameter 1: เลขที่ใบเสนอราคาที่ User กรอก
            data.current_status,
            data.customer_name, data.contact_person, data.customer_tax_id, data.customer_phone, data.customer_address,
            data.salesman, data.remark,
            
            data.issue_date_str, cleanVal(data.issue_date), data.price_validity_days, data.valid_until_str, cleanVal(data.valid_until), data.offerer_name,
            
            data.delivery_note_no, data.delivery_date_str, cleanVal(data.delivery_date), data.payment_term, data.due_date_str, cleanVal(data.due_date), data.delivery_address,
            data.receiver_name, data.received_date_str, cleanVal(data.received_date), data.sender_name, data.sent_date_str, cleanVal(data.sent_date), data.delivery_authorized_signer,
            
            data.receipt_no, data.receipt_issue_date_str, cleanVal(data.receipt_issue_date), data.payment_method,
            data.cheque_bank, data.cheque_branch, data.cheque_no, data.cheque_amount, data.cheque_date_str, cleanVal(data.cheque_date),
            data.goods_received_check_date_str, cleanVal(data.goods_received_check_date), data.money_receiver_name, data.money_receive_date_str, cleanVal(data.money_receive_date), data.receipt_authorized_signer,
            isBorrowValue,
            borrowStatusValue,
            
            id // Parameter สุดท้าย: System ID (Primary Key)
        ];

        await conn.query(updateSql, updateParams);

        // 3. Clear & Re-insert Sections
        await conn.query(`DELETE FROM document_sections WHERE document_id = ?`, [id]);

        if (data.productSections && Array.isArray(data.productSections)) {
            let secOrder = 0;
            for (const section of data.productSections) {
                secOrder++;
                const [secResult] = await conn.query(
                    `INSERT INTO document_sections (document_id, section_name, sort_order) VALUES (?, ?, ?)`,
                    [id, section.section_name, secOrder]
                );
                
                const sectionId = secResult.insertId;

                if (section.items && Array.isArray(section.items) && section.items.length > 0) {
                    let itemOrder = 0;
                    const itemsData = section.items.map(item => {
                        itemOrder++;
                        const isSubItem = item.is_sub_item ? 1 : 0;
                        return [sectionId, item.description, cleanVal(item.quantity), item.unit, cleanVal(item.unit_price), itemOrder, isSubItem, item.order_source || null];
                    });
                    
                    await conn.query(
                        `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source) VALUES ?`,
                        [itemsData]
                    );
                }
            }
        }

        await conn.commit();
        res.json({ message: "Quotation updated successfully", id });

    } catch (error) {
        await conn.rollback();
        console.error("Error updating quotation:", error);
        res.status(500).json({ message: "Failed to update quotation", error: error.message });
    } finally {
        conn.release();
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

        const [docs] = await conn.query(`SELECT * FROM documents WHERE id = ?`, [id]);
        if (docs.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }

        const doc = docs[0];
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
            is_borrow, borrow_status, from_borrow_id, from_borrow_no
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
            doc.quotation_id
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
                    item.order_source
                ]);
                await conn.query(
                    `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order, is_sub_item, order_source) VALUES ?`,
                    [itemsValues]
                );
            }
        }

        // 7. Update source borrow slip status to REQUISITIONED and ensure delivery note number is saved
        await conn.query(
            `UPDATE documents SET borrow_status = 'REQUISITIONED', delivery_note_no = ? WHERE id = ?`,
            [newDeliveryNoteNo, id]
        );

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
    try {
        const { id } = req.params;
        const { current_status } = req.body;
        
        if (!current_status) {
            return res.status(400).json({ message: "current_status is required" });
        }
        
        // 1. Update status
        await database.query(
            "UPDATE documents SET current_status = ? WHERE id = ?",
            [current_status, id]
        );
        
        // 2. If changing to ORDERING, create or update the order note automatically!
        if (current_status === "ORDERING") {
            // Fetch quotation header and items to build note body
            const [docs] = await database.query("SELECT customer_name FROM documents WHERE id = ?", [id]);
            if (docs.length > 0) {
                const customerName = docs[0].customer_name;
                
                // Fetch sections and items
                const [items] = await database.query(
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
                    const [existing] = await database.query(
                        "SELECT id FROM order_notes WHERE quotation_id = ?",
                        [id]
                    );
                    
                    const department = customerName || "ฝ่ายจัดซื้อ";
                    const bodyText = noteBody.trim();
                    
                    if (existing.length > 0) {
                        await database.query(
                            "UPDATE order_notes SET department = ?, body = ? WHERE quotation_id = ?",
                            [department, bodyText, id]
                        );
                    } else {
                        await database.query(
                            "INSERT INTO order_notes (department, body, quotation_id) VALUES (?, ?, ?)",
                            [department, bodyText, id]
                        );
                    }
                }
            }
        } else {
            // 3. If status changed AWAY from ORDERING, delete the linked order note
            await database.query(
                "DELETE FROM order_notes WHERE quotation_id = ?",
                [id]
            );
        }
        
        res.json({ message: "Quotation status updated successfully" });
    } catch (error) {
        console.error("Error updating quotation status:", error);
        res.status(500).json({ message: "Failed to update quotation status", error: error.message });
    }
}