
import express from 'express';
import { 
    getQuotationById, 
    getAllQuotations,
    suggestQuotationCustomers,
    createQuotation, 
    updateQuotation, 
    deleteQuotation 
} from '../controller/quotationController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

// Define routes
router.get("/get-quotation-info", getAllQuotations);
router.get('/quotation/customers/suggest', suggestQuotationCustomers);
router.get('/quotation/:id', getQuotationById);
router.post('/quotation', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_CREATED',
    failAction: 'QUOTATION_CREATED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.id || null,
}), createQuotation);
router.put('/quotation/:id', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_UPDATED',
    failAction: 'QUOTATION_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), updateQuotation);
router.delete('/quotation/:id', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_DELETED',
    failAction: 'QUOTATION_DELETED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), deleteQuotation);

export default router;
