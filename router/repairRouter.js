import express from "express";
import * as repairController from '../controller/repairController.js';

const router = express.Router();

router.get('/get-case-info', repairController.getCaseInfo);
router.get('/get-filter-options', repairController.getFilterOptions);

router.get('/get-case-detail/:id', repairController.getCaseDetail); // สำหรับดึงข้อมูลแก้ไข
router.post('/create-case', repairController.createCase);           // สำหรับสร้างใหม่
router.post('/update-case', repairController.updateCase);

router.get('/print-case/:id', repairController.printCasePDF);

// router.post('/delete-case', repairController.deleteCase); // อย่าลืมทำเพิ่มถ้าจะใช้ปุ่มลบ

export default router;