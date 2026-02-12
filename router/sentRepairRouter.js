import express from 'express';
import * as sentRepairController from '../controller/sentRepairController.js';


const router = express.Router();

// Get List
router.get('/get-sent-repair-info', sentRepairController.getSentRepairInfo);

// Get Detail
router.get('/get-sent-repair-detail/:id', sentRepairController.getSentRepairDetail);

// Create
router.post('/create-sent-repair', sentRepairController.createSentRepair);

// Update
router.post('/update-sent-repair', sentRepairController.updateSentRepair);

// Delete
router.post('/delete-sent-repair', sentRepairController.deleteSentRepair);


export default router;