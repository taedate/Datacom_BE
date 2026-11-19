import assert from 'node:assert/strict';
import test from 'node:test';
import { addItemGroupNameColumn } from '../db/run_item_group_name_migration.js';

test('migration adds only a nullable optional column without updating existing names', async () => {
    const queries = [];
    const connection = { async query(sql) { queries.push(sql); return [[]]; } };
    assert.equal(await addItemGroupNameColumn(connection), true);
    assert.equal(queries.length, 2);
    assert.match(queries[1], /ADD COLUMN item_group_name VARCHAR\(255\) NULL DEFAULT NULL/);
    assert.equal(queries.some(sql => /^(UPDATE|DELETE|INSERT)/i.test(sql)), false);
});

test('migration can be rerun without modifying the schema or records', async () => {
    const queries = [];
    const connection = { async query(sql) { queries.push(sql); return [[{ COLUMN_NAME: 'item_group_name' }]]; } };
    assert.equal(await addItemGroupNameColumn(connection), false);
    assert.equal(queries.length, 1);
});
