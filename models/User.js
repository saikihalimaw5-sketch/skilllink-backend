const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  fullName: {
  type: String,
  required: false
},
username: {
  type: String,
  trim: true,
  minlength: 3,
  maxlength: 15,
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
  default: 'avataaars'
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
  // Account Status - Admin Management
accountStatus: {
  type: String,
  enum: ['active', 'suspended', 'blocked'],
  default: 'active'
},
// Reason for account suspension or blocking
accountRestrictionReason: {
  type: String,
  trim: true,
  maxlength: 500,
  default: ''
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

  // Admin Change Password OTP - separate from Login OTP
  adminPasswordOtpHash: {
    type: String,
    default: null,
    select: false
  },
  adminPasswordOtpExpiresAt: {
    type: Date,
    default: null,
    select: false
  },
  adminPasswordOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  adminPasswordOtpLastSentAt: {
    type: Date,
    default: null,
    select: false
  },


  // Saved Hobbies & Interests
  hobbies: {
    type: [String],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);