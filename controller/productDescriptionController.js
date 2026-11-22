import database from '../service/database.js';
import { normalizeProductDescription, productDescriptionFilters, productDescriptionId } from '../service/productDescriptions.js';

const columns = 'id, description, category, created_at, updated_at';
const invalid = (res, error) => res.status(400).json({ message: 'error', detail: error.message });
function failed(res, error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'error', detail: 'มีข้อความสินค้านี้อยู่แล้ว' });
    console.error('Product description request failed:', error.message);
    return res.status(500).json({ message: 'error', detail: 'ดำเนินการกับข้อความสินค้าไม่สำเร็จ กรุณาลองใหม่' });
}

export async function listProductDescriptions(req, res) {
    let filters;
    try { filters = productDescriptionFilters(req.query); } catch (error) { return invalid(res, error); }
    try {
        const { where, params, page, limit, offset } = filters;
        const [[items], [counts], [categories]] = await Promise.all([
            database.query(`SELECT ${columns} FROM product_descriptions ${where} ORDER BY category, description, id LIMIT ? OFFSET ?`, [...params, limit, offset]),
            database.query(`SELECT COUNT(*) AS total FROM product_descriptions ${where}`, params),
            database.query('SELECT DISTINCT category FROM product_descriptions ORDER BY category'),
        ]);
        res.set('Cache-Control', 'no-store').json({ items, total: Number(counts[0].total), page, limit, totalPages: Math.ceil(Number(counts[0].total) / limit), categories: categories.map(row => row.category) });
    } catch (error) { failed(res, error); }
}

export async function suggestProductDescriptions(req, res) {
    let filters;
    try { filters = productDescriptionFilters(req.query, true); } catch (error) { return invalid(res, error); }
    if (filters.search.length < 2 || !filters.tokens.length) return res.json({ items: [] });
    try {
        const [items] = await database.query(`SELECT id, description, category FROM product_descriptions ${filters.where}
            ORDER BY CHAR_LENGTH(description), description, id LIMIT ?`, [...filters.params, filters.limit]);
        res.set('Cache-Control', 'no-store').json({ items });
    } catch (error) { failed(res, error); }
}

export async function createProductDescription(req, res) {
    let row;
    try { row = normalizeProductDescription(req.body); } catch (error) { return invalid(res, error); }
    try {
        const [result] = await database.query('INSERT INTO product_descriptions (description, category, fingerprint, search_text) VALUES (?, ?, ?, ?)', [row.description, row.category, row.fingerprint, row.searchText]);
        res.status(201).json({ message: 'success', id: result.insertId });
    } catch (error) { failed(res, error); }
}

export async function updateProductDescription(req, res) {
    let row, id;
    try { row = normalizeProductDescription(req.body); id = productDescriptionId(req.params.id); } catch (error) { return invalid(res, error); }
    try {
        const [result] = await database.query('UPDATE product_descriptions SET description = ?, category = ?, fingerprint = ?, search_text = ? WHERE id = ?', [row.description, row.category, row.fingerprint, row.searchText, id]);
        if (!result.affectedRows) return res.status(404).json({ message: 'error', detail: 'ไม่พบข้อความสินค้านี้แล้ว' });
        res.json({ message: 'success', id });
    } catch (error) { failed(res, error); }
}

export async function deleteProductDescription(req, res) {
    let id;
    try { id = productDescriptionId(req.params.id); } catch (error) { return invalid(res, error); }
    try {
        const [result] = await database.query('DELETE FROM product_descriptions WHERE id = ?', [id]);
        if (!result.affectedRows) return res.status(404).json({ message: 'error', detail: 'ไม่พบข้อความสินค้านี้แล้ว' });
        res.json({ message: 'success', id });
    } catch (error) { failed(res, error); }
}
