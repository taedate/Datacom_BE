import { createHash } from 'node:crypto';

export const repairFields = [
    'cusFirstName', 'cusLastName', 'cusPhone', 'caseInstitution', 'brokenSymptom', 'caseType', 'caseStatus',
    'caseBrand', 'caseModel', 'caseSN', 'caseDurableArticles', 'caseEquipment', 'repairDetails', 'repairCost', 'repairPrice',
    'datePickUp', 'dateBeforePicUp', 'dateComplete', 'dateDelivered', 'staffName',
];

export function repairRevision(row) {
    const fields = ['caseId', ...repairFields, 'refSentRepairId', 'updated_at'];
    return createHash('sha256').update(JSON.stringify(fields.map(key => {
        const value = row[key];
        return value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString() : null) : value ?? null;
    }))).digest('hex');
}

export function repairResponse(row) {
    let repairItems = [];
    if (row.repairDetails) {
        try { const value = JSON.parse(row.repairDetails); if (Array.isArray(value)) repairItems = value; }
        catch { repairItems = [{ description: row.repairDetails, cost: row.repairCost, price: row.repairPrice }]; }
    }
    return { ...row, repairItems, revision: repairRevision(row) };
}

export function mergeRepairInput(body, current = {}) {
    const values = { ...current };
    for (const field of repairFields) if (Object.hasOwn(body, field)) values[field] = body[field];
    if (Object.hasOwn(body, 'repairItems')) {
        if (!Array.isArray(body.repairItems) || body.repairItems.length > 200) throw new Error('รายการซ่อมไม่ถูกต้อง');
        values.repairDetails = JSON.stringify(body.repairItems);
    } else if (typeof values.repairDetails === 'object' && values.repairDetails !== null) {
        values.repairDetails = JSON.stringify(values.repairDetails);
    }
    for (const field of ['cusFirstName', 'caseType', 'caseStatus', 'brokenSymptom', 'datePickUp']) {
        if (typeof values[field] !== 'string' || !values[field].trim()) throw new Error('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
    }
    for (const field of repairFields) {
        if (field === 'repairCost' || field === 'repairPrice') {
            const value = values[field];
            if (value === undefined || value === null || value === '') values[field] = null;
            else if (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > 99999999.99) throw new Error('จำนวนเงินไม่ถูกต้อง');
            else values[field] = Number(value);
        } else if (['dateBeforePicUp', 'dateComplete', 'dateDelivered'].includes(field)) {
            values[field] = values[field] || null;
            if (values[field] !== null && (typeof values[field] !== 'string' || values[field].length > (field === 'dateBeforePicUp' ? 50 : 255))) throw new Error('วันที่ไม่ถูกต้อง');
        } else {
            values[field] = values[field] ?? '';
            const limit = ['cusPhone', 'datePickUp'].includes(field) ? 50 : 255;
            if (typeof values[field] !== 'string' || (field !== 'repairDetails' && values[field].length > limit)) throw new Error('ข้อมูลข้อความไม่ถูกต้องหรือยาวเกินกำหนด');
        }
    }
    if (Buffer.byteLength(values.repairDetails, 'utf8') > 65535) throw new Error('รายละเอียดงานซ่อมยาวเกินกำหนด กรุณาลดข้อความก่อนบันทึก');
    return values;
}
