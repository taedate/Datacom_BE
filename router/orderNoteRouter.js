import express from 'express';
import { getNotes, createNote, deleteNote, updateNote, deleteNoteByQuotation } from '../controller/orderNoteController.js';
import { auditEvent } from '../middleware/auditTrail.js';

const router = express.Router();

router.get('/order-notes', getNotes);
const noteAudit = (action) => auditEvent({
    module: 'order_note', entityType: 'order_note', successAction: action, failAction: action,
    entityIdResolver: ({ req, responseBody }) => req.params?.id || responseBody?.id || null,
});
router.post('/order-notes', noteAudit('ORDER_NOTE_CREATED'), createNote);
router.delete('/order-notes/by-quotation/:quotationId', noteAudit('ORDER_NOTE_DELETED'), deleteNoteByQuotation);
router.delete('/order-notes/:id', noteAudit('ORDER_NOTE_DELETED'), deleteNote);
router.put('/order-notes/:id', noteAudit('ORDER_NOTE_UPDATED'), updateNote);

export default router;
