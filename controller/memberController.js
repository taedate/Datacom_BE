import database from "../service/database.js";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { writeAuditLog } from '../service/auditLogService.js';

const secret = process.env.JWT_SECRET || 'DaranWeb';

// --- REGISTER (disabled: use /register-by-invite) ---
export async function memberRegister(req, res) {
    return res.status(403).json({
        message: 'error',
        code: 'FORBIDDEN',
        detail: 'Public registration is disabled. Use an invite link to register.',
    });
};

// --- LOGIN ---
export async function memberLogin(req, res) {
  try {
    // รับค่า userName แทน email
    const { userName, password } = req.body;

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
      // Update lastLoginAt
      await database.query(
        'UPDATE users SET lastLoginAt = NOW(), updatedAt = NOW() WHERE userId = ?',
        [user.userId]
      );

      const token = jwt.sign(
        { userName: user.userName, userId: user.userId, role: user.role || 'user' },
        secret,
        { expiresIn: '8h' }
      );

      return res.json({
        message: 'success',
        token,
        payload: {
            userId:   user.userId,
            userName: user.userName,
            role:     user.role || 'user',
        }
      });
    } else {
      return res.status(401).json({ message: 'error', code: 'FORBIDDEN', detail: 'Invalid credentials' });
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


export async function systemHealthCheck(req, res) {
  try {
    // 1. ลอง Query ง่ายๆ เพื่อปลุก Database (ถ้า DB หลับอยู่ มันจะตื่นตอนนี้)
    await database.query('SELECT 1');

    // 2. ส่งค่ากลับไปบอกว่า "ฉันยังอยู่ดี"
    res.status(200).json({ 
      status: 'online', 
      message: 'Server and Database are active',
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Health Check Error:', error);
    req.__auditLogged = true;
    try {
      await writeAuditLog({
        performedBy: null,
        action: 'HEALTHCHECK_FAILED',
        module: 'system',
        entityType: null,
        entityId: null,
        status: 'fail',
        severity: 'error',
        detail: {
          route: req.originalUrl,
          method: req.method,
          reason: 'Database connection failed',
        },
        ipAddress: req.clientIp || req.ip || null,
        userAgent: req.userAgent || req.headers['user-agent'] || null,
        requestId: req.requestId || null,
      });
    } catch (auditError) {
      console.error('Health check audit log failed:', auditError.message);
    }
    // ถ้า DB ล่ม หรือต่อไม่ได้ จะส่ง Error 500 กลับไป
    res.status(500).json({ 
      status: 'offline', 
      error: 'Database connection failed' 
    });
  }
};