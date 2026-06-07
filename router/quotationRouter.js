
import express from 'express';
import { 
    getQuotationById, 
    getAllQuotations,
    suggestQuotationCustomers,
    getNextQuotationDocId,
    getNextDeliveryDocId,
    getPriceHistory,
    createQuotation, 
    updateQuotation, 
    deleteQuotation,
    getNextBorrowDocId,
    moveBorrowToQuotation,
    updateQuotationStatus
} from '../controller/quotationController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

// Define routes
router.get("/get-quotation-info", getAllQuotations);
router.get('/quotation/customers/suggest', suggestQuotationCustomers);
router.get('/quotation/next-doc-id', getNextQuotationDocId);
router.get('/quotation/next-delivery-id', getNextDeliveryDocId);
router.get('/quotation/next-borrow-id', getNextBorrowDocId);
router.get('/quotation/price-history', getPriceHistory);
router.post('/quotation/move-borrow-to-quotation/:id', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'BORROW_CONVERTED_TO_QUOTATION',
    failAction: 'BORROW_CONVERTED_TO_QUOTATION',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), moveBorrowToQuotation);
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
router.put('/quotation/:id/status', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_STATUS_UPDATED',
    failAction: 'QUOTATION_STATUS_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), updateQuotationStatus);
router.delete('/quotation/:id', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_DELETED',
    failAction: 'QUOTATION_DELETED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), deleteQuotation);

export default router;
