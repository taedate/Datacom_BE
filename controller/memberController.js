import database from "../service/database.js"; // ตรวจสอบ path ให้ถูกว่าไฟล์ database.js อยู่ไหน
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const secret = 'DaranWeb';

// --- REGISTER ---
export async function memberRegister(req, res) {
  try {
    // รับค่า userName และ password (ตัด fname, lname ออกเพราะใน DB ไม่มีที่เก็บ)
    const { userName, password } = req.body;

    // ตรวจสอบค่าว่าง
    if (!userName || !password) {
      return res.status(400).json({ error: 'Missing required fields (userName, password)' });
    }

    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);

    // SQL สำหรับ MySQL:
    // 1. ใช้เครื่องหมาย ? แทน $1
    // 2. ไม่ต้องใส่ " ฟันหนูที่ชื่อ column
    // 3. userId เป็น Auto Increment ไม่ต้องใส่ใน insert
    const sql = 'INSERT INTO users (userName, userPassword) VALUES (?, ?)';
    
    // MySQL2 จะ return ผลลัพธ์เป็น array [result, fields]
    const [result] = await database.query(sql, [userName, hash]);

    console.log(result); 

    res.status(201).json({ 
        message: 'User registered successfully',
        userId: result.insertId // ส่ง ID ที่เพิ่งสร้างกลับไปให้ด้วย (MySQL ทำได้)
    });

  } catch (error) {
    console.error('Error querying database:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- LOGIN ---
export async function memberLogin(req, res) {
  console.log('Member Login');
  try {
    // รับค่า userName แทน email
    const { userName, password } = req.body;
    console.log(userName, password);

    // Query หา user จาก userName
    // สังเกตการใช้ Destructuring [rows] เพราะ mysql2 return เป็น array ของ rows
    const [rows] = await database.query('SELECT * FROM users WHERE userName = ?', [userName]);

    // ถ้าไม่เจอข้อมูล (Array ว่าง)
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0]; // ดึง user คนแรกออกมา

    // เทียบรหัสผ่าน (ใช้ column userPassword จาก DB)
    const loginok = await bcrypt.compare(password, user.userPassword);

    if (loginok) {
      const token = jwt.sign({ userName: user.userName, userId: user.userId }, secret, { expiresIn: '1h' });
      
      // ✅ แก้ไขตรงนี้: ส่งข้อมูล User กลับไปพร้อมกับ Token
      return res.json({
        message: 'success',
        token,
        payload: {
            userId: user.userId,
            userName: user.userName
        }
      });
    } else {
      return res.status(401).json({ error: 'fail' });
    }

  } catch (error) {
    console.error('Error querying database:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// --- AUTHEN (เหมือนเดิม) ---
export async function memberAuthen(req, res) {
    try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, secret);
        res.status(200).json({ message: 'ok', decoded });
    } catch (error) {
        console.error('Authen Error:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// --- LOGOUT ---
export async function memberLogout(req, res) {
    try {
        // ตรวจสอบ token ก่อน
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, secret);

        // ใน JWT ไม่ต้องเก็บ token ที่ backend, logout = ลบ token ที่ frontend
        res.status(200).json({ 
            message: 'Logout successful',
            userId: decoded.userId
        });
    } catch (error) {
        console.error('Logout Error:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};