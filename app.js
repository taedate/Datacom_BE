import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import memRouter from './router/memberRouter.js'

const app = express();

// ใช้ CORS
app.use(cors());

// ใช้ body-parser เพื่ออ่านข้อมูล JSON
app.use(bodyParser.json()); // ใช้ middleware ให้ express อ่าน JSON
app.use(memRouter)



// เปิดให้แอปทำงานที่พอร์ต 3000
app.listen(3333, function () {
  console.log('CORS-enabled web server listening on port 3333');
});
