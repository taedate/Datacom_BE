import database from '../service/database.js';

const MODULES = new Set(['auth', 'invite', 'user', 'repair', 'sentRepair', 'project', 'quotation', 'system']);
const STATUS = new Set(['success', 'fail']);

import {
    AUDIT_ACTIONS,
    AUDIT_MODULES,
    AUDIT_STATUS,
} from '../service/auditLogCatalog.js';

function codedError(res, status, code, detail) {
    return res.status(status).json({ message: 'error', code, detail });
}

function parsePositiveInt(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        return null;
    }
    return n;
}

function parseDateRange(dateRange) {
    if (!dateRange) {
        return null;
    }

    if (typeof dateRange !== 'string') {
        return null;
    }

    const parts = dateRange.split(/\s+to\s+/i).map((item) => item.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
    }

    const parseThaiDate = (text) => {
        const [ddRaw, mmRaw, yyyyRaw] = text.split('-');
        const dd = Number(ddRaw);
        const mm = Number(mmRaw);
        const yyyy = Number(yyyyRaw);
        if (!Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yyyy)) {
            return null;
        }
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
            return null;
        }

        const ceYear = yyyy > 2400 ? (yyyy - 543) : yyyy;
        if (ceYear < 1900 || ceYear > 2600) {
            return null;
        }

        const date = new Date(Date.UTC(ceYear, mm - 1, dd));
        if (date.getUTCFullYear() !== ceYear || (date.getUTCMonth() + 1) !== mm || date.getUTCDate() !== dd) {
            return null;
        }

        const yyyyText = String(ceYear).padStart(4, '0');
        const mmText = String(mm).padStart(2, '0');
        const ddText = String(dd).padStart(2, '0');
        return `${yyyyText}-${mmText}-${ddText}`;
    };

    const start = parseThaiDate(parts[0]);
    const end = parseThaiDate(parts[1]);
    if (!start || !end) {
        return null;
    }

    return {
        startAt: `${start} 00:00:00`,
        endAt: `${end} 23:59:59`,
    };
}

async function getAuditColumns() {
    const [rows] = await database.query(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'audit_logs'`
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getUserColumns() {
    const [rows] = await database.query(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'`
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
}

function colExpr(columns, preferred, fallback = null, alias = '') {
    if (preferred.some((name) => columns.has(name))) {
        return `${alias}${preferred.find((name) => columns.has(name))}`;
    }
    return fallback || 'NULL';
}

function coalesceExpr(columns, names, fallback = 'NULL', alias = '') {
    const available = names.filter((name) => columns.has(name));
    if (available.length === 0) {
        return fallback;
    }
    if (available.length === 1) {
        return `${alias}${available[0]}`;
    }
    return `COALESCE(${available.map((name) => `${alias}${name}`).join(', ')})`;
}

export async function getAuditLogs(req, res) {
    try {
        const page = parsePositiveInt(req.query.page, 1);
        const itemsPerPage = parsePositiveInt(req.query.itemsPerPage, 20);
        if (!page || !itemsPerPage || itemsPerPage > 200) {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }

        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        const performedByRaw = req.query.performedBy;
        let performedBy = null;
        if (performedByRaw !== undefined && performedByRaw !== null && String(performedByRaw).trim() !== '') {
            const normalized = String(performedByRaw).trim();
            if (!/^\d+$/.test(normalized)) {
                return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
            }
            performedBy = Number(normalized);
        }

        const moduleName = typeof req.query.module === 'string' ? req.query.module.trim() : '';
        if (moduleName && !MODULES.has(moduleName)) {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }

        const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';

        const entityStatus = typeof req.query.entityStatus === 'string' ? req.query.entityStatus.trim() : '';

        const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
        if (status && !STATUS.has(status)) {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }

        const dateRange = req.query.dateRange ? parseDateRange(req.query.dateRange) : null;
        if (req.query.dateRange && !dateRange) {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }

        const [columns, userColumns] = await Promise.all([getAuditColumns(), getUserColumns()]);
        const logIdExpr = colExpr(columns, ['logId', 'id'], null, 'a.');
        const performedByExpr = colExpr(columns, ['performedBy', 'actorUserId'], null, 'a.');
        const actorUserIdExpr = coalesceExpr(columns, ['actorUserId', 'performedBy'], 'NULL', 'a.');
        const actionExpr = colExpr(columns, ['action'], null, 'a.');
        const moduleExpr = colExpr(columns, ['module'], null, 'a.');
        const entityTypeExpr = colExpr(columns, ['entityType'], null, 'a.');
        const entityIdExpr = colExpr(columns, ['entityId', 'targetId'], null, 'a.');
        const statusExpr = colExpr(columns, ['status'], null, 'a.');
        const severityExpr = colExpr(columns, ['severity'], null, 'a.');
        const detailExpr = columns.has('detail') ? 'CAST(a.detail AS CHAR)' : (columns.has('meta') ? 'CAST(a.meta AS CHAR)' : 'NULL');
        const ipAddressExpr = coalesceExpr(columns, ['ipAddress', 'ip'], 'NULL', 'a.');
        const userAgentExpr = colExpr(columns, ['userAgent'], null, 'a.');
        const requestIdExpr = colExpr(columns, ['requestId'], null, 'a.');
        const createdAtExpr = colExpr(columns, ['createdAt'], null, 'a.');
        const canJoinUsers = performedByExpr !== 'NULL' && userColumns.has('userId') && userColumns.has('userName');
        const actorNameExpr = canJoinUsers ? 'u.userName' : 'NULL';

        if (actionExpr === 'NULL' || createdAtExpr === 'NULL') {
            return codedError(res, 500, 'INTERNAL_ERROR', 'audit schema is not ready');
        }

        const sortableMap = {
            createdAt: createdAtExpr,
            logId: logIdExpr,
            action: actionExpr,
            module: moduleExpr,
            status: statusExpr,
            performedBy: performedByExpr,
            requestId: requestIdExpr,
        };

        const sortByInput = typeof req.query.sort_by === 'string' ? req.query.sort_by.trim() : '';
        const sortBy = sortByInput || 'createdAt';
        if (!sortableMap[sortBy] || sortableMap[sortBy] === 'NULL') {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }

        const sortOrderInput = typeof req.query.sort_order === 'string' ? req.query.sort_order.trim().toLowerCase() : '';
        if (sortOrderInput && !['asc', 'desc'].includes(sortOrderInput)) {
            return codedError(res, 400, 'VALIDATION_ERROR', 'invalid query param');
        }
        const sortOrder = sortOrderInput || 'desc';

        let whereSql = ' WHERE 1=1';
        const params = [];

        if (search) {
            const searchable = [];
            if (logIdExpr !== 'NULL') searchable.push(`CAST(${logIdExpr} AS CHAR) LIKE ?`);
            if (requestIdExpr !== 'NULL') searchable.push(`${requestIdExpr} LIKE ?`);
            if (entityIdExpr !== 'NULL') searchable.push(`${entityIdExpr} LIKE ?`);
            if (actionExpr !== 'NULL') searchable.push(`${actionExpr} LIKE ?`);

            if (searchable.length > 0) {
                whereSql += ` AND (${searchable.join(' OR ')})`;
                const likeValue = `%${search}%`;
                for (let i = 0; i < searchable.length; i += 1) {
                    params.push(likeValue);
                }
            }
        }

        if (performedBy !== null && performedByExpr !== 'NULL') {
            whereSql += ` AND ${performedByExpr} = ?`;
            params.push(performedBy);
        }

        if (moduleName && moduleExpr !== 'NULL') {
            whereSql += ` AND ${moduleExpr} = ?`;
            params.push(moduleName);
        }

        if (actionFilter && actionExpr !== 'NULL') {
            whereSql += ` AND ${actionExpr} = ?`;
            params.push(actionFilter);
        }

        if (status && statusExpr !== 'NULL') {
            whereSql += ` AND ${statusExpr} = ?`;
            params.push(status);
        }

        if (entityStatus && (columns.has('detail') || columns.has('meta'))) {
            const detailCol = columns.has('detail') ? 'a.detail' : 'a.meta';
            // Search across all known status keys in the JSON detail
            const jsonKeys = ['caseStatus', 'newStatus', 'pStatus', 'sentRepairStatus', 'current_status'];
            const jsonConditions = jsonKeys.map(
                (k) => `JSON_UNQUOTE(JSON_EXTRACT(${detailCol}, '$.${k}')) = ?`
            );
            whereSql += ` AND (${jsonConditions.join(' OR ')})`;
            for (let i = 0; i < jsonKeys.length; i += 1) {
                params.push(entityStatus);
            }
        }

        if (dateRange) {
            whereSql += ` AND ${createdAtExpr} BETWEEN ? AND ?`;
            params.push(dateRange.startAt, dateRange.endAt);
        }

        const offset = (page - 1) * itemsPerPage;

        const selectSql = `
            SELECT
                ${logIdExpr} AS logId,
                ${performedByExpr} AS performedBy,
                ${actorUserIdExpr} AS actorUserId,
                ${actorNameExpr} AS performedByName,
                ${actorNameExpr} AS actorUserName,
                ${actorNameExpr} AS actorName,
                ${actionExpr} AS action,
                ${moduleExpr} AS module,
                ${entityTypeExpr} AS entityType,
                ${entityIdExpr} AS entityId,
                ${statusExpr} AS status,
                ${severityExpr} AS severity,
                ${detailExpr} AS detail,
                ${ipAddressExpr} AS ipAddress,
                ${userAgentExpr} AS userAgent,
                ${requestIdExpr} AS requestId,
                ${createdAtExpr} AS createdAt
            FROM audit_logs a
            ${canJoinUsers ? `LEFT JOIN users u ON u.userId = ${performedByExpr}` : ''}
            ${whereSql}
            ORDER BY ${sortableMap[sortBy]} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}
            LIMIT ? OFFSET ?
        `;

        const countSql = `
            SELECT COUNT(*) AS totalItems
            FROM audit_logs a
            ${whereSql}
        `;

        const [rows] = await database.query(selectSql, [...params, itemsPerPage, offset]);
        const [countRows] = await database.query(countSql, params);

        return res.json({
            message: 'success',
            payload: {
                data: rows,
                totalItems: Number(countRows[0]?.totalItems || 0),
            },
        });
    } catch (error) {
        console.error('getAuditLogs error:', error);
        return codedError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
}

/**
 * Business-level entity statuses grouped by module.
 * These are stored inside the JSON `detail` column of audit_logs.
 */
const ENTITY_STATUSES = {
    repair: {
        label: 'สถานะงานซ่อม',
        keys: ['caseStatus', 'newStatus'],
        values: [
            'รอรับเครื่อง',
            'รับเครื่องแล้ว',
            'รออะไหล่',
            'รอสินค้า',
            'กำลังซ่อม',
            'ส่งซ่อม',
            'ส่งซ่อมอยู่',
            'ซ่อมเสร็จ',
            'ส่งมอบ',
            'ยกเลิก',
        ],
    },
    sentRepair: {
        label: 'สถานะส่งซ่อม',
        keys: ['sentRepairStatus', 'newStatus'],
        values: [
            'ส่งซ่อมอยู่',
            'รับคืนแล้ว',
        ],
    },
    project: {
        label: 'สถานะโปรเจกต์',
        keys: ['pStatus', 'newStatus'],
        values: [
            'รอดำเนินการ',
            'กำลังดำเนินการ',
            'เสร็จสิ้น',
        ],
    },
    quotation: {
        label: 'สถานะใบเสนอราคา',
        keys: ['current_status', 'newStatus'],
        values: [
            'QUOTATION',
            'DELIVERY_NOTE',
            'RECEIPT',
            'CANCELLED',
        ],
    },
};

export async function getAuditFilters(_req, res) {
    try {
        const columns = await getAuditColumns();

        const actionCol = columns.has('action') ? 'action' : null;
        const moduleCol = columns.has('module') ? 'module' : null;
        const statusCol = columns.has('status') ? 'status' : null;

        const results = { actions: [], modules: [], statuses: [], entityStatuses: ENTITY_STATUSES };

        if (actionCol) {
            const [rows] = await database.query(
                `SELECT DISTINCT ${actionCol} AS val FROM audit_logs WHERE ${actionCol} IS NOT NULL ORDER BY ${actionCol}`
            );
            results.actions = rows.map((r) => r.val);
        }
        if (!results.actions.length) {
            results.actions = [...AUDIT_ACTIONS];
        }

        if (moduleCol) {
            const [rows] = await database.query(
                `SELECT DISTINCT ${moduleCol} AS val FROM audit_logs WHERE ${moduleCol} IS NOT NULL ORDER BY ${moduleCol}`
            );
            results.modules = rows.map((r) => r.val);
        }
        if (!results.modules.length) {
            results.modules = [...AUDIT_MODULES];
        }

        if (statusCol) {
            const [rows] = await database.query(
                `SELECT DISTINCT ${statusCol} AS val FROM audit_logs WHERE ${statusCol} IS NOT NULL ORDER BY ${statusCol}`
            );
            results.statuses = rows.map((r) => r.val);
        }
        if (!results.statuses.length) {
            results.statuses = [...AUDIT_STATUS];
        }

        return res.json({ message: 'success', payload: results });
    } catch (error) {
        console.error('getAuditFilters error:', error);
        return codedError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
}
