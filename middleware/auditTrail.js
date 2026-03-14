import { getRequestAuditContext, writeAuditLog } from '../service/auditLogService.js';

function getResponseDetail(resBody) {
    if (!resBody || typeof resBody !== 'object') {
        return null;
    }

    if (typeof resBody.detail === 'string') {
        return resBody.detail;
    }

    if (typeof resBody.error === 'string') {
        return resBody.error;
    }

    if (typeof resBody.message === 'string' && resBody.message !== 'success') {
        return resBody.message;
    }

    return null;
}

export function auditEvent(config) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        let responseBody;

        res.json = (body) => {
            responseBody = body;
            return originalJson(body);
        };

        res.on('finish', () => {
            if (res.statusCode < 200) {
                return;
            }

            const success = res.statusCode < 400;
            const action = success ? config.successAction : (config.failAction || config.successAction);
            if (!action) {
                return;
            }
            const status = success ? 'success' : 'fail';
            const severity = success ? (config.successSeverity || 'info') : (config.failSeverity || 'warning');
            const requestAudit = getRequestAuditContext(req);

            const fallbackDetail = {
                route: req.originalUrl,
                method: req.method,
                statusCode: res.statusCode,
            };

            const reason = getResponseDetail(responseBody);
            if (reason && !success) {
                fallbackDetail.reason = reason;
            }

            const dynamicDetail = typeof config.detailBuilder === 'function'
                ? config.detailBuilder({ req, res, responseBody, success })
                : {};

            const payload = {
                ...requestAudit,
                action,
                module: config.module,
                entityType: config.entityType || null,
                entityId: typeof config.entityIdResolver === 'function'
                    ? config.entityIdResolver({ req, res, responseBody, success })
                    : null,
                status,
                severity,
                detail: { ...fallbackDetail, ...dynamicDetail },
            };

            req.__auditLogged = true;
            writeAuditLog(payload).catch((error) => {
                console.error('writeAuditLog error:', error.message);
            });
        });

        next();
    };
}

export function auditFallback() {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        let responseBody;

        res.json = (body) => {
            responseBody = body;
            return originalJson(body);
        };

        res.on('finish', () => {
            setImmediate(() => {
                if (req.__auditLogged || res.statusCode < 400) {
                    return;
                }

                let action = 'API_EXCEPTION';
                let severity = 'error';

                if (res.statusCode === 401 || res.statusCode === 403) {
                    action = 'FORBIDDEN_ACCESS';
                    severity = 'security';
                } else if (res.statusCode === 400 || res.statusCode === 422) {
                    action = 'VALIDATION_ERROR';
                    severity = 'warning';
                }

                const reason = getResponseDetail(responseBody);
                writeAuditLog({
                    ...getRequestAuditContext(req),
                    action,
                    module: 'system',
                    entityType: null,
                    entityId: null,
                    status: 'fail',
                    severity,
                    detail: {
                        route: req.originalUrl,
                        method: req.method,
                        statusCode: res.statusCode,
                        reason: reason || 'Unhandled route failure',
                    },
                }).catch((error) => {
                    console.error('auditFallback error:', error.message);
                });
            });
        });

        next();
    };
}
