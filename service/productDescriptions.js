import { createHash } from 'node:crypto';

export function descriptionSearchText(value) {
    return String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function normalizeProductDescription(body = {}) {
    if (typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 2000) {
        throw new Error('กรุณาระบุรายละเอียดสินค้าไม่เกิน 2,000 ตัวอักษร');
    }
    if (body.category !== undefined && (typeof body.category !== 'string' || body.category.trim().length > 100)) {
        throw new Error('กรุณาระบุหมวดหมู่ไม่เกิน 100 ตัวอักษร');
    }
    const description = body.description.trim().replace(/\r\n?/g, '\n');
    const category = body.category?.trim() || 'อื่นๆ';
    const fingerprint = createHash('sha256').update(description.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()).digest('hex');
    return { description, category, fingerprint, searchText: descriptionSearchText(description) };
}

export function productDescriptionFilters(query = {}, suggestions = false) {
    const search = query.search ?? query.q ?? '';
    const category = query.category ?? '';
    if (typeof search !== 'string' || search.length > 200 || typeof category !== 'string' || category.length > 100) throw new Error('ตัวกรองไม่ถูกต้อง');
    const page = Number(query.page ?? 1), limit = Number(query.limit ?? (suggestions ? 8 : 20));
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > (suggestions ? 12 : 100)) throw new Error('จำนวนรายการหรือหน้าไม่ถูกต้อง');
    const tokens = search.trim().split(/\s+/).filter(Boolean).map(descriptionSearchText).filter(Boolean).slice(0, 8);
    const clauses = tokens.map(() => 'search_text LIKE ?');
    const params = tokens.map(token => `%${token}%`);
    if (category.trim()) { clauses.push('category = ?'); params.push(category.trim()); }
    return { page, limit, offset: (page - 1) * limit, search: search.trim(), tokens, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function productDescriptionId(value) {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('รหัสรายการไม่ถูกต้อง');
    return Number(value);
}
