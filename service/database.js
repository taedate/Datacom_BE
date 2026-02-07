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
    // เพิ่ม connectionLimit เพื่อรองรับคำขอพร้อมกันมากขึ้น
    connectionLimit: 20,
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

// Export an object with `query` wrapper and raw `pool` for backward compatibility
const database = { query, pool };
export default database;

// 안전한 query wrapper เพื่อ retry กรณี connection reset (transient)
async function query(sql, params) {
    const maxRetries = 2;
    let attempt = 0;
    while (true) {
        try {
            return await pool.query(sql, params);
        } catch (err) {
            attempt++;
            const isConnReset = err && (err.code === 'ECONNRESET' || err.errno === 'ECONNRESET');
            if (isConnReset && attempt <= maxRetries) {
                console.warn(`Database query failed with ECONNRESET, retrying (${attempt}/${maxRetries})`);
                // short backoff
                await new Promise(r => setTimeout(r, 150 * attempt));
                continue;
            }
            throw err;
        }
    }
}

export { query };