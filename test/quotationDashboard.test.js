import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as dashboard from '../service/quotationDashboard.js';

test('dashboard validates calendar dates, ranges, pagination and ranking before querying', () => {
    for (const query of [{ startDate: '2026-02-30' }, { endDate: '2569-11-21' }, { startDate: '2026-11-22', endDate: '2026-11-21' }, { ageDays: '-1' }, { page: '1.5' }, { ranking: 'count; DROP TABLE documents' }, { customerName: ['unit'] }, { customerName: 'x'.repeat(256) }, { quotationRanking: 'unknown' }]) {
        assert.throws(() => dashboard.parseDashboardFilters(query));
    }
    assert.equal(dashboard.parseDashboardFilters({ startDate: '2024-02-29', ageDays: '0' }).ageDays, 0);
    assert.equal(dashboard.parseDashboardFilters().ageDays, 30);
});

test('all dashboard panels use the same document scope and bound date parameters', () => {
    const filters = dashboard.parseDashboardFilters({ startDate: '2026-01-01', endDate: '2026-12-31', ageDays: '90', page: '2' });
    const queries = dashboard.dashboardQueries(filters, '2026-11-21');
    for (const { sql, params } of queries) {
        assert.match(sql, /d\.is_borrow = 0/);
        assert.match(sql, /INTERVAL 7 HOUR/);
        assert.deepEqual(params.slice(0, 3), ['2026-01-01', '2026-12-31', '2026-11-21']);
        assert.equal((sql.match(/\?/g) || []).length, params.length);
        assert.doesNotMatch(sql, /2026-01-01/);
    }
    assert.deepEqual(queries[2].params.slice(-3), [90, 20, 20]);
    assert.match(queries[2].sql, /current_status = 'DELIVERY_NOTE'/);
});

test('numeric database results preserve current statuses and reveal undated or fallback dates', () => {
    const response = dashboard.dashboardResponse(dashboard.parseDashboardFilters(), [[{ total: '8', QUOTATION: '2', DELIVERY_NOTE: '3', RECEIPT: '1', CANCELLED: '1', organizations: '2', agedDeliveryNotes: '2', oldestDays: '140', fallbackDates: '2', undated: '1', days30: '1', days90: '1' }], [{ customerName: 'หน่วยงาน', documentCount: '5', deliveryCount: '3', oldestDays: '140' }], [{ id: 'QT-1', ageDays: '140', dateSource: 'created_at' }]], new Date('2026-11-21T03:00:00Z'));
    assert.equal(response.summary.total, 8);
    assert.equal(response.statuses.reduce((sum, item) => sum + item.count, 0), 8);
    assert.equal(response.statuses.at(-1).status, 'OTHER');
    assert.equal(response.summary.undated, 1);
    assert.equal(response.summary.fallbackDates, 2);
    assert.equal(response.topOrganizations[0].deliveryCount, 3);
    assert.equal(response.agedDeliveries[0].ageDays, 140);
});

test('an empty dashboard contains zero counts and no invented oldest date', () => {
    const response = dashboard.dashboardResponse(dashboard.parseDashboardFilters(), [[], [], []]);
    assert.equal(response.summary.total, 0);
    assert.equal(response.summary.oldestDays, null);
    assert.equal(response.totalPages, 0);
    assert.ok(response.agingBuckets.every(bucket => bucket.count === 0));
    assert.deepEqual(response.oldestOrganizations, []);
    assert.deepEqual(response.quotationOrganizations, []);
});

test('monthly ranges fill calendar gaps and cap long selections at twelve months', () => {
    const filters = dashboard.parseDashboardFilters({ startDate: '2026-01-20', endDate: '2026-03-05' });
    const data = dashboard.dashboardResponse(filters, [[], [], [], [], [], [
        { month: '2026-01', requestedCount: '2', pendingCount: '1', convertedCount: '1', deliveryCount: '1' },
        { month: '2026-03', requestedCount: '1', inProgressCount: '1', orderingCount: '1' },
    ]], new Date('2026-11-22T03:00:00Z'));
    assert.deepEqual(data.monthlyQuotations.map(row => row.month), ['2026-01', '2026-02', '2026-03']);
    assert.equal(data.monthlyQuotations[1].requestedCount, 0);
    assert.equal(data.monthlyQuotations[0].convertedCount, 1);
    assert.ok(data.monthlyQuotations.every(row => row.requestedCount === row.pendingCount + row.orderingCount + row.readyCount + row.deliveryCount + row.receiptCount + row.cancelledCount));
    assert.deepEqual(data.monthlyRange, { startDate: '2026-01-20', endDate: '2026-03-05' });
    const long = dashboard.dashboardMonthlyWindow(dashboard.parseDashboardFilters({ startDate: '2020-01-01' }), '2026-11-22');
    assert.equal(long.months.length, 12);
    assert.equal(long.months[0], '2025-12');
    assert.equal(long.months.at(-1), '2026-11');
    assert.deepEqual(dashboard.dashboardMonthlyWindow(dashboard.parseDashboardFilters({ startDate: '2027-01-01' }), '2026-11-22').months, []);
});

test('quotation comparisons retain distinct stages and calculate a finite delivery share', () => {
    const data = dashboard.dashboardResponse(dashboard.parseDashboardFilters(), [[], [], [], [], [
        { customerName: 'A', requestedCount: '7', pendingCount: '2', orderingCount: '1', readyCount: '1', deliveryCount: '1', receiptCount: '1', inProgressCount: '2', convertedCount: '2', cancelledCount: '1' },
        { customerName: 'B', requestedCount: '0', pendingCount: '0', convertedCount: '0' },
    ]]);
    assert.deepEqual(data.quotationOrganizations[0], { customerName: 'A', requestedCount: 7, pendingCount: 2, inProgressCount: 2, convertedCount: 2, cancelledCount: 1, orderingCount: 1, readyCount: 1, deliveryCount: 1, receiptCount: 1, conversionRate: 28.6 });
    assert.equal(data.quotationOrganizations[1].conversionRate, 0);
});

test('quotation follow-up views separate pending quotations from ordering and delivered documents', () => {
    const pending = dashboard.dashboardQueries(dashboard.parseDashboardFilters({ quotationRanking: 'pending' }), '2026-11-22')[4];
    assert.match(pending.sql, /HAVING pendingCount > 0/);
    assert.match(pending.sql, /ORDER BY pendingCount DESC, requestedCount DESC/);
    assert.match(pending.sql, /TRIM\(COALESCE\(quotation_id, ''\)\) <> '' OR current_status IN \('QUOTATION', 'ORDERING', 'ITEMS_READY'\)/);
    const unconverted = dashboard.dashboardQueries(dashboard.parseDashboardFilters({ quotationRanking: 'unconverted' }), '2026-11-22')[4];
    assert.match(unconverted.sql, /HAVING convertedCount = 0 AND inProgressCount = 0/);
    assert.match(unconverted.sql, /LIMIT 10/);
});

test('selecting an organization filters every panel by its exact normalized name', () => {
    const customerName = "Unit's 100%_Name";
    const filters = dashboard.parseDashboardFilters({ customerName: ` ${customerName} ` });
    assert.equal(filters.customerName, customerName);
    for (const { sql, params } of dashboard.dashboardQueries(filters, '2026-11-22')) {
        assert.match(sql, /LOWER\(TRIM\(d\.customer_name\)\) = LOWER\(TRIM\(\?\)\)/);
        assert.equal(params[0], customerName);
        assert.doesNotMatch(sql, /Unit's/);
        assert.equal((sql.match(/\?/g) || []).length, params.length);
    }
});

test('oldest organizations report both qualifying and total delivery counts', () => {
    const data = dashboard.dashboardResponse(dashboard.parseDashboardFilters(), [[], [], [], [{ customerName: 'A', deliveryCount: '5', agedDeliveryCount: '2', oldestDays: '240' }]]);
    assert.deepEqual(data.oldestOrganizations[0], { customerName: 'A', deliveryCount: 5, agedDeliveryCount: 2, oldestDays: 240 });
    const query = dashboard.dashboardQueries(dashboard.parseDashboardFilters(), '2026-11-22')[3];
    assert.match(query.sql, /HAVING agedDeliveryCount > 0/);
    assert.match(query.sql, /ORDER BY oldestDays DESC, agedDeliveryCount DESC/);
});

test('organization suggestions are bounded, exclude the borrow page and search wildcard characters literally', () => {
    const { sql, params } = dashboard.dashboardOrganizationQuery({ q: ' 100%_Name ' });
    assert.deepEqual(params, ['100%_Name', '100%_Name']);
    assert.match(sql, /LOCATE\(LOWER\(\?\)/);
    assert.match(sql, /is_borrow = 0/);
    assert.match(sql, /LIMIT 20/);
    assert.throws(() => dashboard.dashboardOrganizationQuery({ q: [] }));
});

async function setup({ fail = false } = {}) {
    const queries = [];
    const context = vm.createContext({ console: { error() {} } });
    const db = new vm.SyntheticModule(['default'], function () { this.setExport('default', { async query(sql, params) { queries.push({ sql, params }); if (fail) throw Error('private database error'); return [[]]; } }); }, { context });
    const helpers = new vm.SyntheticModule(Object.keys(dashboard), function () { for (const [key, value] of Object.entries(dashboard)) this.setExport(key, value); }, { context });
    const controller = new vm.SourceTextModule(await readFile(new URL('../controller/quotationDashboardController.js', import.meta.url), 'utf8'), { context });
    await controller.link(name => name.includes('database') ? db : helpers); await controller.evaluate();
    async function request(query = {}) {
        const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        await controller.namespace.getQuotationDashboard({ query }, res); return res;
    }
    return { queries, request };
}

test('invalid requests do not touch the database and failed loads do not claim an empty result', async () => {
    const first = await setup();
    assert.equal((await first.request({ ageDays: 'bad' })).statusCode, 400);
    assert.equal(first.queries.length, 0);
    const second = await setup({ fail: true });
    const failed = await second.request();
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.body.data, undefined);
    assert.doesNotMatch(failed.body.detail, /private database/);
});

test('dashboard reads six bounded summaries and prevents cached results', async () => {
    const { queries, request } = await setup(); const res = await request();
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(queries.length, 6);
    assert.ok(queries.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
});
