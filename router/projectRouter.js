import express from "express";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as pjCtrl from '../controller/projectController.js';

const router = express.Router();

// --- ตั้งค่า Multer (Storage Config) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // ใช้ process.cwd() เพื่อให้มั่นใจว่าโฟลเดอร์จะอยู่ที่ Root ของโปรเจกต์เสมอ
        // ไม่ว่าจะรันไฟล์จากไหน
        const dir = path.join(process.cwd(), 'uploads/projects');
        
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // ตั้งชื่อไฟล์: PJ-TIMESTAMP-RANDOM.jpg
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'PJ-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Routes
router.get('/get-project-info', pjCtrl.getProjectInfo);
router.get('/get-project-detail/:id', pjCtrl.getProjectDetail);

// ตรวจสอบชื่อ field ให้ตรงกับ Frontend ('evidence_images')
router.post('/create-project', upload.array('evidence_images', 10), pjCtrl.createProject);
router.post('/update-project', upload.array('evidence_images', 10), pjCtrl.updateProject);
router.post('/delete-project', pjCtrl.deleteProject);

export default router;