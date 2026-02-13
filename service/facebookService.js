// services/facebookService.js
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// ⚠️ เอา Token ยาวที่ได้จากข้อ 1 มาใส่ตรงนี้ (หรือใส่ใน .env จะดีที่สุด)
const FB_PAGE_ID = process.env.FB_PAGE_ID; // ใส่ ID เพจร้าน DATACOM (เป็นตัวเลข)
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN; 

export async function postToFacebook(message, imageFilePath) {
    try {
        const formData = new FormData();
        formData.append('message', message);
        formData.append('access_token', FB_ACCESS_TOKEN);

        // เช็คว่ามีรูปไหม ถ้ามีให้อัปโหลดรูปด้วย
        if (imageFilePath && fs.existsSync(imageFilePath)) {
            formData.append('source', fs.createReadStream(imageFilePath));
            
            console.log('กำลังโพสต์รูปภาพไปยัง Facebook...');
            const response = await axios.post(
                `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`,
                formData,
                { headers: formData.getHeaders() }
            );
            console.log('✅ โพสต์ Facebook สำเร็จ ID:', response.data.id);
            return response.data;
        } else {
            // กรณีไม่มีรูป (โพสต์ข้อความอย่างเดียว)
            console.log('กำลังโพสต์ข้อความไปยัง Facebook...');
            const response = await axios.post(
                `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`,
                { message: message, access_token: FB_ACCESS_TOKEN }
            );
            console.log('✅ โพสต์ Facebook สำเร็จ ID:', response.data.id);
            return response.data;
        }
    } catch (error) {
        console.error('❌ โพสต์ Facebook ล้มเหลว:', error.response ? error.response.data : error.message);
        // ไม่ throw error เพื่อไม่ให้การบันทึก DB พังไปด้วย
    }
}