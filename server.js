const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet'); // 🔒 Security Headers Middleware
require('dotenv').config();

const authRoutes = require('./routes/auth');
const { verifyToken, checkRole } = require('./middleware/authMiddleware');

const app = express();

// security headers
app.use(helmet());

// CORS config for frontend access
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));

app.use(express.json());

// Public Auth Routes
app.use('/api/auth', authRoutes);

// Protected Routes (Requires JWT Token)
app.get('/api/user/profile', verifyToken, (req, res) => {
  res.status(200).json({
    message: 'Access granted to user profile.',
    user: req.user
  });
});

// Admin-Only Protected Route
app.get('/api/admin/dashboard', verifyToken, checkRole(['admin']), (req, res) => {
  res.status(200).json({
    message: 'Access granted to Admin Dashboard.'
  });
});

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB (SkillLink DB)'))
  .catch(err => console.error('Database connection error:', err.message));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));