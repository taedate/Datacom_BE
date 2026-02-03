import database from "../service/database.js";
import bcrypt from 'bcrypt';
import jwt, { decode } from 'jsonwebtoken';
const secret = 'DaranWeb'

// เส้นทางสำหรับการลงทะเบียน
export async function memberRegister(req, res) {
  try {
    const { email, password, fname, lname } = req.body;

    // ตรวจสอบว่าค่าที่ส่งมามีครบหรือไม่
    if (!email || !password || !fname || !lname) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const saltRounds = 10;

    // ใช้ async/await เพื่อรอผลการ hash ของรหัสผ่าน
    const hash = await bcrypt.hash(password, saltRounds);

    // คำสั่ง SQL สำหรับการเพิ่มข้อมูลผู้ใช้
    const result = await database.query({
      text: `INSERT INTO users ("email", "password", "fname", "lname")
             VALUES ($1, $2, $3, $4)`,
      values: [email, hash, fname, lname],
    });

    console.log(result);  // ผลลัพธ์ที่ได้จากคำสั่ง SQL

    // ส่งการตอบกลับไปยัง client
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error querying database:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


export async function memberLogin(req, res) {
  console.log('Member Login')
    try {
      const { email, password } = req.body;
      console.log(email, password)
  
      // Query the database for the user by email
      const result = await database.query({
        text: `SELECT * FROM users WHERE "email" = $1`,
        values: [email],
      });
  
      // If no user is found, return an error
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      // Compare the hashed password with the stored hash in the database
      const loginok = await bcrypt.compare(password, result.rows[0].password);
  
      if (loginok) {
        // Create a JWT token if password matches
        const token = jwt.sign({ email: result.rows[0].email }, secret, { expiresIn: '1h' });
        // Return a successful response with the token
        return res.json({
          message: 'success',
          // data: result.rows[0],
          token,
        });
      } else {
        // If password does not match
        return res.status(401).json({ error: 'fail' });
      }
    } catch (error) {
      console.error('Error querying database:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }


export async function memberAuthen(req, res) {
    try {
        const token = req.headers.authorization.split(' ')[1]
        const decoded = jwt.verify(token, secret);
      // ส่งการตอบกลับไปยัง client
      res.status(201).json({message:'ok', decoded });
    } catch (error) {
      console.error('Error querying database:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  