import express from 'express';
import {
    getInkPrices,
    createInkPrice,
    updateInkPrice,
    deleteInkPrice
} from '../controller/inkPriceController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

// Get ink prices list
router.get('/ink-prices', getInkPrices);

// Create new ink price entry
router.post('/ink-prices', auditEvent({
    module: 'ink_price',
    entityType: 'ink_price',
    successAction: 'INK_PRICE_CREATED',
    failAction: 'INK_PRICE_CREATED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.id || null,
}), createInkPrice);

// Update existing ink price entry
router.put('/ink-prices/:id', auditEvent({
    module: 'ink_price',
    entityType: 'ink_price',
    successAction: 'INK_PRICE_UPDATED',
    failAction: 'INK_PRICE_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), updateInkPrice);

// Delete ink price entry
router.delete('/ink-prices/:id', auditEvent({
    module: 'ink_price',
    entityType: 'ink_price',
    successAction: 'INK_PRICE_DELETED',
    failAction: 'INK_PRICE_DELETED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), deleteInkPrice);

export default router;
