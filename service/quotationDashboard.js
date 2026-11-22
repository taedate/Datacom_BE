export const dashboardStatuses = [
    ['QUOTATION', 'ใบเสนอราคา'], ['ORDERING', 'กำลังสั่งของ'], ['ITEMS_READY', 'ของครบพร้อมส่ง'],
    ['DELIVERY_NOTE', 'ใบส่งของ'], ['RECEIPT', 'ใบเสร็จรับเงิน'], ['BORROW', 'ใบยืมในรายการเอกสาร'], ['CANCELLED', 'ยกเลิก'],
];

const quotationDocumentCondition = `current_status IN ('QUOTATION', 'ORDERING', 'ITEMS_READY', 'DELIVERY_NOTE', 'RECEIPT', 'CANCELLED')
    AND (TRIM(COALESCE(quotation_id, '')) <> '' OR current_status IN ('QUOTATION', 'ORDERING', 'ITEMS_READY'))`;

export function dashboardMonthlyWindow(filters, today) {
    const endDate = filters.endDate || today;
    const [year, month] = endDate.split('-').map(Number);
    const firstMonth = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);
    const startDate = filters.startDate && filters.startDate > firstMonth ? filters.startDate : firstMonth;
    const months = [];
    const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
    while (startDate <= endDate && cursor.toISOString().slice(0, 7) <= endDate.slice(0, 7) && months.length < 12) {
        months.push(cursor.toISOString().slice(0, 7));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return { startDate, endDate, months };
}

function calendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2200-12-31';
}

export function parseDashboardFilters(query = {}) {
    const startDate = query.startDate || '', endDate = query.endDate || '';
    if ((startDate && !calendarDate(startDate)) || (endDate && !calendarDate(endDate)) || (startDate && endDate && startDate > endDate)) {
        throw new Error('กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
    }
    const ageDays = query.ageDays === undefined ? 30 : Number(query.ageDays);
    const page = query.page === undefined ? 1 : Number(query.page);
    const ranking = query.ranking || 'count';
    const quotationRanking = query.quotationRanking || 'requested';
    if (query.customerName !== undefined && (typeof query.customerName !== 'string' || query.customerName.trim().length > 255)) {
        throw new Error('ชื่อหน่วยงานต้องเป็นข้อความไม่เกิน 255 ตัวอักษร');
    }
    const customerName = (query.customerName || '').trim();
    if (!Number.isInteger(ageDays) || ageDays < 0 || ageDays > 3650 || !Number.isInteger(page) || page < 1 || page > 1000000 || !['count', 'delivery', 'oldest'].includes(ranking) || !['requested', 'pending', 'unconverted'].includes(quotationRanking)) {
        throw new Error('ตัวกรอง Dashboard ไม่ถูกต้อง');
    }
    return { startDate, endDate, customerName, ageDays, ranking, quotationRanking, page, pageSize: 20 };
}

export function dashboardQueries(filters, today) {
    const { startDate, endDate, customerName, ageDays, ranking, quotationRanking, page, pageSize } = filters;
    const conditions = ['d.is_borrow = 0'];
    const params = [];
    const documentDate = "COALESCE(CASE WHEN d.issue_date >= '1900-01-01' THEN d.issue_date END, DATE(DATE_ADD(d.created_at, INTERVAL 7 HOUR)))";
    if (startDate) { conditions.push(`${documentDate} >= ?`); params.push(startDate); }
    if (endDate) { conditions.push(`${documentDate} <= ?`); params.push(endDate); }
    if (customerName) { conditions.push('LOWER(TRIM(d.customer_name)) = LOWER(TRIM(?))'); params.push(customerName); }
    const base = `WITH scoped AS (
        SELECT d.id, d.quotation_id, d.delivery_note_no, d.customer_name, d.current_status,
            ${documentDate} AS document_date,
            CASE WHEN d.delivery_date >= '1900-01-01' THEN d.delivery_date
                 WHEN d.created_at >= '1900-01-01' THEN DATE(DATE_ADD(d.created_at, INTERVAL 7 HOUR)) END AS age_date,
            CASE WHEN d.delivery_date >= '1900-01-01' THEN 'delivery_date' ELSE 'created_at' END AS date_source
        FROM documents d WHERE ${conditions.join(' AND ')}
    ), aged AS (SELECT scoped.*, GREATEST(DATEDIFF(?, age_date), 0) AS age_days FROM scoped) `;
    const baseParams = [...params, today];
    const summary = `${base} SELECT COUNT(*) AS total,
        COUNT(DISTINCT CASE WHEN current_status <> 'CANCELLED' AND TRIM(customer_name) <> '' THEN LOWER(TRIM(customer_name)) END) AS organizations,
        ${dashboardStatuses.map(([status]) => `COALESCE(SUM(current_status = '${status}'), 0) AS ${status}`).join(', ')},
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days >= ?), 0) AS agedDeliveryNotes,
        MAX(CASE WHEN current_status = 'DELIVERY_NOTE' THEN age_days END) AS oldestDays,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND date_source = 'created_at' AND age_date IS NOT NULL), 0) AS fallbackDates,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days BETWEEN 0 AND 29), 0) AS days0,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days BETWEEN 30 AND 59), 0) AS days30,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days BETWEEN 60 AND 89), 0) AS days60,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days >= 90), 0) AS days90,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_date IS NULL), 0) AS undated
        FROM aged`;
    const order = { count: 'documentCount DESC, deliveryCount DESC', delivery: 'deliveryCount DESC, oldestDays DESC', oldest: 'oldestDays DESC, deliveryCount DESC' }[ranking];
    const organizations = `${base} SELECT MIN(TRIM(customer_name)) AS customerName, COUNT(*) AS documentCount,
        COALESCE(SUM(current_status = 'QUOTATION'), 0) AS quotationCount,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE'), 0) AS deliveryCount,
        COALESCE(SUM(current_status = 'RECEIPT'), 0) AS receiptCount,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE' AND age_days >= ?), 0) AS agedDeliveryCount,
        MAX(CASE WHEN current_status = 'DELIVERY_NOTE' THEN age_days END) AS oldestDays
        FROM aged WHERE current_status <> 'CANCELLED' AND TRIM(COALESCE(customer_name, '')) <> ''
        GROUP BY LOWER(TRIM(customer_name)) ${ranking === 'count' ? '' : 'HAVING deliveryCount > 0'}
        ORDER BY ${order}, customerName ASC LIMIT 10`;
    const deliveries = `${base} SELECT id, quotation_id AS quotationId, delivery_note_no AS deliveryNoteNo,
        COALESCE(NULLIF(TRIM(customer_name), ''), 'ไม่ระบุหน่วยงาน') AS customerName,
        DATE_FORMAT(age_date, '%Y-%m-%d') AS ageDate, date_source AS dateSource, age_days AS ageDays
        FROM aged WHERE current_status = 'DELIVERY_NOTE' AND age_days >= ?
        ORDER BY age_days DESC, age_date ASC, id ASC LIMIT ? OFFSET ?`;
    const oldestOrganizations = `${base} SELECT MIN(TRIM(customer_name)) AS customerName,
        COUNT(*) AS deliveryCount,
        COALESCE(SUM(age_days >= ?), 0) AS agedDeliveryCount,
        MAX(age_days) AS oldestDays
        FROM aged WHERE current_status = 'DELIVERY_NOTE' AND TRIM(COALESCE(customer_name, '')) <> ''
        GROUP BY LOWER(TRIM(customer_name)) HAVING agedDeliveryCount > 0
        ORDER BY oldestDays DESC, agedDeliveryCount DESC, deliveryCount DESC, customerName ASC LIMIT 10`;
    const quotationOrder = quotationRanking === 'pending' ? 'pendingCount DESC, requestedCount DESC' : 'requestedCount DESC, pendingCount DESC';
    const quotationHaving = quotationRanking === 'pending' ? 'HAVING pendingCount > 0'
        : quotationRanking === 'unconverted' ? 'HAVING convertedCount = 0 AND inProgressCount = 0' : '';
    const quotationOrganizations = `${base} SELECT MIN(TRIM(customer_name)) AS customerName,
        COUNT(*) AS requestedCount,
        COALESCE(SUM(current_status = 'QUOTATION'), 0) AS pendingCount,
        COALESCE(SUM(current_status = 'ORDERING'), 0) AS orderingCount,
        COALESCE(SUM(current_status = 'ITEMS_READY'), 0) AS readyCount,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE'), 0) AS deliveryCount,
        COALESCE(SUM(current_status = 'RECEIPT'), 0) AS receiptCount,
        COALESCE(SUM(current_status IN ('ORDERING', 'ITEMS_READY')), 0) AS inProgressCount,
        COALESCE(SUM(current_status IN ('DELIVERY_NOTE', 'RECEIPT')), 0) AS convertedCount,
        COALESCE(SUM(current_status = 'CANCELLED'), 0) AS cancelledCount
        FROM aged WHERE TRIM(COALESCE(customer_name, '')) <> ''
            AND ${quotationDocumentCondition}
        GROUP BY LOWER(TRIM(customer_name)) ${quotationHaving}
        ORDER BY ${quotationOrder}, customerName ASC LIMIT 10`;
    const monthlyWindow = dashboardMonthlyWindow(filters, today);
    const monthlyQuotations = `${base} SELECT DATE_FORMAT(document_date, '%Y-%m') AS month,
        COUNT(*) AS requestedCount,
        COALESCE(SUM(current_status = 'QUOTATION'), 0) AS pendingCount,
        COALESCE(SUM(current_status = 'ORDERING'), 0) AS orderingCount,
        COALESCE(SUM(current_status = 'ITEMS_READY'), 0) AS readyCount,
        COALESCE(SUM(current_status = 'DELIVERY_NOTE'), 0) AS deliveryCount,
        COALESCE(SUM(current_status = 'RECEIPT'), 0) AS receiptCount,
        COALESCE(SUM(current_status IN ('ORDERING', 'ITEMS_READY')), 0) AS inProgressCount,
        COALESCE(SUM(current_status IN ('DELIVERY_NOTE', 'RECEIPT')), 0) AS convertedCount,
        COALESCE(SUM(current_status = 'CANCELLED'), 0) AS cancelledCount
        FROM aged WHERE ${quotationDocumentCondition} AND document_date BETWEEN ? AND ?
        GROUP BY DATE_FORMAT(document_date, '%Y-%m') ORDER BY month ASC`;
    return [
        { sql: summary, params: [...baseParams, ageDays] },
        { sql: organizations, params: [...baseParams, ageDays] },
        { sql: deliveries, params: [...baseParams, ageDays, pageSize, (page - 1) * pageSize] },
        { sql: oldestOrganizations, params: [...baseParams, ageDays] },
        { sql: quotationOrganizations, params: baseParams },
        { sql: monthlyQuotations, params: [...baseParams, monthlyWindow.startDate, monthlyWindow.endDate] },
    ];
}

export function dashboardResponse(filters, rows, generatedAt = new Date()) {
    const [summaryRows, organizationRows, deliveryRows, oldestOrganizationRows = [], quotationOrganizationRows = [], monthlyRows = []] = rows;
    const raw = summaryRows[0] || {};
    const number = value => Number(value || 0);
    const statuses = dashboardStatuses.map(([status, label]) => ({ status, label, count: number(raw[status]) }));
    const other = number(raw.total) - statuses.reduce((sum, item) => sum + item.count, 0);
    if (other > 0) statuses.push({ status: 'OTHER', label: 'สถานะอื่น ๆ', count: other });
    const today = new Date(generatedAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const monthlyRange = dashboardMonthlyWindow(filters, today);
    const monthlyByMonth = new Map(monthlyRows.map(row => [row.month, row]));
    return {
        filters, generatedAt: generatedAt.toISOString(),
        summary: { total: number(raw.total), organizations: number(raw.organizations), deliveryNotes: number(raw.DELIVERY_NOTE), agedDeliveryNotes: number(raw.agedDeliveryNotes), oldestDays: raw.oldestDays === null || raw.oldestDays === undefined ? null : number(raw.oldestDays), fallbackDates: number(raw.fallbackDates), undated: number(raw.undated) },
        statuses,
        agingBuckets: [['days0', '0–29 วัน'], ['days30', '30–59 วัน'], ['days60', '60–89 วัน'], ['days90', '90 วันขึ้นไป']].map(([key, label]) => ({ key, label, count: number(raw[key]) })),
        topOrganizations: organizationRows.map(row => ({ ...row, documentCount: number(row.documentCount), quotationCount: number(row.quotationCount), deliveryCount: number(row.deliveryCount), receiptCount: number(row.receiptCount), agedDeliveryCount: number(row.agedDeliveryCount), oldestDays: row.oldestDays === null ? null : number(row.oldestDays) })),
        agedDeliveries: deliveryRows.map(row => ({ ...row, ageDays: number(row.ageDays) })),
        oldestOrganizations: oldestOrganizationRows.map(row => ({ ...row, deliveryCount: number(row.deliveryCount), agedDeliveryCount: number(row.agedDeliveryCount), oldestDays: row.oldestDays == null ? null : number(row.oldestDays) })),
        quotationOrganizations: quotationOrganizationRows.map(row => ({
            customerName: row.customerName,
            requestedCount: number(row.requestedCount), pendingCount: number(row.pendingCount), inProgressCount: number(row.inProgressCount),
            convertedCount: number(row.convertedCount), cancelledCount: number(row.cancelledCount),
            orderingCount: number(row.orderingCount), readyCount: number(row.readyCount), deliveryCount: number(row.deliveryCount), receiptCount: number(row.receiptCount),
            conversionRate: number(row.requestedCount) ? Math.round(number(row.convertedCount) / number(row.requestedCount) * 1000) / 10 : 0,
        })),
        monthlyRange: { startDate: monthlyRange.startDate, endDate: monthlyRange.endDate },
        monthlyQuotations: monthlyRange.months.map(month => {
            const row = monthlyByMonth.get(month) || {};
            return { month, requestedCount: number(row.requestedCount), pendingCount: number(row.pendingCount), orderingCount: number(row.orderingCount), readyCount: number(row.readyCount), deliveryCount: number(row.deliveryCount), receiptCount: number(row.receiptCount), inProgressCount: number(row.inProgressCount), convertedCount: number(row.convertedCount), cancelledCount: number(row.cancelledCount) };
        }),
        totalPages: Math.ceil(number(raw.agedDeliveryNotes) / filters.pageSize),
    };
}

export function dashboardOrganizationQuery(query = {}) {
    if (query.q !== undefined && (typeof query.q !== 'string' || query.q.trim().length > 255)) throw new Error('คำค้นหาหน่วยงานไม่ถูกต้อง');
    const term = (query.q || '').trim();
    return {
        sql: `SELECT customerName, documentCount FROM (
                SELECT MIN(TRIM(customer_name)) AS customerName, COUNT(*) AS documentCount
                FROM documents WHERE is_borrow = 0 AND TRIM(COALESCE(customer_name, '')) <> ''
                    AND LOCATE(LOWER(?), LOWER(TRIM(customer_name))) > 0
                GROUP BY LOWER(TRIM(customer_name))
            ) organization_names
            ORDER BY (LOWER(customerName) = LOWER(?)) DESC, documentCount DESC, customerName ASC LIMIT 20`,
        params: [term, term],
    };
}
