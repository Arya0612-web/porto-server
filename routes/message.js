// backend/routes/messages.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const ContactMessage = require('../models/ContactMessage');

// GET semua messages dengan pagination dan filter
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      search, 
      sortBy = 'created_at', 
      sortOrder = 'DESC' 
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {};
    
    if (status && status !== 'all') {
      where.status = status;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { message: { [Op.like]: `%${search}%` } }
      ];
    }

    // Build order
    const order = [[sortBy, sortOrder.toUpperCase()]];

    // Query dengan pagination
    const { count, rows: messages } = await ContactMessage.findAndCountAll({
      where,
      order,
      limit: limitNum,
      offset,
      attributes: { exclude: ['user_agent', '__v'] }
    });

    // Get statistics
    const unreadCount = await ContactMessage.count({ where: { status: 'unread' } });
    const repliedCount = await ContactMessage.count({ where: { status: 'replied' } });

    // Get today's messages
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayCount = await ContactMessage.count({
      where: {
        created_at: {
          [Op.gte]: today
        }
      }
    });

    res.status(200).json({
      success: true,
      messages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      },
      stats: {
        total: count,
        unread: unreadCount,
        replied: repliedCount,
        today: todayCount
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data pesan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET single message
router.get('/:id', async (req, res) => {
  try {
    const message = await ContactMessage.findByPk(req.params.id);
    
    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    // Update status to read jika belum dibaca
    if (message.status === 'unread') {
      message.status = 'read';
      message.read_at = new Date();
      await message.save();
    }

    res.status(200).json({
      success: true,
      message
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data pesan' 
    });
  }
});

// UPDATE message
router.put('/:id', async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    
    const message = await ContactMessage.findByPk(req.params.id);
    
    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    // Update fields
    if (status) {
      message.status = status;
      if (status === 'replied' && !message.replied_at) {
        message.replied_at = new Date();
      }
    }
    
    if (admin_notes !== undefined) {
      message.admin_notes = admin_notes;
    }

    await message.save();

    res.status(200).json({
      success: true,
      message: 'Pesan berhasil diperbarui',
      data: message
    });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memperbarui pesan' 
    });
  }
});

// DELETE message
router.delete('/:id', async (req, res) => {
  try {
    const message = await ContactMessage.findByPk(req.params.id);
    
    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    await message.destroy();

    res.status(200).json({
      success: true,
      message: 'Pesan berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghapus pesan' 
    });
  }
});

// GET message statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    // Get counts using parallel queries
    const [
      total,
      unread,
      replied,
      todayCount,
      yesterdayCount,
      last7Days,
      last30Days
    ] = await Promise.all([
      ContactMessage.count(),
      ContactMessage.count({ where: { status: 'unread' } }),
      ContactMessage.count({ where: { status: 'replied' } }),
      ContactMessage.count({ where: { created_at: { [Op.gte]: today } } }),
      ContactMessage.count({ 
        where: { 
          created_at: { 
            [Op.gte]: yesterday,
            [Op.lt]: today
          } 
        } 
      }),
      ContactMessage.count({ where: { created_at: { [Op.gte]: lastWeek } } }),
      ContactMessage.count({ where: { created_at: { [Op.gte]: lastMonth } } })
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        unread,
        replied,
        today: todayCount,
        yesterday: yesterdayCount,
        last7Days,
        last30Days
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil statistik' 
    });
  }
});

// GET messages by status (for sidebar badge)
router.get('/count/unread', async (req, res) => {
  try {
    const count = await ContactMessage.count({
      where: { status: 'unread' }
    });

    res.status(200).json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error counting unread messages:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghitung pesan belum dibaca' 
    });
  }
});

module.exports = router;