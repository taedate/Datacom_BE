import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import { AUDIT_ACTIONS, AUDIT_MODULES, AUDIT_ENTITY_TYPES } from '../service/auditLogCatalog.js';

async function setup(records = {}) {
    const logs = [];
    const tables = structuredClone(records);
    const database = { async query(sql, params = []) {
        if (sql.includes('information_schema.COLUMNS')) return [[...['performedBy', 'action', 'module', 'entityType', 'entityId', 'status', 'severity', 'detail', 'createdAt'].map(COLUMN_NAME => ({ COLUMN_NAME }))]];
        if (sql.startsWith('INSERT INTO audit_logs')) {
            const fields = sql.match(/audit_logs \((.*?)\)/)[1].split(', ');
            const log = Object.fromEntries(fields.map((field, index) => [field, params[index]]));
            log.detail = JSON.parse(log.detail);
            logs.push(log);
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('FROM document_sections ds LEFT JOIN document_items')) return [tables.items || []];
        if (sql.includes('FROM quotation_template_items')) return [tables.templateItems || []];
        if (sql.startsWith('SELECT caseId FROM caseRepair')) return [(tables.caseRepair || []).filter(row => row.refSentRepairId === params[0])];
        if (sql.startsWith('SELECT id FROM order_notes')) return [(tables.order_notes || []).filter(row => row.quotation_id === params[0])];
        const match = sql.match(/SELECT \* FROM (\w+) WHERE (\w+) = \?/);
        if (match) return [structuredClone((tables[match[1]] || []).filter(row => String(row[match[2]]) === String(params[0])))];
        throw new Error(`Unexpected query: ${sql}`);
    } };
    const context = vm.createContext({ console: { error() {} } });
    const cache = new Map();
    const dbModule = new vm.SyntheticModule(['default'], function () { this.setExport('default', database); }, { context });
    const cryptoModule = new vm.SyntheticModule(Object.keys(crypto), function () { for (const [key, value] of Object.entries(crypto)) this.setExport(key, value); }, { context });
    async function load(url) {
        if (cache.has(url.href)) return cache.get(url.href);
        const module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
        cache.set(url.href, module);
        return module;
    }
    const module = await load(new URL('../middleware/auditTrail.js', import.meta.url));
    await module.link((specifier, parent) => specifier === 'node:crypto' ? cryptoModule : specifier.endsWith('/database.js') ? dbModule : load(new URL(specifier, parent.identifier)));
    await module.evaluate();
    async function run(config, mutate, { body = {}, response = { message: 'success' }, status = 200, id = 'QT-1410', url = '/quotation/QT-1410', method = 'PUT' } = {}) {
        const req = { params: { id }, body, method, originalUrl: url, headers: {}, user: { userId: 7, userName: 'พนักงานทดสอบ' } };
        const res = { statusCode: status, locals: {}, json(value) { this.body = value; return this; } };
        await module.namespace.auditEvent({ module: 'quotation', entityType: 'quotation', successAction: 'QUOTATION_UPDATED', entityIdResolver: ({ req, responseBody }) => req.params.id || responseBody?.id, ...config })(req, res, () => { mutate?.(tables, res); res.json(response); });
        await res.locals.auditPromise;
        assert.equal(res.body, response);
        return { req, res };
    }
    return { logs, tables, run };
}

const delivery = { id: 'QT-1410', current_status: 'DELIVERY_NOTE', delivery_note_no: 'IV6911085', quotation_id: 'DATA69-1101/2026', is_borrow: 0, customer_name: 'ลูกค้าทดสอบ' };

test('preparing a repair PDF records one event even when the saved record is unchanged', async () => {
    const { logs, run } = await setup({ caseRepair: [{ caseId: 'PC-100', caseStatus: 'รับเครื่องแล้ว', brokenSymptom: 'เปิดไม่ติด' }] });
    await run({ module: 'repair', entityType: 'caseRepair', successAction: 'CASE_PRINT_PREPARED' }, undefined,
        { id: 'PC-100', url: '/prepare-case-print', method: 'POST', body: { caseId: 'PC-100' } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'CASE_PRINT_PREPARED');
    assert.equal(logs[0].entityId, 'PC-100');
    assert.deepEqual(logs[0].detail.changes, []);
});

test('records the old and new status and bill number in one event without private contact data', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery, customer_phone: '0891234567', customer_address: 'private-address', password: 'never-log-this' }] });
    await run({}, tables => Object.assign(tables.documents[0], { current_status: 'QUOTATION', delivery_note_no: '' }));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'QUOTATION_STATUS_CHANGED');
    assert.equal(logs[0].detail.before.delivery_note_no, 'IV6911085');
    assert.equal(logs[0].detail.after.delivery_note_no, null);
    assert.ok(logs[0].detail.changes.some(change => change.field === 'current_status' && change.before === 'DELIVERY_NOTE' && change.after === 'QUOTATION'));
    assert.equal(logs[0].performedBy, 7);
    assert.equal(logs[0].detail.actorName, 'พนักงานทดสอบ');
    assert.doesNotMatch(JSON.stringify(logs), /0891234567|private-address|never-log-this/);
});

test('saving unchanged data or only a timestamp does not add a noisy event', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery }] });
    await run({}, tables => { tables.documents[0].updated_at = '2026-11-19'; });
    assert.equal(logs.length, 0);
});

test('transaction snapshots take precedence over reads made before the row lock', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery }] });
    await run({}, (tables, res) => {
        res.locals.auditSnapshots = {
            before: { entityType: 'quotation', entityId: delivery.id, name: null, fields: { ...delivery, current_status: 'RECEIPT' }, groups: {} },
            after: { entityType: 'quotation', entityId: delivery.id, name: null, fields: { ...delivery, current_status: 'DELIVERY_NOTE' }, groups: {} },
        };
    });
    assert.equal(logs[0].detail.before.current_status, 'RECEIPT');
    assert.equal(logs[0].detail.after.current_status, 'DELIVERY_NOTE');
});

test('failed saves record the attempt without claiming it changed the document', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery }] });
    await run({}, null, { status: 409, body: { current_status: 'QUOTATION' }, response: { message: 'กรุณาโหลดข้อมูลล่าสุด' } });
    assert.equal(logs[0].status, 'fail');
    assert.equal(logs[0].detail.after, null);
    assert.deepEqual(logs[0].detail.changes, []);
    assert.equal(logs[0].detail.attempted_status, 'QUOTATION');
    assert.equal(logs[0].detail.before.current_status, 'DELIVERY_NOTE');
});

test('stock edits keep their business action instead of becoming API_EXCEPTION', async () => {
    const { logs, run } = await setup({ stocks: [{ id: '1', name: 'เครื่องทดสอบ', quantity: 1 }] });
    await run({ module: 'stock', entityType: 'stock', successAction: 'STOCK_UPDATED' }, tables => { tables.stocks[0].quantity = 2; }, { id: '1' });
    assert.equal(logs[0].module, 'stock');
    assert.equal(logs[0].entityType, 'stock');
    assert.equal(logs[0].action, 'STOCK_UPDATED');
    assert.ok(logs[0].detail.changes.some(change => change.field === 'quantity' && change.after === 2));
});

test('editing an item description at the same price records a summary instead of the item body', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery }], items: [{ description: 'old-item', quantity: '1', unit_price: '100' }] });
    await run({}, tables => { tables.items[0].description = 'new-private-item-description'; });
    assert.equal(logs.length, 1);
    assert.ok(logs[0].detail.changes.some(change => change.summary === 'แก้ไขรายการสินค้า'));
    assert.doesNotMatch(JSON.stringify(logs), /old-item|new-private-item-description/);
});

test('shared note creation, editing and deletion record concise business events', async () => {
    const { logs, run } = await setup({ shared_notes: [] });
    const config = { module: 'shared_note', entityType: 'shared_note' };
    await run({ ...config, successAction: 'SHARED_NOTE_CREATED' }, tables => {
        tables.shared_notes.push({ id: 1, created_by_name: 'ผู้จด', body: 'private-note-before' });
    }, { id: '1', method: 'POST', url: '/shared-notes' });
    await run({ ...config, successAction: 'SHARED_NOTE_UPDATED' }, tables => {
        tables.shared_notes[0].body = 'private-note-after';
    }, { id: '1', url: '/shared-notes/1' });
    await run({ ...config, successAction: 'SHARED_NOTE_DELETED' }, tables => {
        tables.shared_notes = [];
    }, { id: '1', method: 'DELETE', url: '/shared-notes/1' });
    assert.deepEqual(logs.map(log => log.action), ['SHARED_NOTE_CREATED', 'SHARED_NOTE_UPDATED', 'SHARED_NOTE_DELETED']);
    assert.equal(logs[1].detail.changes[0].summary, 'แก้ไขข้อความโน้ต');
    assert.equal(logs[2].detail.before.created_by_name, 'ผู้จด');
    assert.doesNotMatch(JSON.stringify(logs), /private-note-before|private-note-after/);
});

test('replacing an attachment records an event even when its count and note text stay the same',async()=>{
    const {logs,run}=await setup({shared_notes:[{id:1,created_by_name:'ผู้จด',body:'ข้อความเดิม',attachment_count:1,attachment_ids:['old-file']}]});
    await run({module:'shared_note',entityType:'shared_note',successAction:'SHARED_NOTE_UPDATED'},tables=>{tables.shared_notes[0].attachment_ids=['new-file'];},{id:'1',url:'/shared-notes/1'});
    assert.equal(logs.length,1);assert.equal(logs[0].detail.changes[0].summary,'แก้ไขไฟล์แนบ');
    assert.doesNotMatch(JSON.stringify(logs),/old-file|new-file/);
});

test('deleting a document retains its last bill number for later investigation', async () => {
    const { logs, run } = await setup({ documents: [{ ...delivery }] });
    await run({ successAction: 'QUOTATION_DELETED' }, tables => { tables.documents = []; }, { method: 'DELETE' });
    assert.equal(logs[0].action, 'QUOTATION_DELETED');
    assert.equal(logs[0].detail.before.delivery_note_no, 'IV6911085');
    assert.equal(logs[0].detail.after, null);
});

test('creating a borrow slip is classified as a borrow event', async () => {
    const { logs, run } = await setup();
    await run({ successAction: 'QUOTATION_CREATED' }, tables => { tables.documents = [{ ...delivery, id: 'BR-070', is_borrow: 1, borrow_status: 'BORROWED' }]; }, { id: 'BR-070', method: 'POST' });
    assert.equal(logs[0].action, 'BORROW_CREATED');
    assert.equal(logs[0].detail.after.borrow_status, 'BORROWED');
});

test('a linked repair status change is included in the same sent-repair event', async () => {
    const { logs, run } = await setup({ caseSentRepair: [{ caseSId: 'SR-001', dateOfReceived: null }], caseRepair: [{ caseId: 'PC-001', caseStatus: 'ส่งซ่อมอยู่', refSentRepairId: 'SR-001' }] });
    await run({ module: 'sentRepair', entityType: 'caseSentRepair', successAction: 'SENT_REPAIR_UPDATED' }, tables => { tables.caseSentRepair[0].dateOfReceived = '2026-11-19'; tables.caseRepair[0].caseStatus = 'ซ่อมเสร็จ'; }, { id: 'SR-001', body: { caseSId: 'SR-001' } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'SENT_REPAIR_RECEIVED');
    assert.equal(logs[0].detail.related[0].entityId, 'PC-001');
    assert.ok(logs[0].detail.related[0].changes.some(change => change.after === 'ซ่อมเสร็จ'));
});

test('removing an order note that does not exist does not create an event', async () => {
    const { logs, run } = await setup();
    await run({ module: 'order_note', entityType: 'order_note', successAction: 'ORDER_NOTE_DELETED' }, null, { response: { deletedCount: 0 } });
    assert.equal(logs.length, 0);
});

test('query secrets are excluded from the stored route', async () => {
    const { logs, run } = await setup();
    await run({ module: 'invite', entityType: 'invite', successAction: 'INVITE_REVOKED' }, null, { url: '/invites/1/revoke?token=never-store-token' });
    assert.equal(logs[0].detail.route, '/invites/1/revoke');
    assert.doesNotMatch(JSON.stringify(logs), /never-store-token/);
});

test('all literal route audit actions, modules and entities are recognized by the catalog', async () => {
    for (const file of ['customer', 'stock', 'inkPrice', 'repair', 'sentRepair', 'project', 'quotation', 'invite', 'member', 'orderNote', 'template']) {
        const source = await readFile(new URL(`../router/${file}Router.js`, import.meta.url), 'utf8');
        for (const [, action] of source.matchAll(/(?:successAction|failAction):\s*['"]([^'"]+)['"]/g)) assert.ok(AUDIT_ACTIONS.has(action), action);
        for (const [, module] of source.matchAll(/module:\s*['"]([^'"]+)['"]/g)) assert.ok(AUDIT_MODULES.has(module), module);
        for (const [, entity] of source.matchAll(/entityType:\s*['"]([^'"]+)['"]/g)) assert.ok(AUDIT_ENTITY_TYPES.has(entity), entity);
    }
});
