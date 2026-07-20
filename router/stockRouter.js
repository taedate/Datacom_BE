import express from 'express';
import {
    getStocks,
    createStock,
    updateStock,
    deleteStock,
    getStockCategories
} from '../controller/stockController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

// Get distinct stock categories
router.get('/stocks/categories', getStockCategories);

// Get stocks list
router.get('/stocks', getStocks);

// Create new stock record
router.post('/stocks', auditEvent({
    module: 'stock',
    entityType: 'stock',
    successAction: 'STOCK_CREATED',
    failAction: 'STOCK_CREATED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.id || null,
}), createStock);

// Update existing stock record
router.put('/stocks/:id', auditEvent({
    module: 'stock',
    entityType: 'stock',
    successAction: 'STOCK_UPDATED',
    failAction: 'STOCK_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), updateStock);

// Delete stock record
router.delete('/stocks/:id', auditEvent({
    module: 'stock',
    entityType: 'stock',
    successAction: 'STOCK_DELETED',
    failAction: 'STOCK_DELETED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), deleteStock);

export default router;
