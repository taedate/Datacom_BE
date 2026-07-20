import database from '../service/database.js';

// Auto-migrate stocks table on initialization
(async () => {
    try {
        console.log('Checking/creating stocks table...');
        const sql = `CREATE TABLE IF NOT EXISTS stocks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(100) NOT NULL,
            serial_number VARCHAR(100) DEFAULT NULL,
            quantity INT NOT NULL DEFAULT 1,
            unit VARCHAR(50) DEFAULT 'เครื่อง',
            location VARCHAR(255) DEFAULT NULL,
            status VARCHAR(50) DEFAULT 'พร้อมใช้งาน',
            remark TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );`;
        await database.query(sql);
        console.log('Stocks table check/creation completed successfully.');
    } catch (err) {
        console.error('Error auto-migrating stocks table:', err);
    }
})();

// 1. GET ALL STOCKS (with pagination, search, and filters)
export async function getStocks(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, category, status } = req.query;
        const offset = (Number(page) - 1) * Number(itemsPerPage);
        const limit = Number(itemsPerPage) || 10;

        let sql = `SELECT * FROM stocks WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM stocks WHERE 1=1`;
        let params = [];

        if (search && search.trim()) {
            const term = `%${search.trim()}%`;
            const searchCond = ` AND (name LIKE ? OR serial_number LIKE ? OR location LIKE ? OR remark LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term, term, term);
        }

        if (category && category.trim()) {
            sql += ` AND category = ?`;
            countSql += ` AND category = ?`;
            params.push(category.trim());
        }

        if (status && status.trim()) {
            sql += ` AND status = ?`;
            countSql += ` AND status = ?`;
            params.push(status.trim());
        }

        sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;

        const [rows] = await database.query(sql, [...params, limit, offset]);
        const [countResult] = await database.query(countSql, params);

        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / limit)
        });
    } catch (error) {
        console.error('Error fetching stocks:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 2. CREATE STOCK RECORD
export async function createStock(req, res) {
    try {
        const {
            name,
            category,
            serial_number,
            quantity,
            unit,
            location,
            status,
            remark
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'error', error: 'name is required' });
        }
        if (!category || !category.trim()) {
            return res.status(400).json({ message: 'error', error: 'category is required' });
        }

        const parsedQty = parseInt(quantity, 10);
        const qty = isNaN(parsedQty) ? 1 : parsedQty;

        const sql = `INSERT INTO stocks 
            (name, category, serial_number, quantity, unit, location, status, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const [result] = await database.query(sql, [
            name.trim(),
            category.trim(),
            serial_number ? serial_number.trim() : null,
            qty,
            unit ? unit.trim() : 'เครื่อง',
            location ? location.trim() : null,
            status ? status.trim() : 'พร้อมใช้งาน',
            remark ? remark.trim() : null
        ]);

        res.status(201).json({
            message: 'success',
            id: result.insertId
        });
    } catch (error) {
        console.error('Error creating stock record:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 3. UPDATE STOCK RECORD
export async function updateStock(req, res) {
    try {
        const { id } = req.params;
        const {
            name,
            category,
            serial_number,
            quantity,
            unit,
            location,
            status,
            remark
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'error', error: 'name is required' });
        }
        if (!category || !category.trim()) {
            return res.status(400).json({ message: 'error', error: 'category is required' });
        }

        const parsedQty = parseInt(quantity, 10);
        const qty = isNaN(parsedQty) ? 1 : parsedQty;

        const sql = `UPDATE stocks SET
            name = ?,
            category = ?,
            serial_number = ?,
            quantity = ?,
            unit = ?,
            location = ?,
            status = ?,
            remark = ?
            WHERE id = ?`;

        const [result] = await database.query(sql, [
            name.trim(),
            category.trim(),
            serial_number ? serial_number.trim() : null,
            qty,
            unit ? unit.trim() : 'เครื่อง',
            location ? location.trim() : null,
            status ? status.trim() : 'พร้อมใช้งาน',
            remark ? remark.trim() : null,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Stock record not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error updating stock record:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 4. DELETE STOCK RECORD
export async function deleteStock(req, res) {
    try {
        const { id } = req.params;
        const [result] = await database.query('DELETE FROM stocks WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Stock record not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error deleting stock record:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 5. GET DISTINCT CATEGORIES
export async function getStockCategories(req, res) {
    try {
        const sql = `SELECT DISTINCT category FROM stocks WHERE category IS NOT NULL AND category != '' ORDER BY category ASC`;
        const [rows] = await database.query(sql);
        const categories = rows.map(r => r.category);
        res.json({
            message: 'success',
            data: categories
        });
    } catch (error) {
        console.error('Error fetching stock categories:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}
