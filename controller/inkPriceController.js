import database from '../service/database.js';

// Helper to safely parse numeric prices
function parsePrice(val) {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
}

// 1. GET ALL INK PRICES (with pagination & search)
export async function getInkPrices(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search } = req.query;
        const offset = (Number(page) - 1) * Number(itemsPerPage);
        const limit = Number(itemsPerPage) || 10;

        let sql = `SELECT * FROM ink_prices WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM ink_prices WHERE 1=1`;
        let params = [];

        if (search) {
            const term = `%${search}%`;
            const searchCond = ` AND (model_name LIKE ? OR description LIKE ?)`;
            sql += searchCond;
            countSql += searchCond;
            params.push(term, term);
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
        console.error('Error fetching ink prices:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 2. CREATE INK PRICE
export async function createInkPrice(req, res) {
    try {
        const {
            model_name,
            description,
            price_sis,
            price_vst,
            price_synnex,
            price_bcom,
            price_metro,
            price_advice,
            price_svoa
        } = req.body;

        if (!model_name || !model_name.trim()) {
            return res.status(400).json({ message: 'error', error: 'model_name is required' });
        }

        const sql = `INSERT INTO ink_prices 
            (model_name, description, price_sis, price_vst, price_synnex, price_bcom, price_metro, price_advice, price_svoa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const [result] = await database.query(sql, [
            model_name.trim(),
            description || null,
            parsePrice(price_sis),
            parsePrice(price_vst),
            parsePrice(price_synnex),
            parsePrice(price_bcom),
            parsePrice(price_metro),
            parsePrice(price_advice),
            parsePrice(price_svoa)
        ]);

        res.status(201).json({
            message: 'success',
            id: result.insertId
        });
    } catch (error) {
        console.error('Error creating ink price:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 3. UPDATE INK PRICE
export async function updateInkPrice(req, res) {
    try {
        const { id } = req.params;
        const {
            model_name,
            description,
            price_sis,
            price_vst,
            price_synnex,
            price_bcom,
            price_metro,
            price_advice,
            price_svoa
        } = req.body;

        if (!model_name || !model_name.trim()) {
            return res.status(400).json({ message: 'error', error: 'model_name is required' });
        }

        const sql = `UPDATE ink_prices SET
            model_name = ?,
            description = ?,
            price_sis = ?,
            price_vst = ?,
            price_synnex = ?,
            price_bcom = ?,
            price_metro = ?,
            price_advice = ?,
            price_svoa = ?
            WHERE id = ?`;

        const [result] = await database.query(sql, [
            model_name.trim(),
            description || null,
            parsePrice(price_sis),
            parsePrice(price_vst),
            parsePrice(price_synnex),
            parsePrice(price_bcom),
            parsePrice(price_metro),
            parsePrice(price_advice),
            parsePrice(price_svoa),
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Ink model not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error updating ink price:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}

// 4. DELETE INK PRICE
export async function deleteInkPrice(req, res) {
    try {
        const { id } = req.params;
        const [result] = await database.query('DELETE FROM ink_prices WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'error', error: 'Ink model not found' });
        }

        res.json({ message: 'success' });
    } catch (error) {
        console.error('Error deleting ink price:', error);
        res.status(500).json({ message: 'error', error: 'Internal server error' });
    }
}
