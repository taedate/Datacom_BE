import express from 'express';
import {
    suggestCustomers,
    getAllCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer,
} from '../controller/customerController.js';
import { auditEvent } from '../middleware/auditTrail.js';
import { optionalAuthenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(optionalAuthenticate);

// Suggest (Autocomplete)
router.get('/customers/suggest', suggestCustomers);

// CRUD
router.get('/customers', getAllCustomers);
router.get('/customers/:id', getCustomerById);

router.post('/customers', auditEvent({
    module: 'customer',
    entityType: 'customer',
    successAction: 'CUSTOMER_CREATED',
    failAction: 'CUSTOMER_CREATED',
    failSeverity: 'warning',
    entityIdResolver: ({ responseBody }) => responseBody?.id || null,
}), createCustomer);

router.put('/customers/:id', auditEvent({
    module: 'customer',
    entityType: 'customer',
    successAction: 'CUSTOMER_UPDATED',
    failAction: 'CUSTOMER_UPDATED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), updateCustomer);

router.delete('/customers/:id', auditEvent({
    module: 'customer',
    entityType: 'customer',
    successAction: 'CUSTOMER_DELETED',
    failAction: 'CUSTOMER_DELETED',
    failSeverity: 'warning',
    entityIdResolver: ({ req }) => req.params?.id || null,
}), deleteCustomer);

export default router;
