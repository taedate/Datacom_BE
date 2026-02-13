import express from "express";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as pjCtrl from '../controller/projectController.js';

const router = express.Router();

// --- Storage Config: เก็บลงโฟลเดอร์ PJ-XXX โดยตรง ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 1. ดึง pId จากข้อมูลที่ส่งมา (เช่น PJ-018)
        // หมายเหตุ: Frontend ต้องส่ง pId มาใน FormData ด้วย
        const projectId = req.body.pId; 
        
        let folderPath = '';

        if (projectId) {
            // ถ้ามี pId ให้ลงโฟลเดอร์ของโปรเจกต์นั้นเลย
            folderPath = path.join(process.cwd(), 'uploads/projects', projectId);
        } else {
            // (เผื่อไว้) ถ้าไม่มี pId ให้ลงโฟลเดอร์กลาง (ป้องกัน Error)
            folderPath = path.join(process.cwd(), 'uploads/others');
        }
        
        // 2. สร้างโฟลเดอร์ถ้ายังไม่มี
        if (!fs.existsSync(folderPath)){
            fs.mkdirSync(folderPath, { recursive: true });
        }

        cb(null, folderPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

router.get('/get-project-info', pjCtrl.getProjectInfo);
router.get('/get-project-detail/:id', pjCtrl.getProjectDetail);

router.post('/create-project', upload.array('evidence_images', 10), pjCtrl.createProject); 
// ตอน update รูปจะวิ่งเข้าโฟลเดอร์ PJ-XXX ทันที
router.post('/update-project', upload.array('evidence_images', 10), pjCtrl.updateProject); 
router.post('/delete-project', pjCtrl.deleteProject);

export default router;