// backend/routes/contact.js
const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/ContactMessage');

// POST contact form submission
router.post('/', async (req, res) => {
  try {
    const { name, email, message, subject } = req.body;

    // Validasi required fields
    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nama, email, dan pesan harus diisi' 
      });
    }

    // Validasi email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format email tidak valid' 
      });
    }

    // Simpan ke database
    const newMessage = await ContactMessage.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
    //   phone: phone ? phone.trim() : null,
      subject: subject ? subject.trim() : 'General Inquiry',
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('User-Agent'),
      source: 'contact_form'
    });

    // Kirim email notifikasi ke admin (opsional)
    // await sendEmailNotification(newMessage);

    res.status(201).json({ 
      success: true, 
      message: 'Pesan Anda telah dikirim. Terima kasih!',
      data: {
        id: newMessage.id,
        name: newMessage.name,
        email: newMessage.email,
        created_at: newMessage.created_at
      }
    });

  } catch (error) {
    console.error('Error saving contact message:', error);
    
    // Handle validation errors
    if (error.name === 'SequelizeValidationError') {
      const messages = error.errors.map(err => err.message);
      return res.status(400).json({ 
        success: false, 
        message: messages.join(', ') 
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server. Silakan coba lagi nanti.' 
    });
  }
});

module.exports = router;