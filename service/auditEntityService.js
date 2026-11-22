import { createHash } from 'node:crypto';
import database from './database.js';

const definitions = {
    quotation: {
        table: 'documents', key: 'id', name: 'customer_name', status: 'current_status',
        fields: {
            current_status: 'สถานะเอกสาร', borrow_status: 'สถานะใบยืม', quotation_id: 'เลขใบเสนอราคา',
            delivery_note_no: 'เลขใบส่งของ', receipt_no: 'เลขใบเสร็จ', customer_name: 'ลูกค้า',
            is_borrow: 'ประเภทใบยืม', issue_date_str: 'วันที่เอกสาร', delivery_date_str: 'วันที่ส่งของ',
            item_group_name: 'ชื่อกลุ่มรายการรวม',
            due_date_str: 'วันครบกำหนด', payment_term: 'เครดิต', payment_method: 'วิธีชำระเงิน',
        },
        groups: {
            'ข้อมูลติดต่อและจัดส่ง': ['contact_person', 'customer_phone', 'customer_address', 'customer_tax_id', 'delivery_address'],
            'รายละเอียดเอกสารและการชำระเงิน': ['remark', 'salesman', 'offerer_name', 'receiver_name', 'sender_name', 'delivery_authorized_signer', 'receipt_authorized_signer', 'cheque_bank', 'cheque_branch', 'cheque_no', 'cheque_amount', 'money_receiver_name', 'receipt_issue_date_str'],
            'เงื่อนไขและวันที่เอกสาร': ['issue_date', 'delivery_date', 'due_date', 'price_validity_days', 'valid_until', 'valid_until_str', 'received_date', 'received_date_str', 'sent_date', 'sent_date_str', 'receipt_issue_date', 'cheque_date', 'cheque_date_str', 'goods_received_check_date', 'goods_received_check_date_str', 'money_receive_date', 'money_receive_date_str', 'delivery_copy_date', 'delivery_copy_date_str', 'receipt_copy_date', 'receipt_copy_date_str', 'include_offerer_signature', 'from_borrow_id', 'from_borrow_no'],
        },
    },
    caseRepair: {
        table: 'caseRepair', key: 'caseId', name: 'customer_name', status: 'caseStatus',
        fields: { caseStatus: 'สถานะงานซ่อม', customer_name: 'ลูกค้า', caseInstitution: 'หน่วยงาน', caseType: 'ประเภทงาน', caseBrand: 'ยี่ห้อ', caseModel: 'รุ่น', caseSN: 'หมายเลขเครื่อง', repairCost: 'ต้นทุนซ่อม', repairPrice: 'ราคาซ่อม', staffName: 'ผู้รับผิดชอบ', datePickUp: 'วันนัดรับ', dateComplete: 'วันซ่อมเสร็จ', dateDelivered: 'วันส่งมอบ', refSentRepairId: 'เลขงานส่งซ่อม' },
        groups: { 'รายละเอียดงานซ่อม': ['brokenSymptom', 'repairDetails', 'caseEquipment', 'caseDurableArticles', 'dateBeforePicUp'], 'ข้อมูลติดต่อ': ['cusPhone'] },
    },
    caseSentRepair: {
        table: 'caseSentRepair', key: 'caseSId', name: 'caseSCusName', status: 'sentRepairStatus',
        fields: { sentRepairStatus: 'สถานะส่งซ่อม', caseSCusName: 'ลูกค้า', caseSToMechanic: 'ร้านหรือช่างที่รับซ่อม', caseSOrderNo: 'เลขงานร้านซ่อม', DateSOfSent: 'วันที่ส่งซ่อม', dateOfReceived: 'วันที่รับคืน', caseSRecipient: 'ผู้รับคืน', caseSBrand: 'ยี่ห้อ', caseSModel: 'รุ่น', caseSSN: 'หมายเลขเครื่อง' },
        groups: { 'รายละเอียดส่งซ่อม': ['brokenSymptom', 'caseSEquipment', 'caseSType'] },
    },
    project: {
        table: 'caseProject', key: 'pId', status: 'pStatus',
        fields: { pStatus: 'สถานะงานติดตั้ง', dateCreate: 'วันเริ่มงาน', dateComplete: 'วันเสร็จงาน' },
        groups: { 'รายละเอียดงานติดตั้ง': ['pAddress', 'pDetail'], 'รูปประกอบงาน': ['pImage'] },
    },
    customer: {
        table: 'customers', key: 'id', name: 'customer_name', fields: { customer_name: 'ชื่อลูกค้า' },
        groups: { 'ข้อมูลติดต่อและภาษี': ['customer_phone', 'customer_address', 'customer_tax_id'] },
    },
    stock: {
        table: 'stocks', key: 'id', name: 'name', status: 'status',
        fields: { name: 'ชื่อสินค้า', category: 'หมวดหมู่', serial_number: 'หมายเลขเครื่อง', quantity: 'จำนวน', unit: 'หน่วย', location: 'ที่เก็บ', status: 'สถานะสินค้า' },
        groups: { 'หมายเหตุสินค้า': ['remark'] },
    },
    ink_price: {
        table: 'ink_prices', key: 'id', name: 'model_name',
        fields: { model_name: 'รุ่นหมึก', price_sis: 'ราคา SIS', price_vst: 'ราคา VST', price_synnex: 'ราคา Synnex', price_bcom: 'ราคา BCOM', price_metro: 'ราคา Metro', price_advice: 'ราคา Advice', price_svoa: 'ราคา SVOA' },
        groups: { 'รายละเอียดหมึก': ['description'] },
    },
    template: { table: 'quotation_templates', key: 'id', name: 'name', fields: { name: 'ชื่อแบบฟอร์ม' } },
    product_description: { table: 'product_descriptions', key: 'id', name: 'description', fields: { description: 'ข้อความสินค้า', category: 'หมวดหมู่' } },
    order_note: {
        table: 'order_notes', key: 'id', name: 'department',
        fields: { department: 'หน่วยงาน', quotation_id: 'เอกสารที่เกี่ยวข้อง' },
        groups: { 'รายการสั่งซื้อ': ['body'] },
    },
    shared_note: {
        table: 'shared_notes', key: 'id', name: 'created_by_name',
        fields: { created_by_name: 'ผู้จดโน้ต', attachment_count: 'จำนวนไฟล์แนบ' },
        groups: { 'ข้อความโน้ต': ['body'], 'ไฟล์แนบ': ['attachment_ids'] },
    },
};

function normalize(value, field) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (/^(price_|repairCost$|repairPrice$|quantity$|is_borrow$)/.test(field)) return Number(value);
    return typeof value === 'string' ? value.trim() || null : value;
}

function signature(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function makeAuditSnapshot(entityType, row, items) {
    const definition = definitions[entityType];
    if (!definition || !row) return null;
    const record = { ...row };
    if (entityType === 'caseRepair') record.customer_name = [row.cusFirstName, row.cusLastName].filter(Boolean).join(' ');
    if (entityType === 'caseSentRepair') record.sentRepairStatus = row.dateOfReceived ? 'รับคืนแล้ว' : 'ส่งซ่อมอยู่';
    const fields = Object.fromEntries(Object.keys(definition.fields).map(key => [key, normalize(record[key], key)]));
    const groups = Object.fromEntries(Object.entries(definition.groups || {}).map(([label, keys]) => [label, signature(keys.map(key => normalize(record[key], key)))]));
    if (items) {
        const normalizedItems = items.map(item => [item.section_name || '', item.description || '', normalize(item.quantity, 'quantity'), item.unit || '', normalize(item.unit_price, 'price_'), Number(item.is_sub_item || 0), Number(item.is_desc_only || 0), item.order_source || '']);
        groups['รายการสินค้า'] = signature(normalizedItems);
        fields.item_count = items.filter(item => !Object.hasOwn(item, 'item_id') || item.item_id !== null).length;
        fields.total = Math.round(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0) * 100) / 100;
    }
    return { entityType, entityId: String(row[definition.key]), name: normalize(record[definition.name]), fields, groups };
}

export async function readAuditSnapshot(entityType, id, connection = database) {
    const definition = definitions[entityType];
    if (!definition || id === null || id === undefined || id === '') return null;
    const [rows] = await connection.query(`SELECT * FROM ${definition.table} WHERE ${definition.key} = ?`, [id]);
    if (!rows.length) return null;
    let items;
    if (entityType === 'quotation') {
        [items] = await connection.query(`SELECT di.id AS item_id, ds.section_name, di.description, di.quantity, di.unit, di.unit_price, di.is_sub_item, di.is_desc_only, di.order_source
            FROM document_sections ds LEFT JOIN document_items di ON di.section_id = ds.id
            WHERE ds.document_id = ? ORDER BY ds.sort_order, di.sort_order`, [id]);
    } else if (entityType === 'template') {
        [items] = await connection.query('SELECT * FROM quotation_template_items WHERE template_id = ? ORDER BY sort_order', [id]);
    }
    return makeAuditSnapshot(entityType, rows[0], items);
}

export function auditChanges(before, after) {
    if (!before || !after) return [];
    const labels = { ...definitions[after.entityType]?.fields, item_count: 'จำนวนรายการสินค้า', total: 'ยอดรวมก่อนภาษี' };
    const changes = Object.keys(labels).filter(field => before.fields[field] !== after.fields[field]).map(field => ({ field, label: labels[field], before: before.fields[field] ?? null, after: after.fields[field] ?? null }));
    for (const [label, digest] of Object.entries(after.groups)) {
        if (before.groups[label] !== digest) changes.push({ field: 'details', label, summary: `แก้ไข${label}` });
    }
    return changes;
}

export function publicAuditSnapshot(snapshot) {
    return snapshot ? { ...snapshot.fields, entityId: snapshot.entityId, name: snapshot.name } : null;
}

export async function resolveAuditId(config, req, responseBody) {
    const id = config.entityIdResolver?.({ req, responseBody });
    if (id !== null && id !== undefined && id !== '') return id;
    if (config.entityType === 'order_note') {
        const quotationId = req.params?.quotationId || req.body?.quotation_id;
        if (quotationId) {
            const [rows] = await database.query('SELECT id FROM order_notes WHERE quotation_id = ? LIMIT 1', [quotationId]);
            return rows[0]?.id ?? null;
        }
    }
    return null;
}

// Linked status changes belong to the same business event, not a second noisy log.
export async function readRelatedAuditSnapshots(config, req, before) {
    if (config.entityType === 'caseSentRepair') {
        let ids = req.body?.refCaseId ? [req.body.refCaseId] : [];
        if (req.body?.caseSId) {
            const [rows] = await database.query('SELECT caseId FROM caseRepair WHERE refSentRepairId = ?', [req.body.caseSId]);
            ids = [...new Set([...ids, ...rows.map(row => row.caseId)])];
        }
        return (await Promise.all(ids.map(id => readAuditSnapshot('caseRepair', id)))).filter(Boolean);
    }
    if (config.entityType === 'order_note' && before?.fields.quotation_id) {
        const snapshot = await readAuditSnapshot('quotation', before.fields.quotation_id);
        return snapshot ? [snapshot] : [];
    }
    return [];
}
