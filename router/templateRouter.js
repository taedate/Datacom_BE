import express from 'express';
import * as templateController from '../controller/templateController.js';
import { authenticate } from '../middleware/authenticate.js'; // Ensure authenticate exists, or omit if not needed

const router = express.Router();

router.get('/templates', templateController.getTemplates);
router.get('/templates/:id', templateController.getTemplateById);
router.post('/templates', templateController.createTemplate);
router.put('/templates/:id', templateController.updateTemplate);
router.delete('/templates/:id', templateController.deleteTemplate);

export default router;
