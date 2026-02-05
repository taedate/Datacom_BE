import database from "../service/database.js";
import puppeteer from "puppeteer";

// --- Shared Browser Instance ---
let globalBrowser = null;
async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        console.log("🚀 Launching New Browser Instance...");
        globalBrowser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
    }
    return globalBrowser;
}

// --- Date Helper ---
function formatDateThai(dateStr) {
    if (!dateStr) return "";
    let day, month, year;
    dateStr = dateStr.split(' ')[0]; 
    if (dateStr.includes('/')) { [day, month, year] = dateStr.split('/'); } 
    else if (dateStr.includes('-')) { [day, month, year] = dateStr.split('-'); } 
    else { return dateStr; }
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const monthIndex = parseInt(month, 10) - 1;
    const dayInt = parseInt(day, 10);
    if (monthIndex >= 0 && monthIndex < 12) { return `${dayInt} ${thaiMonths[monthIndex]} ${year}`; }
    return dateStr;
}

// ------------------------------------------------------------------
// 1. CRUD Functions
// ------------------------------------------------------------------
export async function getSentRepairInfo(req, res) {
    try {
        const { page = 1, itemsPerPage = 10, search, caseSType, dateRange, sort_by, sort_order, status } = req.query;
        const offset = (page - 1) * itemsPerPage;
        let sql = `SELECT * FROM caseSentRepair WHERE 1=1`;
        let countSql = `SELECT COUNT(*) as total FROM caseSentRepair WHERE 1=1`;
        let params = [];

        if (search) {
            const searchCondition = ` AND (caseSId LIKE ? OR caseSCusName LIKE ? OR caseSToMechanic LIKE ? OR caseSOrderNo LIKE ? OR caseSSN LIKE ?)`;
            sql += searchCondition; countSql += searchCondition;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
        }
        if (caseSType) { sql += ` AND caseSType = ?`; countSql += ` AND caseSType = ?`; params.push(caseSType); }
        if (dateRange) {
             const [start, end] = dateRange.split(',');
             if(start && end) { sql += ` AND DateSOfSent BETWEEN ? AND ?`; countSql += ` AND DateSOfSent BETWEEN ? AND ?`; params.push(start, end); }
        }
        if (status) {
            if (status === 'รับคืนแล้ว') { sql += ` AND dateOfReceived IS NOT NULL`; countSql += ` AND dateOfReceived IS NOT NULL`; } 
            else if (status === 'ส่งซ่อมอยู่') { sql += ` AND dateOfReceived IS NULL`; countSql += ` AND dateOfReceived IS NULL`; }
        }
        if (sort_by) { sql += ` ORDER BY ${sort_by} ${sort_order === 'asc' ? 'ASC' : 'DESC'}, caseSId DESC`; } 
        else { sql += ` ORDER BY created_at DESC, caseSId DESC`; }

        const queryParams = [...params, Number(itemsPerPage), Number(offset)];
        const [rows] = await database.query(sql + ` LIMIT ? OFFSET ?`, queryParams);
        const [countResult] = await database.query(countSql, params);
        
        res.json({ message: 'success', data: rows, totalItems: countResult[0].total, totalPages: Math.ceil(countResult[0].total / itemsPerPage) });
    } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
}

export async function getSentRepairDetail(req, res) {
    try {
        const { id } = req.params;
        const [rows] = await database.query('SELECT * FROM caseSentRepair WHERE caseSId = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'error', error: 'Case not found' });
        res.json({ message: 'success', data: rows[0] });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function createSentRepair(req, res) {
    try {
        const { caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient } = req.body;
        const prefix = "S"; 
        const [lastRows] = await database.query(`SELECT caseSId FROM caseSentRepair WHERE caseSId LIKE ? ORDER BY LENGTH(caseSId) DESC, caseSId DESC LIMIT 1`, [`${prefix}-%`]);
        let newId = `${prefix}-001`;
        if (lastRows.length > 0) {
            const lastId = lastRows[0].caseSId;
            const lastNum = parseInt(lastId.split('-')[1]);
            newId = `${prefix}-${String(lastNum + 1).padStart(3, '0')}`;
        }
        const sql = `INSERT INTO caseSentRepair (caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
        await database.query(sql, [newId, caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', caseSSN || '', brokenSymptom || '', caseSEquipment || '', dateOfReceived || null, caseSRecipient || '' ]);
        res.json({ message: 'success', caseSId: newId });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function updateSentRepair(req, res) {
    try {
        const { caseSId, caseSToMechanic, caseSOrderNo, caseSCusName, DateSOfSent, caseSType, caseSBrand, caseSModel, caseSSN, brokenSymptom, caseSEquipment, dateOfReceived, caseSRecipient } = req.body;
        const sql = `UPDATE caseSentRepair SET caseSToMechanic=?, caseSOrderNo=?, caseSCusName=?, DateSOfSent=?, caseSType=?, caseSBrand=?, caseSModel=?, caseSSN=?, brokenSymptom=?, caseSEquipment=?, dateOfReceived=?, caseSRecipient=? WHERE caseSId=?`;
        await database.query(sql, [caseSToMechanic || '', caseSOrderNo || '', caseSCusName || '', DateSOfSent || null, caseSType || '', caseSBrand || '', caseSModel || '', caseSSN || '', brokenSymptom || '', caseSEquipment || '', dateOfReceived || null, caseSRecipient || '', caseSId]);
        res.json({ message: 'success' });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

export async function deleteSentRepair(req, res) {
    try {
        const { caseSId } = req.body;
        await database.query('DELETE FROM caseSentRepair WHERE caseSId = ?', [caseSId]);
        res.json({ message: 'success' });
    } catch (error) { res.status(500).json({ message: 'error', error: error.message }); }
}

// ------------------------------------------------------------------
// 2. PDF Function (ชื่อ printCasePDF) - ดึงจาก caseSentRepair
// ------------------------------------------------------------------
export async function printSentRepairPDF(req, res) {
    // ✅ 1. รับ ID จาก URL ตรงๆ (เช่น S-001) มั่นใจได้ว่ามีค่าแน่นอน
    const { id } = req.params; 
    console.log("🚀 Generating Sent-Repair PDF for ID:", id);

    let page = null;

    try {
        // ✅ 2. Query ข้อมูลจากตาราง caseSentRepair (ใบส่งซ่อมร้านนอก)
        const [rows] = await database.query('SELECT * FROM caseSentRepair WHERE caseSId = ?', [id]);

        if (rows.length === 0) return res.status(404).json({ message: "ไม่พบข้อมูล" });

        const data = rows[0];

        // --- Logic Checkbox ---
        // ใช้ caseSType ให้ตรงกับ Database
        const type = data.caseSType || '';
        const cPC = type.includes('คอมพิวเตอร์') ? 'checked' : '';
        const cNB = type.includes('โน็ตบุ๊ค') ? 'checked' : '';
        const cPR = type.includes('ปริ้นเตอร์') ? 'checked' : '';
        const cUPS = type.includes('UPS') ? 'checked' : '';
        const cOther = (!cPC && !cNB && !cPR && !cUPS) ? 'checked' : '';

        const logoUrl = "https://github.com/taedate/datacom-image/blob/main/logoData.PNG?raw=true";

        const htmlContent = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <title>Sent-Job-${id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap" rel="stylesheet">
            <style>
                @page { size: A4; margin: 15mm 20mm; }
                body { font-family: 'Sarabun', sans-serif; font-size: 14px; line-height: 1.5; color: #000; margin: 0; width: 100%; }
                .header-container { display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 10px; }
                .logo-img { width: 125px; height: auto; }
                .company-info { text-align: left; }
                .logo-text { font-size: 20px; font-weight: bold; line-height: 1.2; margin-bottom: 4px; }
                .sub-header { font-size: 12px; }
                .title-box { border: 2px solid #000; padding: 6px; text-align: center; font-weight: bold; font-size: 16px; background-color: #f0f0f0; margin-bottom: 15px; border-radius: 4px; }
                .section-header { font-weight: bold; font-size: 15px; border-bottom: 1px solid #999; margin-top: 10px; margin-bottom: 10px; padding-bottom: 2px; }
                .row { display: flex; width: 100%; margin-bottom: 8px; align-items: flex-end; }
                .col { flex: 1; display: flex; align-items: flex-end; padding-right: 15px; }
                .col-2 { flex: 2; display: flex; align-items: flex-end; padding-right: 15px; }
                .label { font-weight: bold; margin-right: 8px; white-space: nowrap; font-size: 14px; }
                .value { border-bottom: 1px dotted #000; flex: 1; padding-left: 5px; color: #0033cc; font-weight: 500; padding-bottom: 2px; }
                .chk-group { display: flex; gap: 15px; align-items: center; }
                .chk-item { display: flex; align-items: center; font-size: 14px; }
                .box { width: 14px; height: 14px; border: 1px solid #000; display: inline-block; margin-right: 5px; text-align: center; line-height: 12px; font-size: 12px; font-weight: bold; }
                .sig-container { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; page-break-inside: avoid; }
                .sig-box { width: 45%; }
                .sig-line { border-bottom: 1px dotted #000; height: 25px; margin-bottom: 5px; }
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

            <div class="title-box">ใบส่งซ่อม / เคลม (JOB ID: ${id})</div>

            <div class="section-header" style="margin-top:0;">1. รายละเอียดการส่งซ่อม</div>
            <div class="row">
                <div class="col-2"><span class="label">ส่งให้ช่าง/ร้าน:</span><span class="value">${data.caseSToMechanic || '-'}</span></div>
                <div class="col"><span class="label">เลขที่ใบส่งซ่อม:</span><span class="value">${data.caseSOrderNo || '-'}</span></div>
            </div>
            <div class="row">
                <div class="col-2"><span class="label">ชื่อลูกค้า (เจ้าของ):</span><span class="value">${data.caseSCusName || '-'}</span></div>
                <div class="col"><span class="label">วันที่ส่งซ่อม:</span><span class="value">${formatDateThai(data.DateSOfSent)}</span></div>
            </div>

            <div class="section-header">2. รายการอุปกรณ์ที่ส่งซ่อม</div>
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
                <div class="col"><span class="label">ยี่ห้อ:</span><span class="value">${data.caseSBrand || '-'}</span></div>
                <div class="col"><span class="label">รุ่น:</span><span class="value">${data.caseSModel || '-'}</span></div>
                <div class="col"><span class="label">S/N:</span><span class="value">${data.caseSSN || '-'}</span></div>
            </div>
            
            <div class="row">
                <div class="col"><span class="label">อาการเสีย:</span><span class="value">${data.brokenSymptom || '-'}</span></div>
            </div>
            <div class="row">
                <div class="col"><span class="label">อุปกรณ์ที่ส่งไปด้วย:</span><span class="value">${data.caseSEquipment || '-'}</span></div>
            </div>

            <div class="sig-container">
                <div class="sig-box">
                    <div class="sig-line"></div>
                    <div class="label">ลงชื่อผู้ส่งคืน (ร้านค้า/ช่าง)</div>
                    <div>วันที่: ${formatDateThai(data.dateOfReceived) || '______/______/______'}</div>
                </div>
                <div class="sig-box">
                    <div style="border-bottom: 1px dotted #000; margin-bottom: 5px; height: 25px; display: flex; align-items: flex-end; justify-content: center;">
                        <span style="color:#0033cc; font-weight:bold;">${data.caseSRecipient ? `( ${data.caseSRecipient} )` : ''}</span>
                    </div>
                    <div class="label">ผู้รับสินค้าคืน (พนักงานบริษัท)</div>
                    <div>วันที่: ${formatDateThai(data.dateOfReceived) || '______/______/______'}</div>
                </div>
            </div>
        </body>
        </html>
        `;

        const browser = await getBrowser();
        page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' }
        });

        await page.close();

        // =======================================================================
        // ✅ 4. จุดแก้ชื่อไฟล์: ใช้ id จาก URL ตรงๆ (Sent-Repair-S-001.pdf)
        // =======================================================================
        const filename = `Sent-Repair-${id}.pdf`;
        
        // Encode เพื่อป้องกัน Browser งง ถ้าเกิดมีอักขระพิเศษ (กันเหนียว)
        const encodedFilename = encodeURIComponent(filename);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
            // บังคับชื่อไฟล์ตรงนี้ ไม่สนใจ Database
            'Content-Disposition': `inline; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
        });
        
        res.end(pdfBuffer);

    } catch (error) {
        console.error("🔥 PDF Error:", error);
        if (page) await page.close().catch(() => {});
        res.status(500).json({ message: "PDF Error: " + error.message });
    }
}