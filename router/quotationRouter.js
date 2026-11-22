
import express from 'express';
import { 
    getQuotationById, 
    getAllQuotations,
    suggestQuotationCustomers,
    getNextQuotationDocId,
    getNextDeliveryDocId,
    suggestDeliveryNotes,
    getPriceHistory,
    getDeliveryNotesSummary,
    createQuotation, 
    updateQuotation, 
    deleteQuotation,
    getNextBorrowDocId,
    moveBorrowToQuotation,
    updateQuotationStatus
} from '../controller/quotationController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { getQuotationDashboard, getDashboardOrganizations } from '../controller/quotationDashboardController.js';

const router = express.Router();

const quotationChangeDetail = ({ req, res, responseBody }) => ({
    previous_status: res.locals.quotationBefore?.current_status,
    current_status: req.body.current_status,
    previous_delivery_note_no: res.locals.quotationBefore?.delivery_note_no,
    delivery_note_no: req.body.delivery_note_no,
    expected_current_status: req.body.expected_current_status,
    confirm_status_rollback: req.body.confirm_status_rollback,
    conflict_code: responseBody?.code,
});

router.use(optionalAuthenticate);

// Define routes
router.get("/get-quotation-info", getAllQuotations);
router.get('/quotation/dashboard', authenticate, getQuotationDashboard);
router.get('/quotation/dashboard/organizations', authenticate, getDashboardOrganizations);
router.get('/quotation/customers/suggest', suggestQuotationCustomers);
router.get('/quotation/delivery-notes/suggest', suggestDeliveryNotes);
router.get('/quotation/next-doc-id', getNextQuotationDocId);
router.get('/quotation/next-delivery-id', getNextDeliveryDocId);
router.get('/quotation/next-borrow-id', getNextBorrowDocId);
router.get('/quotation/price-history', getPriceHistory);
router.get('/quotation/delivery-notes-summary', getDeliveryNotesSummary);
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
    detailBuilder: quotationChangeDetail,
}), updateQuotation);
router.put('/quotation/:id/status', auditEvent({
    module: 'quotation',
    entityType: 'quotation',
    successAction: 'QUOTATION_STATUS_UPDATED',
    failAction: 'QUOTATION_STATUS_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
    detailBuilder: quotationChangeDetail,
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
