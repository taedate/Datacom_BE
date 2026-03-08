import express from 'express';
import { getUrgentOverview, getUrgentOverviewDigest } from '../controller/urgentOverviewController.js';

const router = express.Router();

router.get('/urgent-overview', getUrgentOverview);
router.get('/urgent-overview/digest', getUrgentOverviewDigest);

export default router;
