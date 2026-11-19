import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as catalog from '../service/auditLogCatalog.js';

async function setup() {
    const queries = [];
    const database = { async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('information_schema.COLUMNS')) {
            const columns = sql.includes("TABLE_NAME = 'users'") ? ['userId', 'userName'] : ['logId', 'performedBy', 'action', 'module', 'entityType', 'entityId', 'status', 'detail', 'createdAt'];
            return [columns.map(COLUMN_NAME => ({ COLUMN_NAME }))];
        }
        if (sql.includes('COUNT(*)')) return [[{ totalItems: 0 }]];
        return [[]];
    } };
    const context = vm.createContext({ console });
    const dbModule = new vm.SyntheticModule(['default'], function () { this.setExport('default', database); }, { context });
    const catalogModule = new vm.SyntheticModule(Object.keys(catalog), function () { for (const [key, value] of Object.entries(catalog)) this.setExport(key, value); }, { context });
    const module = new vm.SourceTextModule(await readFile(new URL('../controller/auditLogController.js', import.meta.url), 'utf8'), { context });
    await module.link(specifier => specifier.endsWith('/database.js') ? dbModule : catalogModule);
    await module.evaluate();
    return { queries, async request(query) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
        await module.namespace.getAuditLogs({ query }, res);
        return res;
    } };
}

test('bill-number search includes historical before and after values in detail', async () => {
    const { queries, request } = await setup();
    const res = await request({ search: 'IV6911085' });
    assert.equal(res.statusCode, 200);
    const select = queries.find(query => query.sql.includes('FROM audit_logs a') && !query.sql.includes('COUNT(*)'));
    assert.match(select.sql, /CAST\(a\.detail AS CHAR\) LIKE \?/);
    assert.ok(select.params.includes('%IV6911085%'));
    assert.match(select.sql, /searchUser\.userName LIKE \?/);
});

test('stock and customer history filters accept their business module', async () => {
    for (const module of ['stock', 'customer', 'ink_price', 'template', 'order_note']) {
        const { request } = await setup();
        assert.equal((await request({ module })).statusCode, 200, module);
    }
});

test('status filtering searches both sides of a transition and tolerates legacy non-JSON detail', async () => {
    const { queries, request } = await setup();
    assert.equal((await request({ entityStatus: 'DELIVERY_NOTE' })).statusCode, 200);
    const select = queries.find(query => query.sql.includes('FROM audit_logs a') && !query.sql.includes('COUNT(*)'));
    assert.match(select.sql, /JSON_VALID\(a\.detail\)/);
    assert.match(select.sql, /\$\.before\.current_status/);
    assert.match(select.sql, /\$\.after\.current_status/);
});
