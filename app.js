import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import memRouter from './router/memberRouter.js';
import repairRouter from './router/repairRouter.js';
import projectRouter from './router/projectRouter.js';
import sentRepairRouter from './router/sentRepairRouter.js';

const app = express();

app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], // ใส่ URL ของ Frontend (Vite ปกติคือ 5173)
    credentials: true // อนุญาตให้ส่ง Cookies/Auth headers
}));
app.use(bodyParser.json());

// เรียกใช้ Router
app.use(memRouter);
app.use(repairRouter);
app.use(projectRouter);
app.use(sentRepairRouter);

app.listen(3333, function () {
  console.log('CORS-enabled web server listening on port 3333');
});