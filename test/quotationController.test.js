import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as crypto from 'node:crypto';

async function setup(initial = [{ id: 'QT-1410', current_status: 'DELIVERY_NOTE', delivery_note_no: 'IV6911001', is_borrow: 0 }], initialSections = []) {
    const state = { documents: structuredClone(initial), sections: structuredClone(initialSections), queries: [], commits: 0, rollbacks: 0, released: false };
    let snapshot;
    const conn = {
        async beginTransaction() { snapshot = structuredClone({ documents: state.documents, sections: state.sections }); },
        async commit() { state.commits++; },
        async rollback() { state.rollbacks++; state.documents = snapshot.documents; state.sections = snapshot.sections; },
        release() { state.released = true; },
        async query(sql, params = []) {
            const query = sql.replace(/\s+/g, ' ').trim();
            state.queries.push(query);
            if (state.failOrderNotes && query.includes('order_notes')) throw new Error('Order note failure');
            if (query.startsWith('SELECT id FROM documents WHERE id LIKE')) {
                return [[...state.documents].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 1)];
            }
            if (query.startsWith('SELECT') && query.includes('FROM documents WHERE id = ?')) {
                return [state.documents.filter(doc => doc.id === params[0]).map(doc => ({ ...doc }))];
            }
            if (query.startsWith('INSERT INTO documents')) {
                assert.equal((query.match(/\?/g) || []).length, params.length, 'document insert placeholders');
                const columns = query.match(/documents \((.*?)\) VALUES/)[1].split(',').map(column => column.trim());
                state.documents.push(Object.fromEntries(columns.map((column, index) => [column, params[index]])));
                return [{ affectedRows: 1 }];
            }
            if (query.startsWith('UPDATE documents SET')) {
                assert.equal((query.match(/\?/g) || []).length, params.length, 'document update placeholders');
                const doc = state.documents.find(doc => doc.id === params.at(-1));
                const assignments = query.match(/SET (.*?) WHERE id = \?/)[1].split(',');
                assignments.forEach((assignment, index) => { doc[assignment.split('=')[0].trim()] = params[index]; });
                return [{ affectedRows: 1 }];
            }
            if (query.startsWith('INSERT INTO document_sections')) {
                const insertId = 200;
                state.sections.push(...params[0].map(([document_id, section_name, sort_order], index) => ({ id: insertId + index, document_id, section_name, sort_order })));
                return [{ insertId }];
            }
            if (query.startsWith('DELETE FROM document_sections')) { state.sections = state.sections.filter(section => section.document_id !== params[0]); return [{ affectedRows: 0 }]; }
            if (query.startsWith('DELETE FROM')) return [{ affectedRows: 0 }];
            if (query.includes('FROM document_sections ds LEFT JOIN document_items')) return [state.sections.filter(section => section.document_id === params[0]).map(section => ({ item_id: null, section_name: section.section_name, description: null, quantity: null, unit_price: null }))];
            if (query.startsWith('SELECT * FROM document_sections')) return [state.sections.filter(section => section.document_id === params[0])];
            if (query.startsWith('SELECT di.*')) return [[]];
            if (query.includes('FROM documents d')) {
                if (query.startsWith('SELECT COUNT')) return [[{ total: state.documents.length }]];
                return [state.documents.map(doc => ({ ...doc, section_names: state.sections.filter(section => section.document_id === doc.id).map(section => section.section_name).join(', ') }))];
            }
            throw new Error(`Unexpected query: ${query}`);
        },
    };
    const database = { pool: { getConnection: async () => conn }, query: conn.query.bind(conn) };
    const context = vm.createContext({ console: { error() {} } });
    const databaseModule = new vm.SyntheticModule(['default'], function () { this.setExport('default', database); }, { context });
    const statusModule = new vm.SourceTextModule(await readFile(new URL('../service/quotationStatus.js', import.meta.url), 'utf8'), { context });
    await statusModule.link(() => { throw new Error('Unexpected status dependency'); });
    const cryptoModule = new vm.SyntheticModule(Object.keys(crypto), function () { for (const [key, value] of Object.entries(crypto)) this.setExport(key, value); }, { context });
    const auditModule = new vm.SourceTextModule(await readFile(new URL('../service/auditEntityService.js', import.meta.url), 'utf8'), { context });
    await auditModule.link(specifier => specifier === 'node:crypto' ? cryptoModule : databaseModule);
    const controller = new vm.SourceTextModule(await readFile(new URL('../controller/quotationController.js', import.meta.url), 'utf8'), { context });
    await controller.link(specifier => specifier.endsWith('/database.js') ? databaseModule : specifier.endsWith('/auditEntityService.js') ? auditModule : statusModule);
    await controller.evaluate();
    async function request(handler, body, id = 'QT-1410') {
        const response = { statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        await controller.namespace[handler]({ params: { id }, body, query: {} }, response);
        if (!handler.startsWith('get')) assert.equal(state.released, true);
        return response;
    }
    return { state, request };
}

test('creating another delivery note leaves QT-1410 and its bill number unchanged', async () => {
    const { state, request } = await setup();
    const original = structuredClone(state.documents[0]);
    const response = await request('createQuotation', { current_status: 'DELIVERY_NOTE', delivery_note_no: 'IV6911002' });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.id, 'QT-1411');
    assert.deepEqual(state.documents[0], original);
    assert.equal(state.documents[1].current_status, 'DELIVERY_NOTE');
});

for (const handler of ['updateQuotation', 'updateQuotationStatus']) {
    test(`${handler} rejects an unconfirmed delivery-to-quotation rollback before writing`, async () => {
        const { state, request } = await setup();
        const response = await request(handler, { current_status: 'QUOTATION', delivery_note_no: '' });
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.code, 'QUOTATION_STATUS_ROLLBACK_REQUIRED');
        assert.equal(state.documents[0].current_status, 'DELIVERY_NOTE');
        assert.equal(state.documents[0].delivery_note_no, 'IV6911001');
        assert.equal(state.commits, 0);
        assert.equal(state.rollbacks, 1);
        assert.ok(state.queries[0].endsWith('FOR UPDATE'));
        assert.equal(state.queries.some(query => /^(UPDATE|DELETE)/.test(query)), false);
    });

    test(`${handler} rejects a stale form even when it claims rollback confirmation`, async () => {
        const { state, request } = await setup();
        const response = await request(handler, { current_status: 'QUOTATION', expected_current_status: 'QUOTATION', confirm_status_rollback: true });
        assert.equal(response.statusCode, 409);
        assert.equal(response.body.code, 'QUOTATION_STATUS_CONFLICT');
        assert.equal(state.documents[0].current_status, 'DELIVERY_NOTE');
    });

    test(`${handler} allows cancellation explicitly confirmed from the latest delivery status`, async () => {
        const { state, request } = await setup();
        const response = await request(handler, { current_status: 'QUOTATION', expected_current_status: 'DELIVERY_NOTE', confirm_status_rollback: true, delivery_note_no: '' });
        assert.equal(response.statusCode, 200);
        assert.equal(state.documents[0].current_status, 'QUOTATION');
        assert.equal(state.documents[0].delivery_note_no || '', '');
        assert.equal(state.commits, 1);
    });

    test(`${handler} preserves the issued status when saving delivery details`, async () => {
        const { state, request } = await setup();
        const response = await request(handler, { current_status: 'DELIVERY_NOTE', expected_current_status: 'DELIVERY_NOTE', delivery_note_no: 'IV6911001' });
        assert.equal(response.statusCode, 200);
        assert.equal(state.documents[0].current_status, 'DELIVERY_NOTE');
        assert.equal(state.documents[0].delivery_note_no, 'IV6911001');
    });
}

test('an update that omits current_status preserves the existing delivery status', async () => {
    const { state, request } = await setup();
    const response = await request('updateQuotation', { delivery_note_no: 'IV6911001' });
    assert.equal(response.statusCode, 200);
    assert.equal(state.documents[0].current_status, 'DELIVERY_NOTE');
});

test('a receipt cannot silently regress to a delivery note', async () => {
    const { state, request } = await setup([{ id: 'QT-1410', current_status: 'RECEIPT' }]);
    const response = await request('updateQuotation', { current_status: 'DELIVERY_NOTE' });
    assert.equal(response.statusCode, 409);
    assert.equal(state.documents[0].current_status, 'RECEIPT');
});

test('status endpoint returns 404 for a missing document', async () => {
    const { request } = await setup([]);
    assert.equal((await request('updateQuotationStatus', { current_status: 'QUOTATION' })).statusCode, 404);
});

test('status and order note changes roll back together if note synchronization fails', async () => {
    const { state, request } = await setup();
    state.failOrderNotes = true;
    const response = await request('updateQuotationStatus', { current_status: 'RECEIPT' });
    assert.equal(response.statusCode, 500);
    assert.equal(state.documents[0].current_status, 'DELIVERY_NOTE');
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
});

test('custom group name is optional on create and is stored separately from page names', async () => {
    const { state, request } = await setup();
    const response = await request('createQuotation', { item_group_name: '  ชุดระบบสำนักงาน  ', productSections: [{ section_name: 'เครื่องพิมพ์', items: [] }, { section_name: 'คอมพิวเตอร์', items: [] }] });
    assert.equal(response.statusCode, 201);
    assert.equal(state.documents[1].item_group_name, 'ชุดระบบสำนักงาน');
    assert.deepEqual(state.sections.map(section => section.section_name), ['เครื่องพิมพ์', 'คอมพิวเตอร์']);
    assert.equal(state.documents[0].delivery_note_no, 'IV6911001');
});

test('legacy requests omit the new name without overwriting an existing custom name', async () => {
    const { state, request } = await setup([{ id: 'QT-1410', current_status: 'QUOTATION', item_group_name: 'ชื่อที่ตั้งไว้' }]);
    assert.equal((await request('updateQuotation', { current_status: 'QUOTATION' })).statusCode, 200);
    assert.equal(state.documents[0].item_group_name, 'ชื่อที่ตั้งไว้');
});

for (const value of ['', '   ', null]) {
    test(`clearing custom name restores automatic naming (${JSON.stringify(value)})`, async () => {
        const { state, request } = await setup([{ id: 'QT-1410', current_status: 'QUOTATION', item_group_name: 'ชื่อเดิม' }]);
        assert.equal((await request('updateQuotation', { item_group_name: value })).statusCode, 200);
        assert.equal(state.documents[0].item_group_name, null);
    });
}

test('changing the overall name preserves the original page names', async () => {
    const originalSections = [{ id: 1, document_id: 'QT-1410', section_name: 'งานติดตั้ง', sort_order: 1 }, { id: 2, document_id: 'QT-1410', section_name: 'อะไหล่', sort_order: 2 }];
    const { state, request } = await setup([{ id: 'QT-1410', current_status: 'QUOTATION' }], originalSections);
    const response = await request('updateQuotation', { item_group_name: 'งานระบบกล้อง', productSections: originalSections.map(section => ({ section_name: section.section_name, items: [] })) });
    assert.equal(response.statusCode, 200);
    assert.equal(state.documents[0].item_group_name, 'งานระบบกล้อง');
    assert.deepEqual(state.sections.map(section => section.section_name), ['งานติดตั้ง', 'อะไหล่']);
});

for (const value of ['ก'.repeat(256), { name: 'invalid' }]) {
    test(`invalid custom names are rejected without saving (${typeof value})`, async () => {
        const { state, request } = await setup();
        assert.equal((await request('createQuotation', { item_group_name: value })).statusCode, 400);
        assert.equal(state.documents.length, 1);
        assert.equal(state.commits, 0);
    });
}

test('document reads return the optional name while preserving the legacy section_names field', async () => {
    const { request } = await setup([{ id: 'QT-1410', current_status: 'QUOTATION', item_group_name: 'ชื่อรวม' }], [{ id: 1, document_id: 'QT-1410', section_name: 'หน้าเดิม', sort_order: 1 }]);
    const list = await request('getAllQuotations');
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.data[0].item_group_name, 'ชื่อรวม');
    assert.equal(list.body.data[0].section_names, 'หน้าเดิม');
    const detail = await request('getQuotationById');
    assert.equal(detail.body.item_group_name, 'ชื่อรวม');
    assert.equal(detail.body.productSections[0].section_name, 'หน้าเดิม');
});
