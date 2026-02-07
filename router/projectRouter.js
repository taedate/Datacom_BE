import express from "express";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as pjCtrl from '../controller/projectController.js';

const router = express.Router();

// --- ตั้งค่า Multer (Storage Config) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // สร้างโฟลเดอร์ uploads/projects ถ้ายังไม่มี
        const dir = 'uploads/projects/';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // ตั้งชื่อไฟล์: PJ-XXX-Timestamp.jpg
        const uniqueSuffix = Date.now() + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

router.get('/get-project-info', pjCtrl.getProjectInfo);
router.get('/get-project-detail/:id', pjCtrl.getProjectDetail);
router.post('/create-project', upload.array('evidence_images', 10), pjCtrl.createProject);
router.post('/update-project', upload.array('evidence_images', 10), pjCtrl.updateProject);
router.post('/delete-project', pjCtrl.deleteProject);

export default router;