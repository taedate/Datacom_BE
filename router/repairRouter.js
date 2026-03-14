import express from "express";
import * as repairController from '../controller/repairController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

router.get('/get-case-info', repairController.getCaseInfo);
router.get('/get-filter-options', repairController.getFilterOptions);

router.get('/get-case-detail/:id', repairController.getCaseDetail); // สำหรับดึงข้อมูลแก้ไข
router.post('/create-case', auditEvent({
	module: 'repair',
	entityType: 'caseRepair',
	successAction: 'CASE_CREATED',
	failAction: 'CASE_CREATED',
	failSeverity: 'warning',
	entityIdResolver: ({ responseBody }) => responseBody?.caseId || null,
	detailBuilder: ({ req, responseBody }) => ({
		caseId: responseBody?.caseId || null,
		caseType: req.body?.caseType || null,
		caseStatus: req.body?.caseStatus || null,
	}),
}), repairController.createCase);           // สำหรับสร้างใหม่
router.post('/update-case', auditEvent({
	module: 'repair',
	entityType: 'caseRepair',
	successAction: 'CASE_UPDATED',
	failAction: 'CASE_UPDATED',
	failSeverity: 'warning',
	entityIdResolver: ({ req }) => req.body?.caseId || null,
	detailBuilder: ({ req }) => ({
		caseId: req.body?.caseId || null,
		newStatus: req.body?.caseStatus || null,
	}),
}), repairController.updateCase);

// router.post('/delete-case', repairController.deleteCase); // อย่าลืมทำเพิ่มถ้าจะใช้ปุ่มลบ
router.get('/tracking-status', repairController.getTrackingByPhone);

export default router;