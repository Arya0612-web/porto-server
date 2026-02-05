// backend/models/ContactMessage.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ContactMessage = sequelize.define('ContactMessage', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'Nama harus diisi'
      },
      len: {
        args: [2, 100],
        msg: 'Nama harus antara 2-100 karakter'
      }
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'Email harus diisi'
      },
      isEmail: {
        msg: 'Format email tidak valid'
      }
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: 'Pesan harus diisi'
      },
      len: {
        args: [10, 5000],
        msg: 'Pesan harus antara 10-5000 karakter'
      }
    }
  },
  
  subject: {
    type: DataTypes.STRING(200),
    defaultValue: 'General Inquiry'
  },
  status: {
    type: DataTypes.ENUM('unread', 'read', 'replied', 'archived'),
    defaultValue: 'unread'
  },
  source: {
    type: DataTypes.ENUM('contact_form', 'direct_email', 'other'),
    defaultValue: 'contact_form'
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  replied_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'contact_messages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'idx_status',
      fields: ['status']
    },
    {
      name: 'idx_email',
      fields: ['email']
    },
    {
      name: 'idx_created_at',
      fields: ['created_at']
    },
    {
      name: 'idx_status_created',
      fields: ['status', 'created_at']
    }
  ]
});

module.exports = ContactMessage;