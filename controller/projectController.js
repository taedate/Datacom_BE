import database from "../service/database.js";
import { postToFacebook } from "../service/facebookService.js";
import path from 'path';

// 1. ดึงข้อมูลลงตาราง (Search + Filter + Pagination)
export async function getProjectInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, pStatus, dateRange, sort_by, sort_order } = req.query;
        const offset = (page - 1) * itemsPerPage;
        const limit = Number(itemsPerPage) || 10;

        let sql = `SELECT * FROM caseProject WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM caseProject WHERE 1=1`;
        let params = [];

        if (search) {
            const term = `%${search}%`;
            const cond = ` AND (pId LIKE ? OR pAddress LIKE ? OR pDetail LIKE ?)`;
            sql += cond; countSql += cond;
            params.push(term, term, term);
        }

        if (pStatus) {
            sql += ` AND pStatus = ?`; countSql += ` AND pStatus = ?`;
            params.push(pStatus);
        }

        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) {
                 sql += ` AND dateCreate BETWEEN ? AND ?`;
                 countSql += ` AND dateCreate BETWEEN ? AND ?`;
                 params.push(start, end);
             }
        }

        if (sort_by) {
            sql += ` ORDER BY ${sort_by} ${sort_order === 'desc' ? 'DESC' : 'ASC'}`;
        } else {
            sql += ` ORDER BY pId DESC`; // Default sort
        }

        const queryParams = [...params, Number(limit), Number(offset)];
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);

        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}

// 2. ดึงรายละเอียดตาม ID
export async function getProjectDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseProject WHERE pId = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Project not found' });
        }

        res.json({ message: 'success', data: rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 3. สร้างงานติดตั้งใหม่ (สร้างเอกสารก่อน ยังไม่มีรูป)
export async function createProject(req, res) {
    try {
        const { pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // --- Gen ID (PJ-XXX) ---
        const [lastRows] = await database.query(
            `SELECT pId FROM caseProject WHERE pId LIKE 'PJ-%' ORDER BY LENGTH(pId) DESC, pId DESC LIMIT 1`
        );
        let newId = "PJ-001";
        if (lastRows.length > 0) {
            const lastId = lastRows[0].pId;
            const parts = lastId.split('-');
            if (parts.length === 2) {
                const lastNum = parseInt(parts[1]); 
                newId = `PJ-${String(lastNum + 1).padStart(3, '0')}`;
            }
        }

        const sql = `INSERT INTO caseProject 
            (pId, pAddress, pDetail, pStatus, pImage, dateCreate, dateComplete, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;

        // สร้างใหม่: pImage เป็น null ไปก่อน (รูปจะมาตอน Update)
        await database.query(sql, [
            newId,
            pAddress || "",
            pDetail || "",
            pStatus || 'รอดำเนินการ',
            null, // pImage = null
            dateCreate || null,
            dateComplete || null
        ]);

        res.json({ message: 'success', pId: newId, status: 'created' });

    } catch (error) {
        console.error('Error in createProject:', error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 4. อัปเดตงาน (Update) - เพิ่มรูปเข้าโฟลเดอร์ตาม pId
export async function updateProject(req, res) {
    try {
        const { pId, pAddress, pDetail, pStatus, dateCreate, dateComplete } = req.body;

        // 1. ดึงข้อมูลเก่าเพื่อเอารูปเดิมมาตั้งต้น
        const [oldRows] = await database.query('SELECT pImage FROM caseProject WHERE pId = ?', [pId]);
        let currentImages = [];
        
        if (oldRows.length > 0 && oldRows[0].pImage) {
            try {
                currentImages = JSON.parse(oldRows[0].pImage);
            } catch (e) {
                currentImages = [oldRows[0].pImage];
            }
            if (!Array.isArray(currentImages)) currentImages = [currentImages];
        }

        // 2. จัดการรูปภาพใหม่
        if (req.files && req.files.length > 0) {
            const newPaths = req.files.map(file => {
                return `uploads/projects/${pId}/${file.filename}`;
            });
            currentImages = [...currentImages, ...newPaths];
        }

        // 3. แปลงเป็น JSON String เพื่อบันทึก
        const pImageJSON = currentImages.length > 0 ? JSON.stringify(currentImages) : null;

        const sql = `UPDATE caseProject SET 
            pAddress = ?, pDetail = ?, pStatus = ?, dateCreate = ?, dateComplete = ?, pImage = ?
            WHERE pId = ?`;

        // บันทึกลงฐานข้อมูล
        await database.query(sql, [
            pAddress, pDetail, pStatus, 
            dateCreate || null, dateComplete || null, 
            pImageJSON, pId
        ]);

        // ---------------------------------------------------------
        // ✅ ส่วนที่เพิ่ม: Auto Post Facebook เมื่อสถานะเป็น "เสร็จสิ้น"
        // ---------------------------------------------------------
        // if (pStatus === 'เสร็จสิ้น') {
            
        //     // A. เตรียมข้อความ
        //     const message = `จัดส่ง${pDetail} พร้อมติดตั้ง 📍 ที่${pAddress}\n` +
        //                     `ขอบคุณที่ไว้ใจดาต้าร้านดาต้ายินดีให้บริการครับ🙏🏻\n\n` +
        //                     `ซื้อของพร้อมบริการส่งถึงที่\n` +
        //                     `✅สามารถสั่งซื้อได้ทุกยี่ห้อ\n` +
        //                     `✅ซื้อของพร้อมจัดส่ง ติดตั้งถึงที่\n\n` +
        //                     `ติดต่อสอบถาม inbox หรือ เบอร์ 098-7946235, 056-223547\n\n` +
        //                     `🌐 https://datacom-service.com\n\n` +
        //                     `#เรื่องติดกล้องไว้ใจดาต้า\n` +
        //                     `#เร็วทันใจต้องดาต้าคอม\n` +
        //                     `#รับติดกล้องวงจรปิดนครสวรรค์\n` +
        //                     `#รับซ่อมคอมพิวเตอร์นครสวรรค์\n` +
        //                     `#รับเดินสายแลน\n` +
        //                     `#ซื้อของพร้อมจัดส่งนครสวรรค์\n` +
        //                     `#ดาต้าคอมแอนด์เซอร์วิส`;

        //     // B. เลือกรูปภาพที่จะโพสต์ (Priority: รูปใหม่ -> รูปเก่าล่าสุด)
        //     let imagePathForPost = null;

        //     if (req.files && req.files.length > 0) {
        //         // กรณี 1: มีการอัปโหลดรูปใหม่ (ใช้รูปแรกที่อัปโหลด)
        //         // req.files[0].path คือ path เต็มในเครื่อง Server ที่ Multer สร้างไว้
        //         imagePathForPost = req.files[0].path; 
        //     } 
        //     else if (currentImages.length > 0) {
        //         // กรณี 2: ไม่ได้อัปรูปใหม่ แต่เอารูปเดิมที่มีอยู่แล้วมาโพสต์ (เอารูปล่าสุด)
        //         const lastImage = currentImages[currentImages.length - 1];
        //         // แปลง Path DB (uploads/...) ให้เป็น System Path
        //         imagePathForPost = path.resolve(lastImage); 
        //     }

        //     // C. สั่งโพสต์ (ไม่ต้อง await เพื่อให้ response กลับไปหน้าเว็บได้เลยไม่ต้องรอ)
        //     postToFacebook(message, imagePathForPost);
        // }
        // ---------------------------------------------------------

        res.json({ message: 'success' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 5. ลบงาน
export async function deleteProject(req, res) {
    try {
        // (Optional) ถ้าอยากลบไฟล์รูปภาพออกจาก Disk ด้วย ต้องเขียน Logic เพิ่มตรงนี้
        // โดยการ SELECT pImage มาก่อน แล้ววนลูป fs.unlinkSync

        await database.query('DELETE FROM caseProject WHERE pId = ?', [req.body.pId]);
        res.json({ message: 'success' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}