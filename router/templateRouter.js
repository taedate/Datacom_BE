import express from 'express';
import * as templateController from '../controller/templateController.js';
import { auditEvent } from '../middleware/auditTrail.js';

const router = express.Router();

router.get('/templates', templateController.getTemplates);
router.get('/templates/:id', templateController.getTemplateById);
const templateAudit = (action) => auditEvent({
    module: 'template', entityType: 'template', successAction: action, failAction: action,
    entityIdResolver: ({ req, responseBody }) => req.params?.id || responseBody?.id || null,
});
router.post('/templates', templateAudit('TEMPLATE_CREATED'), templateController.createTemplate);
router.put('/templates/:id', templateAudit('TEMPLATE_UPDATED'), templateController.updateTemplate);
router.delete('/templates/:id', templateAudit('TEMPLATE_DELETED'), templateController.deleteTemplate);

export default router;
