import express from "express";
import * as dashC from '../controller/dashboardController.js'

const router = express.Router()

router.get('/dashboard/statistics', dashC.getDashboardStatistics)
router.get('/dashboard/recent-activities', dashC.getRecentActivities)

export default router
