const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: { 
    type: String, 
    required: true 
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
  // email otp
  otp: { 
    type: String, 
    default: null 
  },
  otpExpiresAt: { 
    type: Date, 
    default: null 
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);