// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 5 * 1024 * 1024 },
  abortOnLimit: true,
  safeFileNames: true,
  preserveExtension: true
}));

// Pastikan folder uploads ada
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));

// Database connection
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'portfolio_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Test database connection
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', error.message);
  }
})();

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verification error:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ========== CONTACT MESSAGES API ==========

// POST contact form submission
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, phone, subject } = req.body;

    console.log('Received contact form submission:', { name, email, subject });

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

    // Periksa apakah tabel contact_messages ada
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS contact_messages (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          subject VARCHAR(200) DEFAULT 'General Inquiry',
          status ENUM('unread', 'read', 'replied', 'archived') DEFAULT 'unread',
          source ENUM('contact_form', 'direct_email', 'phone', 'other') DEFAULT 'contact_form',
          ip_address VARCHAR(45),
          user_agent TEXT,
          read_at TIMESTAMP NULL,
          replied_at TIMESTAMP NULL,
          admin_notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('Table contact_messages ready');
    } catch (tableError) {
      console.error('Table creation error:', tableError);
    }

    // Simpan ke database
    const [result] = await pool.execute(
      `INSERT INTO contact_messages 
       (name, email, message, subject, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        message.trim(),
        subject ? subject.trim() : 'General Inquiry',
        req.ip || req.connection.remoteAddress,
        req.get('User-Agent')
      ]
    );

    console.log('Message saved to database with ID:', result.insertId);

    res.status(201).json({ 
      success: true, 
      message: 'Pesan Anda telah dikirim. Terima kasih!',
      data: {
        id: result.insertId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error saving contact message:', error);
    
    res.status(500).json({ 
      success: false, 
      message: 'Terjadi kesalahan server. Silakan coba lagi nanti.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET messages (Admin only)
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      search, 
      sortBy = 'created_at', 
      sortOrder = 'DESC' 
    } = req.query;

    // Debug: Log semua parameter masuk
    console.log('Query params:', { page, limit, status, search, sortBy, sortOrder });

    // Parse dan validasi parameter pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 10);
    const offset = (pageNum - 1) * limitNum;

    // Debug: Log parsed values
    console.log('Parsed values:', { pageNum, limitNum, offset });

    // Build WHERE clause
    let whereClause = '';
    const whereParams = [];
    
    if (status && status !== 'all') {
      whereClause += ' WHERE status = ?';
      whereParams.push(status);
    }

    if (search && search.trim() !== '') {
      const searchParam = `%${search.trim()}%`;
      if (whereClause) {
        whereClause += ' AND (name LIKE ? OR email LIKE ? OR message LIKE ?)';
      } else {
        whereClause = ' WHERE (name LIKE ? OR email LIKE ? OR message LIKE ?)';
      }
      whereParams.push(searchParam, searchParam, searchParam);
    }

    // Debug: Log WHERE clause dan parameters
    console.log('WHERE clause:', whereClause);
    console.log('WHERE params:', whereParams);

    // Validate sort column
    const allowedSortColumns = ['created_at', 'name', 'status'];
    const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // **BUILD QUERY UTAMA**
    const messagesSql = `
      SELECT * FROM contact_messages 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ${limitNum} OFFSET ${offset}
    `;
    
    // **PERBAIKAN: Pastikan semua parameter adalah tipe data yang benar**
    const messagesParams = [
      ...whereParams
    ];

    // Debug: Log SQL dan parameters
    console.log('SQL Query:', messagesSql);
    console.log('SQL Parameters:', messagesParams);
    console.log('Parameter types:', messagesParams.map(p => typeof p));

    // **Coba execute query utama**
    const [messages] = await pool.execute(messagesSql, messagesParams);
    console.log('Messages fetched:', messages.length);

    // **QUERY TOTAL COUNT**
    const countSql = `SELECT COUNT(*) as total FROM contact_messages ${whereClause}`;
    console.log('Count SQL:', countSql);
    console.log('Count params:', whereParams);
    
    const [countResult] = await pool.execute(countSql, whereParams);
    const total = countResult[0].total;

    // **STATISTICS - versi lebih aman dengan single query**
    const statsSql = `
      SELECT 
        COUNT(*) as total_all,
        COUNT(CASE WHEN status = 'unread' THEN 1 END) as unread,
        COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied,
        COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as today
      FROM contact_messages
    `;
    
    const [statsResult] = await pool.execute(statsSql);
    const stats = statsResult[0];

    res.status(200).json({
      success: true,
      messages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total,
        pages: Math.ceil(total / limitNum)
      },
      stats: {
        total: stats.total_all,
        unread: stats.unread,
        replied: stats.replied,
        today: stats.today
      }
    });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    console.error('Error details:', {
      code: error.code,
      errno: error.errno,
      sql: error.sql,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data pesan',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlMessage: error.sqlMessage
      } : undefined
    });
  }
});

// GET single message (Admin only)
app.get('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID pesan tidak valid' 
      });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM contact_messages WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    // Update status to read jika belum dibaca
    if (rows[0].status === 'unread') {
      await pool.execute(
        'UPDATE contact_messages SET status = "read", read_at = NOW() WHERE id = ?',
        [id]
      );
    }

    res.status(200).json({
      success: true,
      message: rows[0]
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data pesan' 
    });
  }
});

// UPDATE message (Admin only)
app.put('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID pesan tidak valid' 
      });
    }

    // Check if message exists
    const [checkRows] = await pool.execute(
      'SELECT id FROM contact_messages WHERE id = ?',
      [id]
    );
    
    if (checkRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    // Build update query
    const updates = [];
    const params = [];
    
    if (status) {
      updates.push('status = ?');
      params.push(status);
      
      if (status === 'replied') {
        updates.push('replied_at = NOW()');
      }
    }
    
    if (admin_notes !== undefined) {
      updates.push('admin_notes = ?');
      params.push(admin_notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tidak ada data yang diperbarui' 
      });
    }
    
    params.push(id);
    
    await pool.execute(
      `UPDATE contact_messages SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Get updated message
    const [rows] = await pool.execute(
      'SELECT * FROM contact_messages WHERE id = ?',
      [id]
    );

    res.status(200).json({
      success: true,
      message: 'Pesan berhasil diperbarui',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memperbarui pesan' 
    });
  }
});

// DELETE message (Admin only)
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID pesan tidak valid' 
      });
    }

    // Check if message exists
    const [checkRows] = await pool.execute(
      'SELECT id FROM contact_messages WHERE id = ?',
      [id]
    );
    
    if (checkRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Pesan tidak ditemukan' 
      });
    }

    await pool.execute(
      'DELETE FROM contact_messages WHERE id = ?',
      [id]
    );

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

// GET message statistics (Admin only)
app.get('/api/messages/stats/summary', authenticateToken, async (req, res) => {
  try {
    // Get counts
    const [totalResult] = await pool.execute('SELECT COUNT(*) as count FROM contact_messages');
    const [unreadResult] = await pool.execute('SELECT COUNT(*) as count FROM contact_messages WHERE status = "unread"');
    const [repliedResult] = await pool.execute('SELECT COUNT(*) as count FROM contact_messages WHERE status = "replied"');
    
    // Today's messages
    const today = new Date().toISOString().split('T')[0];
    const [todayResult] = await pool.execute(
      'SELECT COUNT(*) as count FROM contact_messages WHERE DATE(created_at) = ?',
      [today]
    );
    
    // Yesterday's messages
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const [yesterdayResult] = await pool.execute(
      'SELECT COUNT(*) as count FROM contact_messages WHERE DATE(created_at) = ?',
      [yesterdayStr]
    );
    
    // Last 7 days
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekStr = lastWeek.toISOString().split('T')[0];
    const [last7DaysResult] = await pool.execute(
      'SELECT COUNT(*) as count FROM contact_messages WHERE DATE(created_at) >= ?',
      [lastWeekStr]
    );
    
    // Last 30 days
    const lastMonth = new Date();
    lastMonth.setDate(lastMonth.getDate() - 30);
    const lastMonthStr = lastMonth.toISOString().split('T')[0];
    const [last30DaysResult] = await pool.execute(
      'SELECT COUNT(*) as count FROM contact_messages WHERE DATE(created_at) >= ?',
      [lastMonthStr]
    );

    res.status(200).json({
      success: true,
      stats: {
        total: totalResult[0].count,
        unread: unreadResult[0].count,
        replied: repliedResult[0].count,
        today: todayResult[0].count,
        yesterday: yesterdayResult[0].count,
        last7Days: last7DaysResult[0].count,
        last30Days: last30DaysResult[0].count
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

// GET unread messages count (Admin only)
app.get('/api/messages/count/unread', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM contact_messages WHERE status = "unread"'
    );

    res.status(200).json({
      success: true,
      count: result[0].count
    });
  } catch (error) {
    console.error('Error counting unread messages:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghitung pesan belum dibaca' 
    });
  }
});

// ========== END CONTACT MESSAGES API ==========

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Portfolio API',
    features: ['projects', 'contact', 'messages', 'authentication']
  });
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const [rows] = await pool.execute(
      'SELECT * FROM admin_users WHERE username = ?',
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username,
        role: 'admin'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username,
        name: user.full_name || user.username
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all projects
app.get('/api/projects', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM projects ORDER BY created_at DESC'
    );
    
    // Format response
    const projects = rows.map(project => ({
      ...project,
      views: project.views || 0
    }));
    
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
app.get('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    
    const [rows] = await pool.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Increment view count
    await pool.execute(
      'UPDATE projects SET views = COALESCE(views, 0) + 1 WHERE id = ?',
      [id]
    );
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Upload image
app.post('/api/upload', authenticateToken, async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded' });
    }
    
    const file = req.files.image;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }
    
    // Create unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}_${sanitizedName}`;
    const uploadPath = path.join(uploadsDir, filename);
    
    // Move file
    await file.mv(uploadPath);
    
    console.log(`File uploaded: ${filename}`);
    
    res.json({ 
      success: true,
      message: 'File uploaded successfully', 
      filename: filename,
      path: `/uploads/${filename}`,
      size: file.size,
      mimetype: file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message.includes('File too large')) {
      return res.status(413).json({ error: 'File size exceeds limit (5MB)' });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Create new project (Admin only)
app.post('/api/projects', authenticateToken, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      technologies, 
      image_url, 
      project_url, 
      github_url, 
      category,
      featured = false
    } = req.body;
    
    // Validation
    if (!title || !description || !technologies) {
      return res.status(400).json({ error: 'Title, description, and technologies are required' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO projects 
       (title, description, technologies, image_url, project_url, github_url, category, featured) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(), 
        description.trim(), 
        technologies.trim(), 
        image_url || null, 
        project_url || null, 
        github_url || null, 
        category || null, 
        featured
      ]
    );
    
    // Get created project
    const [rows] = await pool.execute(
      'SELECT * FROM projects WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({ 
      message: 'Project created successfully', 
      project: rows[0]
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project (Admin only)
app.put('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    
    const { 
      title, 
      description, 
      technologies, 
      image_url, 
      project_url, 
      github_url, 
      category,
      featured = false
    } = req.body;
    
    // Check if project exists
    const [checkRows] = await pool.execute(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );
    
    if (checkRows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Update project
    const [result] = await pool.execute(
      `UPDATE projects SET 
       title = ?, description = ?, technologies = ?, image_url = ?, 
       project_url = ?, github_url = ?, category = ?, featured = ?, 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [
        title?.trim() || '', 
        description?.trim() || '', 
        technologies?.trim() || '', 
        image_url || null, 
        project_url || null, 
        github_url || null, 
        category || null, 
        featured, 
        id
      ]
    );
    
    // Get updated project
    const [rows] = await pool.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    
    res.json({ 
      message: 'Project updated successfully', 
      project: rows[0]
    });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project (Admin only)
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    
    // Get project info for image cleanup
    const [projectRows] = await pool.execute(
      'SELECT image_url FROM projects WHERE id = ?',
      [id]
    );
    
    if (projectRows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Delete from database
    const [result] = await pool.execute(
      'DELETE FROM projects WHERE id = ?',
      [id]
    );
    
    // Optionally delete associated image file
    if (projectRows[0].image_url) {
      const imagePath = path.join(__dirname, projectRows[0].image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        console.log(`Deleted image file: ${imagePath}`);
      }
    }
    
    res.json({ 
      message: 'Project deleted successfully',
      deletedId: id
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Get featured projects
app.get('/api/projects/featured', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM projects WHERE featured = true ORDER BY created_at DESC LIMIT 6'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching featured projects:', error);
    res.status(500).json({ error: 'Failed to fetch featured projects' });
  }
});

// Get projects by category
app.get('/api/projects/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const [rows] = await pool.execute(
      'SELECT * FROM projects WHERE category = ? ORDER BY created_at DESC',
      [category]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching projects by category:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.post("/api/projects/:id/view", async (req, res) => {
  try {
    const projectId = req.params.id;

    // Update views +1
    await pool.execute(
      "UPDATE projects SET views = views + 1 WHERE id = ?",
      [projectId]
    );

    // Ambil views terbaru
    const [rows] = await pool.execute(
      "SELECT views FROM projects WHERE id = ?",
      [projectId]
    );

    res.json({
      success: true,
      views: rows[0].views
    });

  } catch (error) {
    console.error("Error updating views:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update views"
    });
  }
});

app.get("/api/dashboard/stats", authenticateToken, async (req, res) => {
  try {
    // 1. Total Projects
    const [totalProjectsResult] = await pool.execute(`
      SELECT COUNT(*) as totalProjects 
      FROM projects
    `);

    // 2. Published Projects
    // const [publishedProjectsResult] = await pool.execute(`
    //   SELECT COUNT(*) as publishedProjects 
    //   FROM projects
    //   WHERE status = 'published'
    // `);

    // 3. Featured Projects
    const [featuredProjectsResult] = await pool.execute(`
      SELECT COUNT(*) as featuredProjects 
      FROM projects
      WHERE featured = 1
    `);

    // 4. Total Views
    const [totalViewsResult] = await pool.execute(`
      SELECT SUM(views) as totalViews 
      FROM projects
    `);

    // // 5. Today Views (views hari ini)
    // const [todayViewsResult] = await pool.execute(`
    //   SELECT SUM(today_views) as todayViews
    //   FROM projects
    // `);

    // 6. Total Messages
    const [totalMessagesResult] = await pool.execute(`
      SELECT COUNT(*) as totalMessages
      FROM contact_messages
    `);

    res.json({
      success: true,
      stats: {
        totalProjects: totalProjectsResult[0].totalProjects,
        // publishedProjects: publishedProjectsResult[0].publishedProjects,
        featuredProjects: featuredProjectsResult[0].featuredProjects,
        totalViews: totalViewsResult[0].totalViews || 0,
        // todayViews: todayViewsResult[0].todayViews || 0,
        totalMessages: totalMessagesResult[0].totalMessages
      }
    });

  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard stats"
    });
  }
});



// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📧 Contact endpoint: http://localhost:${PORT}/api/contact`);
  console.log(`📨 Messages endpoint: http://localhost:${PORT}/api/messages`);
});