import database from './database.js';

const BANGKOK_TIMEZONE = 'Asia/Bangkok';

const WORK_TYPE_TEXT = {
    caseRepair: 'งานรับซ่อม',
    caseSentRepair: 'งานส่งซ่อม',
    caseProject: 'งานติดตั้ง',
    quotation: 'เอกสารขาย'
};

function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getDatePartsInBangkok(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: BANGKOK_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);

    return { year, month, day };
}

function getBangkokTodayString() {
    const { year, month, day } = getDatePartsInBangkok(new Date());
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseToYmd(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[1]}-${match[2]}-${match[3]}`;

        const fallbackDate = new Date(value);
        if (!Number.isNaN(fallbackDate.getTime())) {
            const y = fallbackDate.getUTCFullYear();
            const m = fallbackDate.getUTCMonth() + 1;
            const d = fallbackDate.getUTCDate();
            return `${y}-${pad2(m)}-${pad2(d)}`;
        }
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getUTCFullYear();
        const m = value.getUTCMonth() + 1;
        const d = value.getUTCDate();
        return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    return null;
}

function formatThaiDate(ymd) {
    if (!ymd) return '';
    const [year, month, day] = ymd.split('-').map(Number);
    if (!year || !month || !day) return '';
    return `${pad2(day)}-${pad2(month)}-${year + 543}`;
}

function diffDays(fromYmd, toYmd) {
    if (!fromYmd || !toYmd) return 0;
    const fromDate = new Date(`${fromYmd}T00:00:00Z`);
    const toDate = new Date(`${toYmd}T00:00:00Z`);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;

    const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000);
    return days > 0 ? days : 0;
}

function resolveUrgencyLevel(ageDays, warnDays, criticalDays) {
    if (ageDays > criticalDays) return 'critical';
    if (ageDays > warnDays) return 'warning';
    return 'normal';
}

function hasDateValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
}

function isClosedRepair(row) {
    const status = String(row.caseStatus || '').toLowerCase();
    if (hasDateValue(row.dateDelivered)) return true;
    return status.includes('ส่งมอบ') || status.includes('ปิด') || status.includes('ยกเลิก');
}

function isClosedSentRepair(row) {
    return hasDateValue(row.dateOfReceived);
}

function isClosedProject(row) {
    const status = String(row.pStatus || '').toLowerCase();
    return status.includes('เสร็จ') || status.includes('ปิด') || status.includes('ยกเลิก');
}

function isClosedQuotation(row) {
    const status = String(row.current_status || '').toUpperCase();
    return status === 'RECEIPT' || status === 'CANCELLED';
}

function normalizeRepair(row, todayYmd, warnDays, criticalDays) {
    const customerName = `${row.cusFirstName || ''} ${row.cusLastName || ''}`.trim();
    const customer = customerName || row.caseInstitution || '';
    const baseDate = parseToYmd(row.datePickUp) || parseToYmd(row.created_at);
    const ageDays = diffDays(baseDate, todayYmd);

    return {
        uid: `caseRepair-${row.caseId || ''}`,
        workType: 'caseRepair',
        workTypeText: WORK_TYPE_TEXT.caseRepair,
        refId: row.caseId || '',
        title: row.brokenSymptom || row.caseType || '',
        customer,
        status: row.caseStatus || '',
        baseDate: baseDate || '',
        baseDateText: formatThaiDate(baseDate),
        ageDays,
        urgencyLevel: resolveUrgencyLevel(ageDays, warnDays, criticalDays)
    };
}

function normalizeSentRepair(row, todayYmd, warnDays, criticalDays) {
    const baseDate = parseToYmd(row.DateSOfSent) || parseToYmd(row.created_at);
    const ageDays = diffDays(baseDate, todayYmd);
    const status = hasDateValue(row.dateOfReceived) ? 'รับคืนแล้ว' : 'ส่งซ่อมอยู่';

    return {
        uid: `caseSentRepair-${row.caseSId || ''}`,
        workType: 'caseSentRepair',
        workTypeText: WORK_TYPE_TEXT.caseSentRepair,
        refId: row.caseSId || '',
        title: row.brokenSymptom || row.caseSType || '',
        customer: row.caseSCusName || '',
        status,
        baseDate: baseDate || '',
        baseDateText: formatThaiDate(baseDate),
        ageDays,
        urgencyLevel: resolveUrgencyLevel(ageDays, warnDays, criticalDays)
    };
}

function normalizeProject(row, todayYmd, warnDays, criticalDays) {
    const baseDate = parseToYmd(row.dateCreate) || parseToYmd(row.created_at);
    const ageDays = diffDays(baseDate, todayYmd);

    return {
        uid: `caseProject-${row.pId || ''}`,
        workType: 'caseProject',
        workTypeText: WORK_TYPE_TEXT.caseProject,
        refId: row.pId || '',
        title: row.pDetail || '',
        customer: row.pAddress || '',
        status: row.pStatus || '',
        baseDate: baseDate || '',
        baseDateText: formatThaiDate(baseDate),
        ageDays,
        urgencyLevel: resolveUrgencyLevel(ageDays, warnDays, criticalDays)
    };
}

function normalizeQuotation(row, todayYmd, warnDays, criticalDays) {
    const baseDate = parseToYmd(row.issue_date) || parseToYmd(row.created_at);
    const ageDays = diffDays(baseDate, todayYmd);

    return {
        uid: `quotation-${row.id || ''}`,
        workType: 'quotation',
        workTypeText: WORK_TYPE_TEXT.quotation,
        refId: row.quotation_id || row.id || '',
        title: row.remark || row.delivery_note_no || 'เอกสารขาย',
        customer: row.customer_name || '',
        status: row.current_status || '',
        baseDate: baseDate || '',
        baseDateText: formatThaiDate(baseDate),
        ageDays,
        urgencyLevel: resolveUrgencyLevel(ageDays, warnDays, criticalDays)
    };
}

function applyFilters(items, query) {
    const keyword = String(query.keyword || '').trim().toLowerCase();
    const workType = String(query.workType || '').trim();
    const urgency = String(query.urgency || '').trim();
    const startDate = parseToYmd(query.startDate);
    const endDate = parseToYmd(query.endDate);

    return items.filter((item) => {
        if (workType && item.workType !== workType) return false;
        if (urgency && item.urgencyLevel !== urgency) return false;

        if (startDate && item.baseDate && item.baseDate < startDate) return false;
        if (endDate && item.baseDate && item.baseDate > endDate) return false;

        if (keyword) {
            const haystack = [
                item.refId,
                item.title,
                item.customer,
                item.status,
                item.workTypeText
            ].join(' ').toLowerCase();

            if (!haystack.includes(keyword)) return false;
        }

        return true;
    });
}

function sortUrgentItems(items) {
    return [...items].sort((a, b) => {
        if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
        return (a.baseDate || '').localeCompare(b.baseDate || '');
    });
}

function buildSummary(items, warnDays) {
    // Match FE summary logic:
    // warning  = ageDays > warnDays
    // critical = ageDays > criticalDays (subset of warning)
    // followToday = warning + critical
    const warning = items.filter((item) => item.ageDays > warnDays).length;
    const critical = items.filter((item) => item.urgencyLevel === 'critical').length;
    const followToday = warning + critical;

    return {
        total: items.length,
        warning,
        critical,
        followToday
    };
}

function buildLineText(date, summary, topAging) {
    const lines = [
        `Daily Digest (${date})`,
        `ทั้งหมด: ${summary.total} งาน`,
        `เตือน: ${summary.warning} งาน`,
        `วิกฤต: ${summary.critical} งาน`,
        `ต้องติดตามวันนี้: ${summary.followToday} งาน`
    ];

    if (topAging.length > 0) {
        lines.push('');
        lines.push('Top Aging');
        topAging.forEach((item, index) => {
            lines.push(`${index + 1}. ${item.refId} | ${item.workTypeText} | ${item.status} | ${item.ageDays} วัน`);
        });
    }

    return lines.join('\n');
}

async function fetchUnifiedUrgentItems(referenceDate, warnDays, criticalDays) {
    const [repairRowsResult, sentRepairRowsResult, projectRowsResult, quotationRowsResult] = await Promise.all([
        database.query(
            `SELECT caseId, cusFirstName, cusLastName, caseInstitution, brokenSymptom, caseType, caseStatus, datePickUp, dateDelivered, created_at
             FROM caseRepair`
        ),
        database.query(
            `SELECT caseSId, caseSCusName, brokenSymptom, caseSType, DateSOfSent, dateOfReceived, created_at
             FROM caseSentRepair`
        ),
        database.query(
            `SELECT pId, pAddress, pDetail, pStatus, dateCreate, created_at
             FROM caseProject`
        ),
        database.query(
            `SELECT id, quotation_id, customer_name, current_status, issue_date, delivery_note_no, remark, created_at
             FROM documents`
        )
    ]);

    const repairRows = repairRowsResult[0] || [];
    const sentRepairRows = sentRepairRowsResult[0] || [];
    const projectRows = projectRowsResult[0] || [];
    const quotationRows = quotationRowsResult[0] || [];

    const repairItems = repairRows
        .filter((row) => !isClosedRepair(row))
        .map((row) => normalizeRepair(row, referenceDate, warnDays, criticalDays));

    const sentRepairItems = sentRepairRows
        .filter((row) => !isClosedSentRepair(row))
        .map((row) => normalizeSentRepair(row, referenceDate, warnDays, criticalDays));

    const projectItems = projectRows
        .filter((row) => !isClosedProject(row))
        .map((row) => normalizeProject(row, referenceDate, warnDays, criticalDays));

    const quotationItems = quotationRows
        .filter((row) => !isClosedQuotation(row))
        .map((row) => normalizeQuotation(row, referenceDate, warnDays, criticalDays));

    return [...repairItems, ...sentRepairItems, ...projectItems, ...quotationItems];
}

export async function getUrgentOverviewData(query = {}) {
    const warnDays = toNumber(query.warnDays, 3);
    const criticalDays = toNumber(query.criticalDays, 5);
    const page = Math.max(toNumber(query.page, 1), 1);
    const pageSize = Math.max(toNumber(query.pageSize, 20), 1);

    const todayYmd = getBangkokTodayString();
    const unifiedItems = await fetchUnifiedUrgentItems(todayYmd, warnDays, criticalDays);
    const filteredItems = sortUrgentItems(applyFilters(unifiedItems, query));

    const totalItems = filteredItems.length;
    const start = (page - 1) * pageSize;
    const pagedItems = filteredItems.slice(start, start + pageSize);

    return {
        summary: buildSummary(filteredItems, warnDays),
        items: pagedItems,
        meta: {
            page,
            pageSize,
            totalItems
        }
    };
}

export async function getUrgentDigestData(query = {}) {
    const warnDays = toNumber(query.warnDays, 3);
    const criticalDays = toNumber(query.criticalDays, 5);

    const digestDate = parseToYmd(query.date) || getBangkokTodayString();

    const allItems = await fetchUnifiedUrgentItems(digestDate, warnDays, criticalDays);
    const sortedItems = sortUrgentItems(allItems);

    const topAging = sortedItems.slice(0, 5).map((item) => ({
        refId: item.refId || '',
        workTypeText: item.workTypeText || '',
        status: item.status || '',
        ageDays: item.ageDays || 0
    }));

    const summary = buildSummary(allItems, warnDays);

    return {
        date: digestDate,
        summary,
        topAging,
        lineText: buildLineText(digestDate, summary, topAging)
    };
}

export { getBangkokTodayString };
