import database from "../service/database.js";

// Helper: ตรวจสอบค่าว่าเป็น Null หรือ Empty String หรือไม่
const cleanVal = (val) => (val === "" || val === undefined || val === "null" ? null : val);

// --------------------------------------------------------------------------
// 1. GET ALL QUOTATIONS (Optimized for List View)
// --------------------------------------------------------------------------
export async function getAllQuotations(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, status, startDate, endDate, sort_by, sort_order } = req.query;
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
                d.current_status, 
                d.issue_date, 
                d.issue_date_str,
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

        if (search) {
            const term = `%${search}%`;
            const searchCond = ` AND (d.id LIKE ? OR d.customer_name LIKE ? OR d.quotation_id LIKE ? OR d.delivery_note_no LIKE ? OR d.receipt_no LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term, term, term, term);
        }

        if (status) {
            sql += ` AND d.current_status = ?`;
            countSql += ` AND d.current_status = ?`;
            params.push(status);
        }
        
        if (startDate) {
             sql += ` AND d.issue_date >= ?`;
             countSql += ` AND d.issue_date >= ?`;
             params.push(startDate);
        }
        if (endDate) {
             sql += ` AND d.issue_date <= ?`;
             countSql += ` AND d.issue_date <= ?`;
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
        
        const [docs] = await database.query(`SELECT * FROM documents WHERE id = ?`, [id]);
        
        if (docs.length === 0) {
            return res.status(404).json({ message: "Document not found" });
        }
        
        const document = Object.assign({}, docs[0]); 
        
        const [sections] = await database.query(
            `SELECT * FROM document_sections WHERE document_id = ? ORDER BY sort_order ASC`, 
            [id]
        );

        let items = [];
        if (sections.length > 0) {
            const sectionIds = sections.map(s => s.id);
            if (sectionIds.length > 0) {
                const [rows] = await database.query(
                    `SELECT * FROM document_items WHERE section_id IN (?) ORDER BY sort_order ASC`, 
                    [sectionIds]
                );
                items = rows;
            }
        }

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
// 3. CREATE NEW QUOTATION (Auto Generate System ID: QT-00x)
// --------------------------------------------------------------------------
export async function createQuotation(req, res) {
    const conn = await database.pool.getConnection();
    try {
        await conn.beginTransaction();

        const data = req.body;
        
        // --- 1. GENERATE SYSTEM ID (QT-XXX) ---
        // Logic: หา QT-XXX ตัวล่าสุด แล้วบวก 1
        const [lastRows] = await conn.query(
            `SELECT id FROM documents WHERE id LIKE 'QT-%' AND id NOT LIKE 'QT-____-%' ORDER BY LENGTH(id) DESC, id DESC LIMIT 1`
        );
        
        let nextId = "QT-001";
        if (lastRows.length > 0) {
            const lastId = lastRows[0].id; // e.g., QT-005
            const parts = lastId.split('-'); // ['QT', '005']
            if (parts.length === 2 && !isNaN(parts[1])) {
                const nextNum = parseInt(parts[1], 10) + 1; 
                nextId = `QT-${String(nextNum).padStart(3, '0')}`;
            }
        }

        const systemId = nextId; // นี่คือ Primary Key (id)
        
        // ถ้า User ไม่ได้กรอกเลขที่ใบเสนอราคา (quotation_id) ให้ใช้ System ID ไปก่อน
        const userDocId = data.quotation_id || systemId;

        // 2. Insert Document Header
        const docSql = `INSERT INTO documents (
            id, quotation_id, current_status, customer_name, customer_tax_id, customer_phone, customer_address,
            salesman, remark, 
            issue_date_str, issue_date, price_validity_days, valid_until_str, valid_until, offerer_name,
            delivery_note_no, delivery_date_str, delivery_date, payment_term, due_date_str, due_date, delivery_address,
            receiver_name, received_date_str, received_date, sender_name, sent_date_str, sent_date, delivery_authorized_signer,
            receipt_no, receipt_issue_date_str, receipt_issue_date, payment_method, 
            cheque_bank, cheque_branch, cheque_no, cheque_amount, cheque_date_str, cheque_date,
            goods_received_check_date_str, goods_received_check_date, money_receiver_name, money_receive_date_str, money_receive_date, receipt_authorized_signer
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const docParams = [
            systemId,   // id (Primary Key generated by Backend)
            userDocId,  // quotation_id (User input or Fallback)
            data.current_status || 'QUOTATION', 
            data.customer_name, data.customer_tax_id, data.customer_phone, data.customer_address,
            data.salesman, data.remark,
            
            data.issue_date_str, cleanVal(data.issue_date), data.price_validity_days, data.valid_until_str, cleanVal(data.valid_until), data.offerer_name,
            
            data.delivery_note_no, data.delivery_date_str, cleanVal(data.delivery_date), data.payment_term, data.due_date_str, cleanVal(data.due_date), data.delivery_address,
            data.receiver_name, data.received_date_str, cleanVal(data.received_date), data.sender_name, data.sent_date_str, cleanVal(data.sent_date), data.delivery_authorized_signer,
            
            data.receipt_no, data.receipt_issue_date_str, cleanVal(data.receipt_issue_date), data.payment_method,
            data.cheque_bank, data.cheque_branch, data.cheque_no, data.cheque_amount, data.cheque_date_str, cleanVal(data.cheque_date),
            data.goods_received_check_date_str, cleanVal(data.goods_received_check_date), data.money_receiver_name, data.money_receive_date_str, cleanVal(data.money_receive_date), data.receipt_authorized_signer
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

                if (section.items && Array.isArray(section.items)) {
                    let itemOrder = 0;
                    for (const item of section.items) {
                        itemOrder++;
                        await conn.query(
                            `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
                            [sectionId, item.description, item.quantity, item.unit, item.unit_price, itemOrder]
                        );
                    }
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
        const [existing] = await conn.query("SELECT id FROM documents WHERE id = ?", [id]);
        if (existing.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: "Document not found" });
        }

        // 2. Update Document Fields
        // * quotation_id = ? คืออัปเดตเลขที่ใบเสนอราคาตามที่ User แก้ไข
        const updateSql = `UPDATE documents SET 
            quotation_id = ?,
            current_status = ?, customer_name = ?, customer_tax_id = ?, customer_phone = ?, customer_address = ?,
            salesman = ?, remark = ?, 
            issue_date_str = ?, issue_date = ?, price_validity_days = ?, valid_until_str = ?, valid_until = ?, offerer_name = ?,
            delivery_note_no = ?, delivery_date_str = ?, delivery_date = ?, payment_term = ?, due_date_str = ?, due_date = ?, delivery_address = ?,
            receiver_name = ?, received_date_str = ?, received_date = ?, sender_name = ?, sent_date_str = ?, sent_date = ?, delivery_authorized_signer = ?,
            receipt_no = ?, receipt_issue_date_str = ?, receipt_issue_date = ?, payment_method = ?, 
            cheque_bank = ?, cheque_branch = ?, cheque_no = ?, cheque_amount = ?, cheque_date_str = ?, cheque_date = ?,
            goods_received_check_date_str = ?, goods_received_check_date = ?, money_receiver_name = ?, money_receive_date_str = ?, money_receive_date = ?, receipt_authorized_signer = ?
            WHERE id = ?`; // Update record ที่มี System ID ตรงกัน

        const updateParams = [
            data.quotation_id, // Parameter 1: เลขที่ใบเสนอราคาที่ User กรอก
            data.current_status,
            data.customer_name, data.customer_tax_id, data.customer_phone, data.customer_address,
            data.salesman, data.remark,
            
            data.issue_date_str, cleanVal(data.issue_date), data.price_validity_days, data.valid_until_str, cleanVal(data.valid_until), data.offerer_name,
            
            data.delivery_note_no, data.delivery_date_str, cleanVal(data.delivery_date), data.payment_term, data.due_date_str, cleanVal(data.due_date), data.delivery_address,
            data.receiver_name, data.received_date_str, cleanVal(data.received_date), data.sender_name, data.sent_date_str, cleanVal(data.sent_date), data.delivery_authorized_signer,
            
            data.receipt_no, data.receipt_issue_date_str, cleanVal(data.receipt_issue_date), data.payment_method,
            data.cheque_bank, data.cheque_branch, data.cheque_no, data.cheque_amount, data.cheque_date_str, cleanVal(data.cheque_date),
            data.goods_received_check_date_str, cleanVal(data.goods_received_check_date), data.money_receiver_name, data.money_receive_date_str, cleanVal(data.money_receive_date), data.receipt_authorized_signer,
            
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

                if (section.items && Array.isArray(section.items)) {
                    let itemOrder = 0;
                    for (const item of section.items) {
                        itemOrder++;
                        await conn.query(
                            `INSERT INTO document_items (section_id, description, quantity, unit, unit_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
                            [sectionId, item.description, item.quantity, item.unit, item.unit_price, itemOrder]
                        );
                    }
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