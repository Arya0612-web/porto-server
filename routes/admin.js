const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT id, username, password_hash FROM admin_users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Admin tidak ditemukan' });
    }

    const admin = rows[0];

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Password salah' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      'SECRET_KEY_ADMIN',
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: admin.id,
        username: admin.username
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
