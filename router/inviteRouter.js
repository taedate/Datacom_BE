import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import * as inviteC from '../controller/inviteController.js';
import { auditEvent } from '../middleware/auditTrail.js';

const router = express.Router();

// Rate limiters  ─────────────────────────────────────────────────────────────
const validateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'error', code: 'RATE_LIMITED', detail: 'Too many requests, please try again later' },
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'error', code: 'RATE_LIMITED', detail: 'Too many registration attempts, please try again later' },
});

// Routes  ─────────────────────────────────────────────────────────────────────

// Admin: create invite
router.post('/invites', authenticate, requireRole('admin'), auditEvent({
    module: 'invite',
    entityType: 'invite',
    successAction: 'INVITE_CREATED',
    failAction: 'INVITE_VALIDATION_FAILED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.payload?.inviteId || null,
    detailBuilder: ({ req, responseBody }) => ({
        invitedUserName: req.body?.invitedUserName || null,
        role: req.body?.role || null,
        expireMinutes: req.body?.expireMinutes || null,
        inviteId: responseBody?.payload?.inviteId || null,
    }),
}), inviteC.createInvite);

// Public: validate token (rate-limited)
router.get('/invites/validate', validateLimiter, auditEvent({
    module: 'invite',
    entityType: 'invite',
    successAction: 'INVITE_VALIDATED',
    failAction: 'INVITE_VALIDATION_FAILED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.payload?.inviteId || null,
}), inviteC.validateInvite);

// Public: register via invite (rate-limited)
router.post('/register-by-invite', registerLimiter, auditEvent({
    module: 'invite',
    entityType: 'user',
    successAction: 'REGISTER_BY_INVITE_SUCCESS',
    failAction: 'REGISTER_BY_INVITE_FAILED',
    failSeverity: 'security',
    entityIdResolver: ({ responseBody }) => responseBody?.payload?.userId || null,
    detailBuilder: ({ responseBody }) => ({
        userName: responseBody?.payload?.userName || null,
        role: responseBody?.payload?.role || null,
    }),
}), inviteC.registerByInvite);

// Admin: revoke invite
router.post('/invites/:id/revoke', authenticate, requireRole('admin'), auditEvent({
    module: 'invite',
    entityType: 'invite',
    successAction: 'INVITE_REVOKED',
    failAction: 'INVITE_VALIDATION_FAILED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), inviteC.revokeInvite);

// Admin: list invites
router.get('/invites', authenticate, requireRole('admin'), inviteC.listInvites);

export default router;
