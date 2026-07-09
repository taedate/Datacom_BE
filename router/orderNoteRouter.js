import express from 'express';
import { getNotes, createNote, deleteNote, updateNote, deleteNoteByQuotation } from '../controller/orderNoteController.js';

const router = express.Router();

router.get('/order-notes', getNotes);
router.post('/order-notes', createNote);
router.delete('/order-notes/by-quotation/:quotationId', deleteNoteByQuotation);
router.delete('/order-notes/:id', deleteNote);
router.put('/order-notes/:id', updateNote);

export default router;
