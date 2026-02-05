const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'portfolio_db'
  });

  const hashedPassword = await bcrypt.hash('admiNaryA', 10);

  await db.execute(
    `INSERT INTO admin_users (username, email, password_hash)
     VALUES (?, ?, ?)
     `,
    ['Admin', 'admin@portfolio.com', hashedPassword]
  );

  console.log('✅ Admin berhasil dibuat');
  process.exit();
})();
