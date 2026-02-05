import express from "express";
import * as pjCtrl from '../controller/projectController.js';

const router = express.Router();

router.get('/get-project-info', pjCtrl.getProjectInfo);
router.get('/get-project-detail/:id', pjCtrl.getProjectDetail);
router.post('/create-project', pjCtrl.createProject);
router.post('/update-project', pjCtrl.updateProject);
router.post('/delete-project', pjCtrl.deleteProject);

export default router;