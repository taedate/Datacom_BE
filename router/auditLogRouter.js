import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { getAuditLogs, getAuditFilters } from '../controller/auditLogController.js';

const router = express.Router();

export function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'error', code: 'FORBIDDEN', detail: 'Admin only' });
    }
    return next();
}

router.get('/audit-logs', authenticate, requireAdmin, getAuditLogs);
router.get('/audit-logs/filters', authenticate, requireAdmin, getAuditFilters);

export default router;
