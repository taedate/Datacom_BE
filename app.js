import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Imports Routers ---
import memRouter from './router/memberRouter.js';
import repairRouter from './router/repairRouter.js';
import projectRouter from './router/projectRouter.js';
import sentRepairRouter from './router/sentRepairRouter.js';
import dashboardRouter from './router/dashboardRouter.js';
import quotationRouter from './router/quotationRouter.js';
import urgentOverviewRouter from './router/urgentOverviewRouter.js';
import lineBotRouter from './router/lineBotRouter.js';
import inviteRouter from './router/inviteRouter.js';
import auditLogRouter from './router/auditLogRouter.js';
import { startLineDigestJob } from './service/lineDigestJob.js';
import { requestContext } from './middleware/requestContext.js';
import { auditFallback } from './middleware/auditTrail.js';
import { startAuditRetentionJob } from './service/auditRetentionJob.js';
import { optionalAuthenticate } from './middleware/authenticate.js';

// --- Config สำหรับ ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.env.PORT || 3333;
const app = express();

// Trust first proxy (needed for accurate IP in express-rate-limit)
app.set('trust proxy', 1);

// --- 1. Config CORS ---
app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://127.0.0.1:5173',
        'https://employeedatacom.datacom-service.com',
        'https://datacom-service.com' // Domain Frontend
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// --- 2. Security & Optimization ---
// ปรับ Helmet ให้ยอมโหลดรูปข้าม Domain ได้ (Cross-Origin Resource Policy)
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());
app.use(express.json({
    verify: (req, _res, buf) => {
        // Keep raw body for webhook signature validation (e.g. LINE callback).
        req.rawBody = buf;
    }
}));

// Attach request metadata for consistent audit log records.
app.use(requestContext);
app.use(optionalAuthenticate);
app.use(auditFallback());

// --- 3. เปิดให้เข้าถึงโฟลเดอร์รูปภาพ (Static Files) ---
// สำคัญ: ต้องมีโฟลเดอร์ชื่อ 'uploads' อยู่ในระดับเดียวกับไฟล์นี้
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 5. Routes หลักของระบบ ---
app.use(memRouter);
app.use(repairRouter);
app.use(projectRouter);
app.use(sentRepairRouter);
app.use(dashboardRouter);
app.use(quotationRouter);
app.use(urgentOverviewRouter);
app.use(lineBotRouter);
app.use(inviteRouter);
app.use(auditLogRouter);

app.post('/__deploy-check', (req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// --- 6. Background Jobs ---
startLineDigestJob();
startAuditRetentionJob();

// --- Start Server ---
app.listen(port, function () {
  console.log(`Server listening on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/health-check`);
});