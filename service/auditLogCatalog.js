export const AUDIT_MODULES = new Set([
    'auth',
    'invite',
    'user',
    'repair',
    'sentRepair',
    'project',
    'quotation',
    'system',
]);

export const AUDIT_STATUS = new Set(['success', 'fail']);

export const AUDIT_SEVERITY = new Set(['info', 'warning', 'error', 'security']);

export const AUDIT_ENTITY_TYPES = new Set([
    'user',
    'invite',
    'caseRepair',
    'caseSentRepair',
    'project',
    'quotation',
]);

export const AUDIT_ACTIONS = new Set([
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGOUT_SUCCESS',
    'TOKEN_INVALID',
    'SESSION_EXPIRED',

    'INVITE_CREATED',
    'INVITE_VALIDATED',
    'INVITE_VALIDATION_FAILED',
    'INVITE_REVOKED',
    'REGISTER_BY_INVITE_SUCCESS',
    'REGISTER_BY_INVITE_FAILED',

    'USER_CREATED',
    'USER_UPDATED',
    'USER_DISABLED',
    'USER_ENABLED',
    'USER_ROLE_CHANGED',

    'CASE_CREATED',
    'CASE_UPDATED',
    'CASE_STATUS_CHANGED',
    'CASE_DELETED',
    'CASE_PRINTED',

    'SENT_REPAIR_CREATED',
    'SENT_REPAIR_UPDATED',
    'SENT_REPAIR_RECEIVED',
    'SENT_REPAIR_DELETED',
    'SENT_REPAIR_PRINTED',

    'PROJECT_CREATED',
    'PROJECT_UPDATED',
    'PROJECT_STATUS_CHANGED',
    'PROJECT_DELETED',

    'QUOTATION_CREATED',
    'QUOTATION_UPDATED',
    'QUOTATION_STATUS_CHANGED',
    'QUOTATION_DELETED',
    'QUOTATION_EXPORTED',

    'FORBIDDEN_ACCESS',
    'VALIDATION_ERROR',
    'API_EXCEPTION',
    'HEALTHCHECK_FAILED',
]);
