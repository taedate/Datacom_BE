import express from 'express';
import * as sentRepairController from '../controller/sentRepairController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';


const router = express.Router();

router.use(optionalAuthenticate);

// Get List
router.get('/get-sent-repair-info', sentRepairController.getSentRepairInfo);

// Get Detail
router.get('/get-sent-repair-detail/:id', sentRepairController.getSentRepairDetail);

// Create
router.post('/create-sent-repair', auditEvent({
	module: 'sentRepair',
	entityType: 'caseSentRepair',
	successAction: 'SENT_REPAIR_CREATED',
	failAction: 'SENT_REPAIR_CREATED',
	failSeverity: 'warning',
	entityIdResolver: ({ responseBody }) => responseBody?.caseSId || null,
}), sentRepairController.createSentRepair);

// Update
router.post('/update-sent-repair', auditEvent({
	module: 'sentRepair',
	entityType: 'caseSentRepair',
	successAction: 'SENT_REPAIR_UPDATED',
	failAction: 'SENT_REPAIR_UPDATED',
	failSeverity: 'warning',
	entityIdResolver: ({ req }) => req.body?.caseSId || null,
}), sentRepairController.updateSentRepair);

// Delete
router.post('/delete-sent-repair', auditEvent({
	module: 'sentRepair',
	entityType: 'caseSentRepair',
	successAction: 'SENT_REPAIR_DELETED',
	failAction: 'SENT_REPAIR_DELETED',
	failSeverity: 'warning',
	entityIdResolver: ({ req }) => req.body?.caseSId || null,
}), sentRepairController.deleteSentRepair);


export default router;