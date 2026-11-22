import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { getSharedNotes, createSharedNote, updateSharedNote, deleteSharedNote, getSharedNoteAttachment } from '../controller/sharedNoteController.js';
import { sharedNoteUpload } from '../middleware/sharedNoteUpload.js';

const router = express.Router();
router.use('/shared-notes', authenticate);
router.get('/shared-notes', getSharedNotes);
router.get('/shared-notes/:id/attachments/:attachmentId', getSharedNoteAttachment);
router.get('/shared-notes/:id/attachments/:attachmentId/:variant(thumbnail)', getSharedNoteAttachment);

function audit(operation) {
    return auditEvent({
        module: 'shared_note', entityType: 'shared_note',
        successAction: `SHARED_NOTE_${operation}`, failSeverity: 'warning',
        entityIdResolver: ({ req, responseBody }) => req.params?.id || responseBody?.id || null,
    });
}

router.post('/shared-notes', sharedNoteUpload, audit('CREATED'), createSharedNote);
router.put('/shared-notes/:id', sharedNoteUpload, audit('UPDATED'), updateSharedNote);
router.delete('/shared-notes/:id', audit('DELETED'), deleteSharedNote);
export default router;
