import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import memRouter from './router/memberRouter.js';
import repairRouter from './router/repairRouter.js';
import projectRouter from './router/projectRouter.js';
import sentRepairRouter from './router/sentRepairRouter.js';
import dashboardRouter from './router/dashboardRouter.js';

// 1. กำหนด Port ให้รองรับ Environment Variable (สำคัญมากสำหรับ Render)
const port = process.env.PORT || 3333;

const app = express();

// 2. แก้ CORS ให้ยอมรับ Domain ของ Hostinger
app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://127.0.0.1:5173',
        'https://employeedatacom.datacom-service.com' // <-- ใส่โดเมน Frontend ของคุณที่นี่ (ห้ามมี / ปิดท้าย)
    ],
    credentials: true 
}));

app.use(helmet());
app.use(compression());
app.use(express.json());

// เรียกใช้ Router
app.use(memRouter);
app.use(repairRouter);
app.use(projectRouter);
app.use(sentRepairRouter);
app.use(dashboardRouter);

// 3. เปลี่ยนตัวเลข 3333 เป็นตัวแปร port
app.listen(port, function () {
  console.log(`Server listening on port ${port}`);
});