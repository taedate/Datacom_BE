import database from "../service/database.js";

// --------------------------------------------------------------------------
// 1. SUGGEST (Autocomplete) — ค้นหาจากตาราง customers
// --------------------------------------------------------------------------
export async function suggestCustomers(req, res) {
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

        // ค้นหาจาก customers table
        // ให้ความสำคัญกับชื่อที่ขึ้นต้นด้วยคำค้นหา (matchPriority = 2)
        const sql = `
            SELECT
                id,
                customer_name  AS customerName,
                customer_tax_id AS customerTaxId,
                customer_phone  AS customerPhone,
                customer_address AS customerAddress
            FROM customers
            WHERE customer_name IS NOT NULL
              AND TRIM(customer_name) <> ''
              AND LOWER(customer_name) LIKE CONCAT('%', LOWER(?), '%')
            ORDER BY
                CASE
                    WHEN LOWER(TRIM(customer_name)) LIKE CONCAT(LOWER(?), '%') THEN 0
                    ELSE 1
                END,
                updated_at DESC
            LIMIT ?
        `;

        const [rows] = await database.query(sql, [q, q, limit]);
        return res.status(200).json({ data: rows || [] });
    } catch (error) {
        console.error('suggestCustomers Error:', error);
        return res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// --------------------------------------------------------------------------
// 2. GET ALL CUSTOMERS (Pagination + Search)
// --------------------------------------------------------------------------
export async function getAllCustomers(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search } = req.query;
        const offset = (Number(page) - 1) * Number(itemsPerPage);
        const limit = Number(itemsPerPage) || 10;

        let sql = `SELECT * FROM customers WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM customers WHERE 1=1`;
        let params = [];

        if (search) {
            const term = `%${search}%`;
            const searchCond = ` AND (customer_name LIKE ? OR customer_tax_id LIKE ? OR customer_phone LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term, term);
        }

        sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;

        const [rows] = await database.query(sql, [...params, limit, offset]);
        const [countResult] = await database.query(countSql, params);

        res.json({
            message: "success",
            data: rows,
            totalItems: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / limit)
        });
    } catch (error) {
        console.error("Error getting customers:", error);
        res.status(500).json({ message: "error", error: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 3. GET SINGLE CUSTOMER
// --------------------------------------------------------------------------
export async function getCustomerById(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM customers WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Customer not found' });
        }

        res.json({ message: 'success', data: rows[0] });
    } catch (error) {
        console.error("Error getting customer:", error);
        res.status(500).json({ message: "error", error: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 4. CREATE CUSTOMER
// --------------------------------------------------------------------------
export async function createCustomer(req, res) {
    try {
        const { customer_name, customer_tax_id, customer_phone, customer_address } = req.body;

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ message: 'error', error: 'customer_name is required' });
        }

        const sql = `INSERT INTO customers (customer_name, customer_tax_id, customer_phone, customer_address)
                     VALUES (?, ?, ?, ?)`;

        const [result] = await database.query(sql, [
            customer_name.trim(),
            customer_tax_id || null,
            customer_phone || null,
            customer_address || null
        ]);

        res.status(201).json({
            message: 'success',
            id: result.insertId
        });
    } catch (error) {
        console.error("Error creating customer:", error);
        res.status(500).json({ message: "error", error: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 5. UPDATE CUSTOMER
// --------------------------------------------------------------------------
export async function updateCustomer(req, res) {
    try {
        const { id } = req.params;
        const { customer_name, customer_tax_id, customer_phone, customer_address } = req.body;

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ message: 'error', error: 'customer_name is required' });
        }

        const sql = `UPDATE customers SET
            customer_name = ?,
            customer_tax_id = ?,
            customer_phone = ?,
            customer_address = ?
            WHERE id = ?`;

        const [result] = await database.query(sql, [
            customer_name.trim(),
            customer_tax_id || null,
            customer_phone || null,
            customer_address || null,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Customer not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error("Error updating customer:", error);
        res.status(500).json({ message: "error", error: "Internal server error" });
    }
}

// --------------------------------------------------------------------------
// 6. DELETE CUSTOMER
// --------------------------------------------------------------------------
export async function deleteCustomer(req, res) {
    try {
        const { id } = req.params;
        const [result] = await database.query('DELETE FROM customers WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Customer not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error("Error deleting customer:", error);
        res.status(500).json({ message: "error", error: "Internal server error" });
    }
}
