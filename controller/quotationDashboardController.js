import database from '../service/database.js';
import { parseDashboardFilters, dashboardQueries, dashboardResponse, dashboardOrganizationQuery } from '../service/quotationDashboard.js';

export async function getQuotationDashboard(req, res) {
    let filters;
    try { filters = parseDashboardFilters(req.query); }
    catch (error) { return res.status(400).json({ message: 'error', detail: error.message }); }
    try {
        const now = new Date();
        const today = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const results = await Promise.all(dashboardQueries(filters, today).map(({ sql, params }) => database.query(sql, params)));
        res.set('Cache-Control', 'no-store');
        res.json({ message: 'success', data: dashboardResponse(filters, results.map(result => result[0]), now) });
    } catch (error) {
        console.error('Quotation dashboard failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'โหลด Dashboard ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
}

export async function getDashboardOrganizations(req, res) {
    let query;
    try { query = dashboardOrganizationQuery(req.query); }
    catch (error) { return res.status(400).json({ message: 'error', detail: error.message }); }
    try {
        const [rows] = await database.query(query.sql, query.params);
        res.set('Cache-Control', 'no-store');
        res.json({ message: 'success', data: rows.map(row => ({ customerName: row.customerName, documentCount: Number(row.documentCount) })) });
    } catch (error) {
        console.error('Dashboard organizations failed:', error.message);
        res.status(500).json({ message: 'error', detail: 'ค้นหาหน่วยงานไม่สำเร็จ กรุณาลองใหม่' });
    }
}
