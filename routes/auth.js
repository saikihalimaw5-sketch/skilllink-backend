const express = require('express'); 
const router = express.Router(); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const { google } = require('googleapis');
const rateLimit = require('express-rate-limit'); 
const User = require('../models/User'); 

// Rate limiter
// Login attempts lang ang lilimitahan.
// Hindi kasama ang /users, /my-hobbies, /save-hobbies, etc.
const loginLimiter = rateLimit({ 
  windowMs: 3 * 60 * 1000,  
  max: 15, 
  message: { 
    message: 'Too many login attempts. Please try again after 3 minutes.' 
  } 
}); 

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const gmail = google.gmail({
  version: 'v1',
  auth: oauth2Client
});

const transporter = {
  async sendMail({ from, to, subject, html }) {
    const rawMessage = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage).toString('base64url');

    return gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });
  }
};

const TEMP_SECRET = process.env.JWT_SECRET || 'secretkey123'; 

// JWT Middleware para ma-verify ang logged in user
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      message: 'Unauthorized. No token provided.' 
    });
  }

  try {
    const decoded = jwt.verify(token, TEMP_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      message: 'Invalid or expired token.' 
    });
  }
};

// signup 
router.post('/signup', async (req, res) => { 
  try { 
    const { fullName, email, password, phoneNumber, role } = req.body; 

    if (!fullName || !email || !password || !phoneNumber) { 
      return res.status(400).json({ 
        message: 'Please fill in all required fields.' 
      }); 
    } 

    const existingUser = await User.findOne({ 
      email: email.toLowerCase().trim() 
    }); 

    if (existingUser) { 
      return res.status(400).json({ 
        message: 'An account with this email address already exists.' 
      }); 
    } 

    const salt = await bcrypt.genSalt(10); 
    const hashedPassword = await bcrypt.hash(password, salt); 
    const generatedOTP = Math.floor(
      100000 + Math.random() * 900000
    ).toString(); 

    const signupToken = jwt.sign( 
      { 
        fullName, 
        email: email.toLowerCase().trim(), 
        password: hashedPassword, 
        phoneNumber, 
        role: role || 'student', 
        otp: generatedOTP 
      }, 
      TEMP_SECRET, 
      { expiresIn: '3m' } 
    ); 

    await transporter.sendMail({ 
      from: `"SkillLink Verification" <${process.env.EMAIL_USER}>`, 
      to: email, 
      subject: 'Verify Your SkillLink Account', 
      html: ` 
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px;"> 
          <h2 style="color: #a855f7;">Welcome to SkillLink!</h2> 
          <p>Hello ${fullName},</p> 
          <p>Please use this 6-digit code to verify and complete your registration:</p> 
          <h1 style="background-color: #1e293b; color: #38bdf8; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">${generatedOTP}</h1> 
          <p style="color: #94a3b8; font-size: 12px;">This code will expire in 3 minutes.</p> 
        </div> 
      ` 
    }); 

    res.status(200).json({ 
      requireMFA: true, 
      email: email, 
      signupToken: signupToken, 
      message: 'Verification code sent to your email address.' 
    }); 

  } catch (error) { 
    res.status(500).json({ 
      message: 'Server error during signup.', 
      error: error.message 
    }); 
  } 
}); 

// login
// IMPORTANT: rate limiter is applied ONLY to login.
router.post('/login', loginLimiter, async (req, res) => { 
  try { 
    const { email, password } = req.body; 

    const user = await User.findOne({
  email: email.toLowerCase().trim()
}).select('+password');
    if (!user) { 
      return res.status(400).json({ 
        message: 'Invalid email or password.' 
      }); 
    } 

    const isMatch = await bcrypt.compare(password, user.password); 

    if (!isMatch) { 
      return res.status(400).json({ 
        message: 'Invalid email or password.' 
      }); 
    } 

    const generatedOTP = Math.floor(
      100000 + Math.random() * 900000
    ).toString(); 

    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(
      Date.now() + 3 * 60 * 1000
    ); 

    await user.save(); 

    await transporter.sendMail({ 
      from: `"SkillLink Verification" <${process.env.EMAIL_USER}>`, 
      to: user.email, 
      subject: 'Your SkillLink Verification Code', 
      html: ` 
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px;"> 
          <h2 style="color: #a855f7;">SkillLink Verification Code</h2> 
          <p>Hello ${user.fullName},</p> 
          <p>Please use this 6-digit code to complete security verification:</p> 
          <h1 style="background-color: #1e293b; color: #38bdf8; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">${generatedOTP}</h1> 
          <p style="color: #94a3b8; font-size: 12px;">This code will expire in 3 minutes.</p> 
        </div> 
      ` 
    }); 

    res.status(200).json({ 
      requireMFA: true, 
      email: user.email, 
      message: 'Verification code sent to your email address.' 
    }); 

  } catch (error) {
  console.error('LOGIN ERROR:', error.message);

  res.status(500).json({
    message: 'Server error during login.'
  });
}
}); 

// otp verification route 
router.post('/verify-otp', async (req, res) => { 
  try { 
    const { email, otp, signupToken } = req.body; 

    // A. SIGNUP FLOW 
    if (signupToken) { 
      let decoded; 

      try { 
        decoded = jwt.verify(signupToken, TEMP_SECRET); 
      } catch (err) { 
        return res.status(400).json({ 
          message: 'Signup session expired. Please try signing up again.' 
        }); 
      } 

      if (decoded.otp !== otp) { 
        return res.status(400).json({ 
          message: 'Incorrect OTP code. Please try again.' 
        }); 
      } 

      const existingUser = await User.findOne({ 
        email: decoded.email 
      }); 

      if (existingUser) { 
        return res.status(400).json({ 
          message: 'An account with this email address already exists.' 
        }); 
      } 

      const newUser = new User({ 
        fullName: decoded.fullName, 
        email: decoded.email, 
        password: decoded.password, 
        phoneNumber: decoded.phoneNumber, 
        role: decoded.role, 
        isMfaVerified: true 
      }); 

      await newUser.save(); 

      const token = jwt.sign( 
        { 
          id: newUser._id, 
          role: newUser.role 
        }, 
        TEMP_SECRET, 
        { expiresIn: '7d' } 
      ); 

      return res.status(201).json({ 
        message: 'Account successfully verified and created!', 
        token, 
        user: { 
          id: newUser._id, 
          fullName: newUser.fullName, 
          email: newUser.email, 
          role: newUser.role 
        } 
      }); 
    } 

    // B. LOGIN FLOW 
    const cleanEmail = email 
      ? email.toLowerCase().trim() 
      : ''; 

    const user = await User.findOne({ 
      email: cleanEmail 
    }); 

    if (!user || !user.otp) { 
      return res.status(400).json({ 
        message: 'Invalid verification request or missing session.' 
      }); 
    } 

    if (new Date() > user.otpExpiresAt) { 
      return res.status(400).json({ 
        message: 'OTP code has expired. Please log in again.' 
      }); 
    } 

    if (user.otp !== otp) { 
      return res.status(400).json({ 
        message: 'Incorrect OTP code. Please try again.' 
      }); 
    } 

    user.otp = null; 
    user.otpExpiresAt = null; 
    user.isMfaVerified = true; 

    await user.save(); 

    const token = jwt.sign( 
      { 
        id: user._id, 
        role: user.role 
      }, 
      TEMP_SECRET, 
      { expiresIn: '7d' } 
    ); 

    res.status(200).json({
  message: 'Login successful!',
  token,
  user: {
    id: user._id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role,
    profileImage: user.profileImage,
    avatarStyle: user.avatarStyle,
phoneNumber: user.phoneNumber
    
  }
});

  } catch (error) { 
    res.status(500).json({ 
      message: 'Server error during OTP verification.', 
      error: error.message 
    }); 
  } 
}); 

// resend otp   
router.post('/resend-otp', async (req, res) => { 
  try { 
    const { email, signupToken } = req.body; 

    if (signupToken) { 
      let decoded; 

      try { 
        decoded = jwt.verify(
          signupToken, 
          TEMP_SECRET, 
          { ignoreExpiration: true }
        ); 
      } catch (err) { 
        return res.status(400).json({ 
          message: 'Invalid signup session. Please sign up again.' 
        }); 
      } 

      const generatedOTP = Math.floor(
        100000 + Math.random() * 900000
      ).toString(); 

      const newSignupToken = jwt.sign( 
        { 
          fullName: decoded.fullName, 
          email: decoded.email, 
          password: decoded.password, 
          phoneNumber: decoded.phoneNumber, 
          role: decoded.role, 
          otp: generatedOTP 
        }, 
        TEMP_SECRET, 
        { expiresIn: '3m' } 
      ); 

      await transporter.sendMail({ 
        from: `"SkillLink Verification" <${process.env.EMAIL_USER}>`, 
        to: decoded.email, 
        subject: 'Your New SkillLink Verification Code', 
        html: ` 
          <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px;"> 
            <h2 style="color: #a855f7;">New Verification Code</h2> 
            <p>Hello ${decoded.fullName},</p> 
            <p>Please use this new 6-digit code for your signup verification:</p> 
            <h1 style="background-color: #1e293b; color: #38bdf8; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">${generatedOTP}</h1> 
            <p style="color: #94a3b8; font-size: 12px;">This code will expire in 3 minutes.</p> 
          </div> 
        ` 
      }); 

      return res.status(200).json({ 
        message: 'A new verification code has been sent to your email.', 
        signupToken: newSignupToken 
      }); 
    } 

    const cleanEmail = email 
      ? email.toLowerCase().trim() 
      : ''; 

    const user = await User.findOne({ 
      email: cleanEmail 
    }); 

    if (!user) { 
      return res.status(400).json({ 
        message: 'User not found.' 
      }); 
    } 

    const generatedOTP = Math.floor(
      100000 + Math.random() * 900000
    ).toString(); 

    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(
      Date.now() + 3 * 60 * 1000
    ); 

    await user.save(); 

    await transporter.sendMail({ 
      from: `"SkillLink Verification" <${process.env.EMAIL_USER}>`, 
      to: user.email, 
      subject: 'Your New SkillLink Verification Code', 
      html: ` 
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px;"> 
          <h2 style="color: #a855f7;">New Verification Code</h2> 
          <p>Hello ${user.fullName},</p> 
          <p>Please use this new 6-digit code for your login verification:</p> 
          <h1 style="background-color: #1e293b; color: #38bdf8; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">${generatedOTP}</h1> 
          <p style="color: #94a3b8; font-size: 12px;">This code will expire in 3 minutes.</p> 
        </div> 
      ` 
    }); 

    res.status(200).json({ 
      message: 'A new verification code has been sent to your email address.' 
    }); 

  } catch (error) { 
    res.status(500).json({ 
      message: 'Server error during OTP resend.', 
      error: error.message 
    }); 
  } 
}); 

// forgot password 
router.post('/forgot-password', async (req, res) => { 
  try { 
    const { email } = req.body; 

    if (!email) { 
      return res.status(400).json({ 
        message: 'Please provide your email address.' 
      }); 
    } 

    const cleanEmail = email.toLowerCase().trim(); 

    const user = await User.findOne({ 
      email: cleanEmail 
    }); 

    if (!user) { 
      return res.status(404).json({ 
        message: 'No account found with this email address.' 
      }); 
    } 

    const generatedOTP = Math.floor(
      100000 + Math.random() * 900000
    ).toString(); 

    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(
      Date.now() + 3 * 60 * 1000
    ); 

    await user.save(); 

    await transporter.sendMail({ 
      from: `"SkillLink Verification" <${process.env.EMAIL_USER}>`, 
      to: user.email, 
      subject: 'Reset Your SkillLink Password', 
      html: ` 
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px;"> 
          <h2 style="color: #a855f7;">Password Reset Request</h2> 
          <p>Hello ${user.fullName},</p> 
          <p>You requested to reset your password. Please use this 6-digit code to reset your password:</p> 
          <h1 style="background-color: #1e293b; color: #38bdf8; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">${generatedOTP}</h1> 
          <p style="color: #94a3b8; font-size: 12px;">This code will expire in 3 minutes. If you did not request this, please ignore this email.</p> 
        </div> 
      ` 
    }); 

    res.status(200).json({ 
      message: 'Password reset code sent to your email address!' 
    }); 

  } catch (error) { 
    res.status(500).json({ 
      message: 'Server error sending password reset code.', 
      error: error.message 
    }); 
  } 
}); 

// reset password 
router.post('/reset-password', async (req, res) => { 
  try { 
    const { email, otp, newPassword } = req.body; 

    if (!email || !otp || !newPassword) { 
      return res.status(400).json({ 
        message: 'Please provide email, OTP, and new password.' 
      }); 
    } 

    const cleanEmail = email.toLowerCase().trim(); 

    const user = await User.findOne({ 
      email: cleanEmail 
    }); 

    if (!user || !user.otp) { 
      return res.status(400).json({ 
        message: 'Invalid request or missing session.' 
      }); 
    } 

    if (new Date() > user.otpExpiresAt) { 
      return res.status(400).json({ 
        message: 'Reset code has expired. Please request a new code.' 
      }); 
    } 

    if (user.otp !== otp) { 
      return res.status(400).json({ 
        message: 'Incorrect reset code. Please try again.' 
      }); 
    } 

    const salt = await bcrypt.genSalt(10); 
    user.password = await bcrypt.hash(newPassword, salt); 

    user.otp = null; 
    user.otpExpiresAt = null; 

    await user.save(); 

    res.status(200).json({ 
      message: 'Password reset successful! You can now log in with your new password.' 
    }); 

  } catch (error) { 
    res.status(500).json({ 
      message: 'Server error resetting password.', 
      error: error.message 
    }); 
  } 
}); 

// ==============================================
// NEW ROUTES: HOBBIES & USERS SYNCING
// ==============================================

// 1. Save or Update Hobbies for Logged-In User
router.post('/save-hobbies', verifyToken, async (req, res) => {
  try {
    const { hobbies } = req.body;
    const userId = req.user.id || req.user._id;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { hobbies: hobbies },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    res.status(200).json({ 
      message: 'Hobbies saved successfully!', 
      hobbies: updatedUser.hobbies 
    });

  } catch (error) {
    res.status(500).json({
      message: 'Error saving hobbies.',
      error: error.message
    });
  }
});

// 2. Fetch Hobbies of Logged-In User
router.get('/my-hobbies', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId)
      .select('hobbies');

    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    res.status(200).json({
      hobbies: user.hobbies || []
    });

  } catch (error) {
    res.status(500).json({
      message: 'Error fetching hobbies.',
      error: error.message
    });
  }
});

// 3. Get All Registered Users
router.get('/users', verifyToken, async (req, res) => {
  try {
    const users = await User.find()
      .select('username profileImage avatarStyle bio hobbies role updatedAt');

    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users:', error);

    res.status(500).json({
      message: 'Error fetching users.'
    });
  }
});
// 4. Update Profile for Logged-In User
router.put('/update-profile', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { username, phoneNumber, bio, profileImage, avatarStyle } = req.body;

    // Validate username
    if (
      typeof username !== 'string' ||
!/^[a-zA-Z0-9_]{3,15}$/.test(username.trim())  
  ) {
      return res.status(400).json({
        message: 'Username must be 3–15 characters using letters, numbers, or underscores.'
      });
    }

    // Validate phone number
    if (
      phoneNumber !== undefined &&
      (typeof phoneNumber !== 'string' ||
        (phoneNumber.trim() &&
          !/^\+?[0-9\s\-()]{7,20}$/.test(phoneNumber.trim())))
    ) {
      return res.status(400).json({
        message: 'Please enter a valid phone number.'
      });
    }

    // Validate bio
    if (
      bio !== undefined &&
      (typeof bio !== 'string' || bio.trim().length > 250)
    ) {
      return res.status(400).json({
        message: 'About Me must not exceed 250 characters.'
      });
    }

    const updates = {
      username: username.trim()
    };

    if (phoneNumber !== undefined) {
      updates.phoneNumber = phoneNumber.trim();
    }

    // These fields are optional; only update them if supplied.
    if (bio !== undefined) {
      updates.bio = bio.trim();
    }

    if (profileImage !== undefined) {
      updates.profileImage = profileImage;
    }

    if (avatarStyle !== undefined) {
      updates.avatarStyle = avatarStyle;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      {
        new: true,
        runValidators: true
      }
    ).select('-password -otp -otpExpiresAt');

    if (!updatedUser) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }
// Notify connected users about the updated profile
const io = req.app.get('io');

if (io) {
  io.emit('profile_updated', {
    userId: String(updatedUser._id),
    username: updatedUser.username,
    profileImage: updatedUser.profileImage,
    avatarStyle: updatedUser.avatarStyle
  });
}
    return res.status(200).json({
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update profile error:', error);

    return res.status(500).json({
      message: 'Error updating profile.',
      error: error.message
    });
  }
});

// 5. Get Profile of Logged-In User
router.get('/my-profile', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId)
      .select('-password -otp -otpExpiresAt');

    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error('Get profile error:', error);

    return res.status(500).json({
      message: 'Error fetching profile.',
      error: error.message
    });
  }
});

module.exports = router;