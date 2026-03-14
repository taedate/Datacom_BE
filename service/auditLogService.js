import database from './database.js';
import {
    AUDIT_ACTIONS,
    AUDIT_ENTITY_TYPES,
    AUDIT_MODULES,
    AUDIT_SEVERITY,
    AUDIT_STATUS,
} from './auditLogCatalog.js';

let auditLogColumnsPromise;

function normalizeUserId(value) {
    if (Number.isInteger(value) && value > 0) {
        return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return null;
}

function maskString(value, keepStart = 2, keepEnd = 1) {
    if (typeof value !== 'string') {
        return value;
    }
    if (value.length <= keepStart + keepEnd) {
        return '*'.repeat(Math.max(3, value.length));
    }
    return `${value.slice(0, keepStart)}***${value.slice(-keepEnd)}`;
}

function sanitizeDetail(value, keyName = '') {
    if (value === null || value === undefined) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeDetail(item, keyName));
    }

    if (typeof value === 'object') {
        const sanitized = {};
        for (const [key, entryValue] of Object.entries(value)) {
            if (/(password|token|secret|authorization|jwt|hash)/i.test(key)) {
                continue;
            }
            sanitized[key] = sanitizeDetail(entryValue, key);
        }
        return sanitized;
    }

    if (typeof value === 'string' && /(username|userName|phone|tax|email|address)/i.test(keyName)) {
        return maskString(value);
    }

    return value;
}

function toJsonString(detail) {
    const safe = sanitizeDetail(detail || {});
    return JSON.stringify(safe);
}

async function getAuditLogColumns(conn) {
    if (!auditLogColumnsPromise) {
        auditLogColumnsPromise = conn.query(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'audit_logs'`
        )
            .then(([rows]) => new Set(rows.map((row) => row.COLUMN_NAME)))
            .catch((err) => {
                auditLogColumnsPromise = null;
                throw err;
            });
    }
    return auditLogColumnsPromise;
}

function normalizePayload(payload) {
    const action = AUDIT_ACTIONS.has(payload.action) ? payload.action : 'API_EXCEPTION';
    const moduleName = AUDIT_MODULES.has(payload.module) ? payload.module : 'system';
    const status = AUDIT_STATUS.has(payload.status) ? payload.status : 'fail';

    let severity = payload.severity;
    if (!AUDIT_SEVERITY.has(severity)) {
        if (status === 'success') {
            severity = 'info';
        } else if (action === 'FORBIDDEN_ACCESS') {
            severity = 'security';
        } else if (action === 'VALIDATION_ERROR') {
            severity = 'warning';
        } else {
            severity = 'error';
        }
    }

    const entityType = AUDIT_ENTITY_TYPES.has(payload.entityType) ? payload.entityType : null;
    const performedBy = normalizeUserId(payload.performedBy);

    return {
        performedBy,
        action,
        module: moduleName,
        entityType,
        entityId: payload.entityId ? String(payload.entityId) : null,
        status,
        severity,
        detailJson: toJsonString(payload.detail),
        ipAddress: payload.ipAddress || null,
        userAgent: payload.userAgent || null,
        requestId: payload.requestId || null,
        createdAt: payload.createdAt || new Date(),
    };
}

export async function writeAuditLog(payload, options = {}) {
    const conn = options.conn || database;
    const availableColumns = await getAuditLogColumns(conn);
    const normalized = normalizePayload(payload);

    const valuesByColumn = {
        performedBy: normalized.performedBy,
        action: normalized.action,
        module: normalized.module,
        entityType: normalized.entityType,
        entityId: normalized.entityId,
        status: normalized.status,
        severity: normalized.severity,
        detail: normalized.detailJson,
        meta: normalized.detailJson,
        ipAddress: normalized.ipAddress,
        ip: normalized.ipAddress,
        userAgent: normalized.userAgent,
        requestId: normalized.requestId,
        createdAt: normalized.createdAt,
    };

    const priorityColumns = [
        'performedBy',
        'action',
        'module',
        'entityType',
        'entityId',
        'status',
        'severity',
        'detail',
        'meta',
        'ipAddress',
        'ip',
        'userAgent',
        'requestId',
        'createdAt',
    ];

    const insertColumns = [];
    const params = [];

    for (const column of priorityColumns) {
        if (!availableColumns.has(column)) {
            continue;
        }

        // Prefer detail over meta and ipAddress over ip when both exist.
        if (column === 'meta' && availableColumns.has('detail')) {
            continue;
        }
        if (column === 'ip' && availableColumns.has('ipAddress')) {
            continue;
        }

        insertColumns.push(column);
        params.push(valuesByColumn[column]);
    }

    if (!insertColumns.includes('action')) {
        return;
    }

    const placeholders = insertColumns.map(() => '?').join(', ');
    const sql = `INSERT INTO audit_logs (${insertColumns.join(', ')}) VALUES (${placeholders})`;
    await conn.query(sql, params);
}

export function getRequestAuditContext(req) {
    return {
        performedBy: normalizeUserId(req.user?.userId),
        ipAddress: req.clientIp || req.ip || null,
        userAgent: req.userAgent || req.headers['user-agent'] || null,
        requestId: req.requestId || null,
    };
}
