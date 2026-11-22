import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { auditEvent } from '../middleware/auditTrail.js';
import * as controller from '../controller/productDescriptionController.js';

const router = express.Router();
const audit = action => auditEvent({ module: 'product_description', entityType: 'product_description', successAction: action, failAction: action, entityIdResolver: ({ req, responseBody }) => req.params.id || responseBody?.id });
router.get('/product-descriptions/suggestions', authenticate, controller.suggestProductDescriptions);
router.get('/product-descriptions', authenticate, controller.listProductDescriptions);
router.post('/product-descriptions', authenticate, audit('PRODUCT_DESCRIPTION_CREATED'), controller.createProductDescription);
router.put('/product-descriptions/:id', authenticate, audit('PRODUCT_DESCRIPTION_UPDATED'), controller.updateProductDescription);
router.delete('/product-descriptions/:id', authenticate, audit('PRODUCT_DESCRIPTION_DELETED'), controller.deleteProductDescription);
export default router;
