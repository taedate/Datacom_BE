import { getRequestAuditContext, writeAuditLog } from '../service/auditLogService.js';
import { auditChanges, publicAuditSnapshot, readAuditSnapshot, readRelatedAuditSnapshots, resolveAuditId } from '../service/auditEntityService.js';

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
    return async (req, res, next) => {
        const originalJson = res.json.bind(res);
        let before = null;
        let relatedBefore = [];
        let captureWarning = null;
        try {
            const id = await resolveAuditId(config, req);
            before = await readAuditSnapshot(config.entityType, id);
            relatedBefore = await readRelatedAuditSnapshots(config, req, before);
        } catch (error) {
            captureWarning = 'อ่านข้อมูลก่อนเปลี่ยนแปลงไม่สำเร็จ';
            console.error('Audit snapshot failed:', error.message);
        }

        async function recordEvent(responseBody) {
            const success = res.statusCode < 400;
            let action = success ? config.successAction : (config.failAction || config.successAction);
            if (!action || (success && action === 'INVITE_VALIDATED')) return;
            const entityId = await resolveAuditId(config, req, responseBody) ?? before?.entityId;
            // Controllers with transactions provide snapshots taken under their row lock.
            before = res.locals.auditSnapshots?.before ?? before;
            let after = null;
            const related = [];
            if (success) {
                try {
                    after = res.locals.auditSnapshots?.after ?? await readAuditSnapshot(config.entityType, entityId);
                    for (const previous of relatedBefore) {
                        const current = await readAuditSnapshot(previous.entityType, previous.entityId);
                        const changes = auditChanges(previous, current);
                        if (changes.length) related.push({ entityType: previous.entityType, entityId: previous.entityId, before: publicAuditSnapshot(previous), after: publicAuditSnapshot(current), changes });
                    }
                    if (responseBody?.new_id && action === 'BORROW_CONVERTED_TO_QUOTATION') {
                        const created = await readAuditSnapshot('quotation', responseBody.new_id);
                        related.push({ entityType: 'quotation', entityId: responseBody.new_id, after: publicAuditSnapshot(created), changes: [] });
                    }
                } catch (error) {
                    captureWarning = 'อ่านข้อมูลหลังเปลี่ยนแปลงไม่สำเร็จ';
                    console.error('Audit snapshot failed:', error.message);
                }
            }
            const changes = success ? auditChanges(before, after) : [];
            const isUpdate = /UPDATED|STATUS_CHANGED/.test(action) || responseBody?.updated;
            if (success && !captureWarning && ((isUpdate && before && after && !changes.length && !related.length) || responseBody?.deletedCount === 0)) return;

            const snapshot = after || before;
            const borrowed = snapshot?.fields.is_borrow === 1;
            if (success && config.entityType === 'quotation' && action !== 'BORROW_CONVERTED_TO_QUOTATION') {
                const operation = /DELETED/.test(action) ? 'DELETED' : before ? 'UPDATED' : 'CREATED';
                action = `${borrowed ? 'BORROW' : 'QUOTATION'}_${operation}`;
                if (changes.some(change => change.field === (borrowed ? 'borrow_status' : 'current_status'))) action = borrowed ? 'BORROW_STATUS_CHANGED' : 'QUOTATION_STATUS_CHANGED';
            }
            if (success && changes.some(change => change.field === 'caseStatus')) action = 'CASE_STATUS_CHANGED';
            if (success && changes.some(change => change.field === 'pStatus')) action = 'PROJECT_STATUS_CHANGED';
            if (success && changes.some(change => change.field === 'sentRepairStatus' && change.after === 'รับคืนแล้ว')) action = 'SENT_REPAIR_RECEIVED';
            if (success && config.entityType === 'order_note' && responseBody?.updated) action = 'ORDER_NOTE_UPDATED';
            const status = success ? 'success' : 'fail';
            const severity = success ? (config.successSeverity || 'info') : (config.failSeverity || 'warning');
            const requestAudit = getRequestAuditContext(req);
            const detail = {
                route: (req.originalUrl || req.url || '').split('?')[0],
                method: req.method,
                statusCode: res.statusCode,
                actorName: req.user?.userName || (success && config.module === 'auth' ? responseBody?.payload?.userName : null),
                recordName: snapshot?.name || null,
                before: publicAuditSnapshot(before),
                after: publicAuditSnapshot(after),
                changes,
                related,
                ...(captureWarning && { captureWarning }),
            };
            const reason = getResponseDetail(responseBody);
            if (reason && !success) detail.reason = reason;
            const dynamicDetail = typeof config.detailBuilder === 'function'
                ? config.detailBuilder({ req, res, responseBody, success })
                : {};
            // Failure details describe an attempted action, never a completed change.
            if (!success && req.body?.current_status) detail.attempted_status = req.body.current_status;
            const payload = {
                ...requestAudit,
                performedBy: requestAudit.performedBy || (success && config.module === 'auth' ? responseBody?.payload?.userId || responseBody?.userId : null),
                action,
                module: config.module,
                entityType: config.entityType || null,
                entityId,
                status,
                severity,
                detail: { ...dynamicDetail, ...detail },
            };
            await writeAuditLog(payload);
        }

        res.json = (body) => {
            res.json = originalJson;
            req.__auditLogged = true;
            // Finish the logging attempt before returning the response.
            res.locals.auditPromise = recordEvent(body).catch((error) => {
                console.error('writeAuditLog error:', error.message);
            }).finally(() => {
                originalJson(body);
            });
            return res;
        };
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
                        route: (req.originalUrl || req.url || '').split('?')[0],
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
