const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  username: {
    type: String,
    trim: true,
    minlength: 3,
    maxlength: 8,
    match: /^[a-zA-Z0-9_]+$/
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phoneNumber: {
    type: String,
    required: false
  },

  profileImage: {
    type: String,
    default: ''
  },
  avatarStyle: {
    type: String,
    default: 'default'
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['student', 'client', 'admin'],
    default: 'student'
  },
  isMfaVerified: {
    type: Boolean,
    default: false
  },

  // Email OTP
  otp: {
    type: String,
    default: null
  },
  otpExpiresAt: {
    type: Date,
    default: null
  },

  // Saved Hobbies & Interests
  hobbies: {
    type: [String],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);