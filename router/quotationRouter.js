
import express from 'express';
import { 
    getQuotationById, 
    getAllQuotations,
    createQuotation, 
    updateQuotation, 
    deleteQuotation 
} from '../controller/quotationController.js';

const router = express.Router();

// Define routes
router.get("/get-quotation-info", getAllQuotations);
router.get('/quotation/:id', getQuotationById);
router.post('/quotation', createQuotation);
router.put('/quotation/:id', updateQuotation);
router.delete('/quotation/:id', deleteQuotation);

export default router;
