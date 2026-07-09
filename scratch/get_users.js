import database from '../service/database.js';

async function main() {
  try {
    const [rows] = await database.query('SELECT userName, role, isActive FROM users');
    console.log('Users in database:', rows);
  } catch (err) {
    console.error('Error fetching users:', err);
  } finally {
    process.exit(0);
  }
}

main();
