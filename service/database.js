import mysql from 'mysql2/promise'; // ใช้ mysql2 แบบ promise
import dotenv from 'dotenv';

dotenv.config();

// สร้าง Pool สำหรับเชื่อมต่อ (คล้ายกับของเดิมแต่ตั้งค่าแบบ MySQL)
const pool = mysql.createPool({
    host: process.env.DBHOST || 'localhost', // Hostinger ใช้ localhost
    user: process.env.DBUSER,
    password: process.env.DBPWD,
    database: process.env.DB,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});


// เช็คการเชื่อมต่อเบื้องต้น (Optional: เอาไว้ดูว่าต่อติดไหม)
pool.getConnection()
    .then(conn => {
        console.log("Connected to MySQL successfully!");
        conn.release();
    })
    .catch(err => {
        console.error("Error connecting to MySQL:", err);
    });

export default pool;