import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as helpers from '../service/productDescriptions.js';
import { productDescriptionSeeds } from '../db/product_description_seeds.js';
import { migrateProductDescriptions } from '../db/run_product_descriptions_migration.js';

test('the initial catalog contains all 80 distinct user-supplied texts', () => {
    assert.equal(productDescriptionSeeds.length, 80);
    assert.equal(new Set(productDescriptionSeeds.map(row => helpers.normalizeProductDescription(row).fingerprint)).size, 80);
    const categories = Object.fromEntries(['หมึกพิมพ์', 'รางปลั๊กไฟ', 'ถ่านและเครื่องชาร์จ'].map(name => [name, productDescriptionSeeds.filter(row => row.category === name).length]));
    assert.deepEqual(Object.values(categories), [58, 9, 13]);
    assert.ok(productDescriptionSeeds.some(row => row.description === 'Toner Original HP 107A W1107A'));
    assert.ok(productDescriptionSeeds.some(row => row.description === 'ตลับหมึกเทียบ HP 107A W1107A'));
    assert.ok(productDescriptionSeeds.every(row => !row.description.includes('|')));
});

test('searches match model punctuation, preserve independent words, and bind every parameter', () => {
    assert.equal(helpers.descriptionSearchText('TN-2480'), helpers.descriptionSearchText('tn2480'));
    const filter = helpers.productDescriptionFilters({ q: '2480 เทียบ', limit: '8' }, true);
    assert.equal(filter.params.length, 2);
    assert.equal(filter.params[0], '%2480%');
    assert.equal((filter.where.match(/\?/g) || []).length, filter.params.length);
    for (const query of [{ page: '-1' }, { limit: '1000' }, { search: ['x'] }, { category: {} }, { search: 'x'.repeat(201) }]) assert.throws(() => helpers.productDescriptionFilters(query));
    for (const id of ['0', '-1', '1 OR 1=1', '1.2', '9999999999999999999']) assert.throws(() => helpers.productDescriptionId(id));
    assert.equal(helpers.normalizeProductDescription({ description: '  Toner   ABC  ' }).fingerprint, helpers.normalizeProductDescription({ description: 'toner abc' }).fingerprint);
    for (const description of ['', '   ', null, 'x'.repeat(2001)]) assert.throws(() => helpers.normalizeProductDescription({ description }));
});

test('migration seeds once and does not restore edited or deleted defaults on a later run', async () => {
    let applied = false, insertCalls = 0, committed = 0;
    const connection = {
        async query(sql, params) {
            if (sql.startsWith('SELECT version')) return [applied ? [{ version: params[0] }] : []];
            if (sql.startsWith('INSERT IGNORE')) { insertCalls++; assert.equal(params[0].length, 80); return [{ affectedRows: 80 }]; }
            if (sql.startsWith('INSERT INTO product_description_seeds')) applied = true;
            return [[]];
        }, async beginTransaction() {}, async commit() { committed++; }, async rollback() { assert.fail('unexpected rollback'); },
    };
    assert.deepEqual(await migrateProductDescriptions(connection), { inserted: 80 });
    assert.deepEqual(await migrateProductDescriptions(connection), { inserted: 0 });
    assert.equal(insertCalls, 1); assert.equal(committed, 2);
});

async function controller(query) {
    const context = vm.createContext({ console: { error() {} } });
    const module = new vm.SourceTextModule(await readFile(new URL('../controller/productDescriptionController.js', import.meta.url), 'utf8'), { context });
    await module.link(specifier => {
        const exports = specifier.endsWith('database.js') ? { default: { query } } : helpers;
        return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    });
    await module.evaluate();
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
    return { actions: module.namespace, res };
}

test('suggestions avoid empty scans and keep SQL results bounded', async () => {
    const calls = [];
    const { actions, res } = await controller(async (sql, params) => { calls.push({ sql, params }); return [[{ id: 1, description: 'ตลับหมึกเทียบ TN-2480' }]]; });
    await actions.suggestProductDescriptions({ query: { q: '2' } }, res);
    assert.equal(calls.length, 0);
    await actions.suggestProductDescriptions({ query: { q: 'TN2480' } }, res);
    assert.equal(calls[0].params.at(-1), 8);
    assert.equal(calls[0].params[0], '%tn2480%');
    assert.equal(res.body.items.length, 1);
});

test('create/edit/delete reject invalid values, duplicates and missing records', async () => {
    let calls = 0;
    const { actions, res } = await controller(async () => { calls++; throw { code: 'ER_DUP_ENTRY' }; });
    await actions.createProductDescription({ body: { description: '' } }, res);
    assert.equal(res.statusCode, 400); assert.equal(calls, 0);
    await actions.createProductDescription({ body: { description: 'Toner Original HP 230A' } }, res);
    assert.equal(res.statusCode, 409);
    const missing = await controller(async () => [{ affectedRows: 0 }]);
    await missing.actions.updateProductDescription({ params: { id: 1 }, body: { description: 'test' } }, missing.res);
    assert.equal(missing.res.statusCode, 404);
    await missing.actions.deleteProductDescription({ params: { id: 'x' } }, missing.res);
    assert.equal(missing.res.statusCode, 400);
});
