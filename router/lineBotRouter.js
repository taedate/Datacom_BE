import express from 'express';
import * as lineBotController from '../controller/lineBotController.js';

const router = express.Router();

router.post('/callback', lineBotController.callback);
router.get('/imagemap/help/:size', lineBotController.serveHelpImagemap);
router.post('/line/digest-now', lineBotController.triggerDigestNow);

export default router;
