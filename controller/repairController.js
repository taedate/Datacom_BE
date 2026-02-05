import database from "../service/database.js";
import puppeteer from "puppeteer";
export async function getCaseInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, caseStatus, caseType, dateRange, sort_by, sort_order } = req.query;
        const offset = (page - 1) * itemsPerPage;

        // SQL พื้นฐาน
        let sql = `SELECT * FROM caseRepair WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM caseRepair WHERE 1=1`;
        let params = [];

        // Logic การค้นหา (Search)
        if (search) {
            const searchCondition = ` AND (caseId LIKE ? OR cusFirstName LIKE ? OR cusLastName LIKE ? OR cusPhone LIKE ?)`;
            sql += searchCondition;
            countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        // Logic การกรอง (Filter)
        if (caseStatus) {
            sql += ` AND caseStatus = ?`;
            countSql += ` AND caseStatus = ?`;
            params.push(caseStatus);
        }

        if (caseType) {
            sql += ` AND caseType = ?`;
            countSql += ` AND caseType = ?`;
            params.push(caseType);
        }

        // Logic กรองวันที่ (String Match)
        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) {
                 sql += ` AND datePickUp BETWEEN ? AND ?`;
                 countSql += ` AND datePickUp BETWEEN ? AND ?`;
                 params.push(start, end);
             }
        }

        // Logic Sorting (แก้ให้เรียงตาม created_at เพื่อความถูกต้องที่สุด)
        if (sort_by) {
            // ถ้ามีการกดหัวตาราง ให้เรียงตามนั้น
            sql += ` ORDER BY ${sort_by} ${sort_order === 'asc' ? 'ASC' : 'DESC'}`;
        } else {
            // Default: เรียงตามเวลาที่สร้าง (ล่าสุดอยู่บนสุด) ไม่สน Prefix ID
            sql += ` ORDER BY created_at DESC`;
        }

        // Pagination
        const queryParams = [...params, Number(itemsPerPage), Number(offset)];

        // Execute
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);
        
        res.json({
            message: 'success',
            data: rows,
            totalItems: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / itemsPerPage)
        });

    } catch (error) {
        console.error('Error fetching cases:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

// API สำหรับดึงตัวเลือกมาใส่ Dropdown
export async function getFilterOptions(req, res) {
    try {
        const [statusRows] = await database.query('SELECT DISTINCT caseStatus FROM caseRepair');
        const [typeRows] = await database.query('SELECT DISTINCT caseType FROM caseRepair');

        res.json({
            message: 'success',
            data: {
                statuses: statusRows.map(r => r.caseStatus).filter(Boolean),
                types: typeRows.map(r => r.caseType).filter(Boolean)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
}


// 1. ดึงรายละเอียดงานซ่อมรายเคส (Get Detail)
export async function getCaseDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseRepair WHERE caseId = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'error', error: 'Case not found' });
        }
        res.json({ message: 'success', data: rows[0] });
    } catch (error) {
        res.status(500).json({ message: 'error', error: error.message });
    }
}

// 2. สร้างงานซ่อมใหม่ (Create)
export async function createCase(req, res) {
    try {
        const {
            cusFirstName, cusLastName, cusPhone, caseInstitution,
            brokenSymptom, caseType, caseStatus,
            caseBrand, caseModel, caseSN, caseDurableArticles, caseEquipment,
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered
        } = req.body;

        // 1. กำหนด Prefix ตามประเภท
        let prefix = "CT"; 
        switch (caseType) {
            case "ซ่อมคอมพิวเตอร์": prefix = "PC"; break;
            case "ซ่อมโน็ตบุ๊ค": prefix = "NB"; break;
            case "ซ่อมปริ้นเตอร์": prefix = "PR"; break;
            case "ซ่อมมือถือ/แท็บเล็ต": prefix = "MB"; break;
            case "ลงโปรแกรม/OS": prefix = "SW"; break;
            default: prefix = "CT";
        }

        // 2. หา ID ล่าสุดของ Prefix นี้
        const [lastRows] = await database.query(
            `SELECT caseId FROM caseRepair WHERE caseId LIKE ? ORDER BY LENGTH(caseId) DESC, caseId DESC LIMIT 1`,
            [`${prefix}-%`]
        );

        // 3. รันเลขใหม่
        let newId = `${prefix}-001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].caseId;
            const lastNum = parseInt(lastId.split('-')[1]);
            newId = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
        }

        // 4. บันทึก (ใส่ NOW() ใน created_at)
        const sql = `INSERT INTO caseRepair 
        (caseId, cusFirstName, cusLastName, cusPhone, caseInstitution, 
         brokenSymptom, caseType, caseStatus, 
         caseBrand, caseModel, caseSN, caseDurableArticles, caseEquipment,
         datePickUp, dateBeforePicUp, dateComplete, dateDelivered, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

        await database.query(sql, [
            newId, cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, caseStatus || 'รับเครื่องแล้ว',
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', caseEquipment || '',
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null
        ]);

        res.json({ message: 'success', caseId: newId });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}
// 3. อัปเดตงานซ่อม (Update)
export async function updateCase(req, res) {
    try {
        const {
            caseId, cusFirstName, cusLastName, cusPhone, caseInstitution,
            brokenSymptom, caseType, caseStatus,
            caseBrand, caseModel, caseSN, caseDurableArticles, 
            caseEquipment, // ✅ เพิ่มตรงนี้
            datePickUp, dateBeforePicUp, dateComplete, dateDelivered
        } = req.body;

        const sql = `UPDATE caseRepair SET 
            cusFirstName=?, cusLastName=?, cusPhone=?, caseInstitution=?,
            brokenSymptom=?, caseType=?, caseStatus=?,
            caseBrand=?, caseModel=?, caseSN=?, caseDurableArticles=?, caseEquipment=?,
            datePickUp=?, dateBeforePicUp=?, dateComplete=?, dateDelivered=?
            WHERE caseId=?`;

        await database.query(sql, [
            cusFirstName, cusLastName, cusPhone, caseInstitution || '',
            brokenSymptom, caseType, caseStatus,
            caseBrand || '', caseModel || '', caseSN || '', caseDurableArticles || '', 
            caseEquipment || '', // ✅ เพิ่มค่า
            datePickUp || null, dateBeforePicUp || null, dateComplete || null, dateDelivered || null,
            caseId
        ]);

        res.json({ message: 'success' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'error', error: error.message });
    }
}



// 1. สร้างตัวแปร Global ไว้เก็บ Browser (ใช้ร่วมกันทุก Request)
let globalBrowser = null;

async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        console.log("🚀 Launching New Browser Instance...");
        globalBrowser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // ลดการกิน Ram ใน Container/Server
                '--disable-gpu'
            ]
        });
    }
    return globalBrowser;
}

function formatDateThai(dateStr) {
    if (!dateStr) return "";
    let day, month, year;
    dateStr = dateStr.split(' ')[0]; 

    if (dateStr.includes('/')) {
        [day, month, year] = dateStr.split('/');
    } else if (dateStr.includes('-')) {
        [day, month, year] = dateStr.split('-');
    } else {
        return dateStr;
    }

    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const monthIndex = parseInt(month, 10) - 1;
    const dayInt = parseInt(day, 10);

    if (monthIndex >= 0 && monthIndex < 12) {
        return `${dayInt} ${thaiMonths[monthIndex]} ${year}`;
    }
    return dateStr;
}

export async function printCasePDF(req, res) {
    console.log("🚀 Generating Case Repair PDF (Fast Mode) for:", req.params.id);
    let page = null;

    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseRepair WHERE caseId = ?', [id]);

        if (rows.length === 0) return res.status(404).json({ message: "ไม่พบข้อมูล" });

        const data = rows[0];

        // Logic Checkbox
        const type = data.caseType || '';
        const cPC = type.includes('คอมพิวเตอร์') ? 'checked' : '';
        const cNB = type.includes('โน็ตบุ๊ค') ? 'checked' : '';
        const cPR = type.includes('ปริ้นเตอร์') ? 'checked' : '';
        const cUPS = type.includes('UPS') ? 'checked' : '';
        const cOther = (!cPC && !cNB && !cPR && !cUPS) ? 'checked' : '';

        // ถ้าอยากให้ไวกว่านี้อีก แนะนำให้เปลี่ยน URL เป็น Base64 String
        const logoUrl = "https://github.com/taedate/datacom-image/blob/main/logoData.PNG?raw=true";

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <title>Job-${data.caseId}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap" rel="stylesheet">
            <style>
                @page { size: A4; margin: 15mm 20mm; }
                body { font-family: 'Sarabun', sans-serif; font-size: 14px; line-height: 1.5; color: #000; margin: 0; width: 100%; }
                
                /* Header */
                .header-container { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 10px; }
                .logo-img { width: 125px; height: auto; }
                .company-info { text-align: left; }
                .logo-text { font-size: 20px; font-weight: bold; line-height: 1.2; margin-bottom: 4px; }
                .sub-header { font-size: 12px; }
                
                /* Title Box */
                .title-box { border: 2px solid #000; padding: 6px; text-align: center; font-weight: bold; font-size: 16px; background-color: #f0f0f0; margin-bottom: 15px; border-radius: 4px; }

                /* Section Header */
                .section-header { font-weight: bold; font-size: 15px; border-bottom: 1px solid #999; margin-top: 10px; margin-bottom: 10px; padding-bottom: 2px; }

                /* Rows */
                .row { display: flex; width: 100%; margin-bottom: 8px; align-items: flex-end; }
                .col { flex: 1; display: flex; align-items: flex-end; padding-right: 15px; }
                .col-2 { flex: 2; display: flex; align-items: flex-end; padding-right: 15px; }
                
                .label { font-weight: bold; margin-right: 8px; white-space: nowrap; font-size: 14px; }
                .value { border-bottom: 1px dotted #000; flex: 1; padding-left: 5px; color: #0033cc; font-weight: 500; padding-bottom: 2px; }

                /* Checkbox */
                .chk-group { display: flex; gap: 15px; align-items: center; }
                .chk-item { display: flex; align-items: center; font-size: 14px; }
                .box { width: 14px; height: 14px; border: 1px solid #000; display: inline-block; margin-right: 5px; text-align: center; line-height: 12px; font-size: 12px; font-weight: bold; }

                /* Table */
                .tech-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                .tech-table th, .tech-table td { border: 1px solid #000; padding: 4px 8px; }
                .tech-table th { background-color: #eee; text-align: center; height: 24px; }
                .tech-table td { height: 24px; }

                /* Disclaimer */
                .disclaimer { font-size: 11px; margin-top: 0px; border: 1px dashed #666; padding: 10px; line-height: 1.5; }

                /* Signatures */
                .sig-container { display: flex; justify-content: space-between; margin-top: 20px; text-align: center; page-break-inside: avoid; }
                .sig-box { width: 40%; }
                .sig-line { border-bottom: 1px dotted #000; height: 25px; margin-bottom: 5px; }

                .footer-wrapper { margin-top: auto; padding-top: 10px; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .mt-2 { margin-top: 10px; }
            </style>
        </head>
        <body>

            <div class="header-container">
                <img src="${logoUrl}" class="logo-img" alt="Logo">
                <div class="company-info">
                    <div class="logo-text">บริษัท ดาต้า คอม แอนด์ เซอร์วิส จำกัด</div>
                    <div class="sub-header">187/15 ถ.มาตุลี ต.ปากน้ำโพ อ.เมือง จ.นครสวรรค์ 60000</div>
                    <div class="sub-header" style="font-weight: bold;">DATA COM & SERVICE CO.,LTD. โทร. 056-313355, 223547 FAX. 056-231539</div>
                </div>
            </div>

            <div class="title-box">ใบรับซ่อมเครื่อง / อุปกรณ์ (JOB ID: ${data.caseId})</div>

            <div class="section-header" style="margin-top:0;">1. รายละเอียดลูกค้า</div>
            <div class="row">
                <div class="col-2"><span class="label">ผู้ส่งซ่อม:</span><span class="value">${data.cusFirstName} ${data.cusLastName}</span></div>
                <div class="col"><span class="label">เบอร์โทร:</span><span class="value">${data.cusPhone}</span></div>
            </div>
            <div class="row">
                <div class="col"><span class="label">หน่วยงาน/สังกัด:</span><span class="value">${data.caseInstitution || '-'}</span></div>
            </div>

            <div class="section-header">2. รายละเอียดอุปกรณ์รับซ่อม</div>
            <div class="row">
                <div class="col">
                    <div class="chk-group">
                        <div class="chk-item"><div class="box">${cPC ? '✓' : ''}</div> คอมพิวเตอร์</div>
                        <div class="chk-item"><div class="box">${cNB ? '✓' : ''}</div> โน๊ตบุ๊ค</div>
                        <div class="chk-item"><div class="box">${cPR ? '✓' : ''}</div> ปริ้นเตอร์</div>
                        <div class="chk-item"><div class="box">${cUPS ? '✓' : ''}</div> UPS</div>
                        <div class="chk-item"><div class="box">${cOther ? '✓' : ''}</div> อื่นๆ</div>
                    </div>
                </div>
            </div>
            <div class="row mt-2">
                <div class="col"><span class="label">ยี่ห้อ:</span><span class="value">${data.caseBrand || '-'}</span></div>
                <div class="col"><span class="label">รุ่น:</span><span class="value">${data.caseModel || '-'}</span></div>
                <div class="col"><span class="label">S/N:</span><span class="value">${data.caseSN || '-'}</span></div>
            </div>
            <div class="row">
                <div class="col"><span class="label">เลขครุภัณฑ์:</span><span class="value">${data.caseDurableArticles || '-'}</span></div>
            </div>
            <div class="row">
                <div class="col">
                    <span class="label">อาการเสีย:</span> 
                    <span class="value">${data.brokenSymptom || '-'}</span>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <span class="label">อุปกรณ์ที่นำมา:</span> 
                    <span class="value">${data.caseEquipment || '-'}</span>
                </div>
            </div>

            <div class="sig-container">
                <div class="sig-box">
                    <div class="sig-line"></div>
                    <div class="label">ลงชื่อผู้ส่งซ่อม</div>
                    <div>วันที่: ${formatDateThai(data.datePickUp) || '______/______/______'}</div>
                </div>
                <div class="sig-box">
                    <div class="sig-line"></div>
                    <div class="label">ลงชื่อผู้รับซ่อม (เจ้าหน้าที่)</div>
                    <div>วันที่: ${formatDateThai(data.dateReceived) || '______/______/______'}</div>
                </div>
            </div>

            <div class="section-header" style="margin-top: 10px;">3. รายการที่ช่างซ่อม / เปลี่ยนอะไหล่</div>
            <table class="tech-table">
                <thead>
                    <tr>
                        <th style="width: 8%;">ลำดับ</th>
                        <th style="width: 62%;">รายการเปลี่ยนอะไหล่ / ค่าบริการ</th>
                        <th style="width: 30%;">ราคา (บาท)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td class="text-center">1</td><td></td><td></td></tr>
                    <tr><td class="text-center">2</td><td></td><td></td></tr>
                    <tr><td class="text-center">3</td><td></td><td></td></tr>
                    <tr><td class="text-center">4</td><td></td><td></td></tr>
                    <tr><td class="text-center">5</td><td></td><td></td></tr>
                    <tr>
                        <td colspan="2" class="text-right" style="font-weight:bold; background-color:#fafafa;">รวมราคาทั้งสิ้น</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <div class="footer-wrapper">
                <div class="disclaimer">
                    <strong><u>หมายเหตุเงื่อนไขการรับบริการ:</u></strong><br>
                    กรณีที่ซื้อเฉพาะฮาร์ดแวร์ (อุปกรณ์คอมพิวเตอร์) บริษัทจะไม่รับใดๆ เกี่ยวกับซอฟต์แวร์ (โปรแกรม) ไม่ว่ากรณีใดๆทั้งสิ้น
                    นำเครื่องมาเซอร์วิส<br> ทางบริษัทฯ จะไม่รับผิดชอบหากเกิดความเสียหายใดๆ เกี่ยวกับข้อมูลหรือซอฟต์แวร์ ไม่ว่ากรณีใดๆทั้งสิ้น
                    ถ้าเครื่องถูกจับจากผู้มีอำนาจทาง<br>กฏหมายเหตุเนื่องจาก ซอฟต์แวร์ในทางกฏหมาย ทางบริษัทฯ จะไม่รับผิดชอบทั้งซอฟต์แวร์และฮาร์ดแวร์ ไม่ว่ากรณีใดๆทั้งสิ้น
                </div>

                <div class="sig-container" style="margin-top: 20px;">
                    <div class="sig-box">
                        <div class="sig-line"></div>
                        <div class="label">ลงชื่อผู้รับเครื่องคืน (ลูกค้า)</div>
                        <div>วันที่: ${formatDateThai(data.dateDelivered) || '______/______/______'}</div>
                    </div>
                    <div class="sig-box">
                        <div class="label" style="padding-top:15px;">( ........................................................... )</div>
                        <div class="label">พนักงานผู้ส่งคืน</div>
                    </div>
                </div>
            </div>

        </body>
        </html>
        `;

        // 2. เรียกใช้ Browser เดิม (ไม่ต้อง Launch ใหม่)
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // 3. ปรับ waitUntil เป็น 'load' เพื่อความไว (ไม่ต้องรอ networkidle0)
        await page.setContent(htmlContent, { waitUntil: 'load' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' }
        });

        // 4. สำคัญ: ปิดแค่ Page (อย่าปิด Browser)
        await page.close();

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
            'Content-Disposition': `inline; filename="Repair-${id}.pdf"`
        });
        
        res.end(pdfBuffer);

    } catch (error) {
        console.error("🔥 PDF Error:", error);
        // ถ้า Page ค้างให้ปิดเฉพาะ Page
        if (page) await page.close().catch(() => {});
        res.status(500).json({ message: "PDF Error: " + error.message });
    }
}