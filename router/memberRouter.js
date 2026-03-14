import express from "express";
import * as memC from '../controller/memberController.js'
import { auditEvent } from '../middleware/auditTrail.js';

const router = express.Router()
router.post('/register', memC.memberRegister)
router.post('/login', auditEvent({
	module: 'auth',
	entityType: 'user',
	successAction: 'LOGIN_SUCCESS',
	failAction: 'LOGIN_FAILED',
	failSeverity: 'security',
	detailBuilder: ({ req, success, responseBody }) => ({
		username: req.body?.userName || null,
		attemptCount: 1,
		reason: success ? null : (responseBody?.detail || responseBody?.error || 'Invalid credentials'),
	}),
}), memC.memberLogin)
router.get('/authen', auditEvent({
	module: 'auth',
	entityType: 'user',
	successAction: null,
	failAction: 'TOKEN_INVALID',
	failSeverity: 'security',
}), memC.memberAuthen)
router.post('/logout', auditEvent({
	module: 'auth',
	entityType: 'user',
	successAction: 'LOGOUT_SUCCESS',
	failAction: 'TOKEN_INVALID',
	failSeverity: 'security',
}), memC.memberLogout)
router.get('/health-check', memC.systemHealthCheck)

export default router