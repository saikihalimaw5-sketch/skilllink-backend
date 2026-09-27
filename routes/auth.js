const express = require('express'); 
const router = express.Router(); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const nodemailer = require('nodemailer'); 
const rateLimit = require('express-rate-limit'); 
const User = require('../models/User'); 

// rate limiter 
const loginLimiter = rateLimit({ 
  windowMs: 3 * 60 * 1000,  
  max: 10, 
  message: { message: 'Too many login attempts. Please try again after 3 minutes.' } 
}); 


// Apply Rate Limiter to all Auth Routes 
router.use(loginLimiter); 

const transporter = nodemailer.createTransport({ 
  service: 'gmail', 
  auth: { 
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS 
  } 
}); 

const TEMP_SECRET = process.env.JWT_SECRET || 'secretkey123'; 

// signup 
router.post('/signup', async (req, res) => { 
  try { 
    const { fullName, email, password, phoneNumber, role } = req.body; 

    if (!fullName || !email || !password || !phoneNumber) { 
      return res.status(400).json({ message: 'Please fill in all required fields.' }); 
    } 

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() }); 
    if (existingUser) { 
      return res.status(400).json({ message: 'An account with this email address already exists.' }); 
    } 

    const salt = await bcrypt.genSalt(10); 
    const hashedPassword = await bcrypt.hash(password, salt); 
    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString(); 

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
    res.status(500).json({ message: 'Server error during signup.', error: error.message }); 
  } 
}); 

// login 
router.post('/login', async (req, res) => { 
  try { 
    const { email, password } = req.body; 

    const user = await User.findOne({ email: email.toLowerCase().trim() }); 
    if (!user) { 
      return res.status(400).json({ message: 'Invalid email or password.' }); 
    } 

    const isMatch = await bcrypt.compare(password, user.password); 
    if (!isMatch) { 
      return res.status(400).json({ message: 'Invalid email or password.' }); 
    } 

    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString(); 
    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(Date.now() + 3 * 60 * 1000); 
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
    res.status(500).json({ message: 'Server error during login.', error: error.message }); 
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
        return res.status(400).json({ message: 'Signup session expired. Please try signing up again.' }); 
      } 

      if (decoded.otp !== otp) { 
        return res.status(400).json({ message: 'Incorrect OTP code. Please try again.' }); 
      } 

      const existingUser = await User.findOne({ email: decoded.email }); 
      if (existingUser) { 
        return res.status(400).json({ message: 'An account with this email address already exists.' }); 
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
        { id: newUser._id, role: newUser.role }, 
        process.env.JWT_SECRET || 'secretkey123', 
        { expiresIn: '1h' } 
      ); 

      return res.status(201).json({ 
        message: 'Account successfully verified and created!', 
        token, 
        user: { id: newUser._id, fullName: newUser.fullName, email: newUser.email, role: newUser.role } 
      }); 
    } 

    // login flow 
    const cleanEmail = email ? email.toLowerCase().trim() : ''; 
    const user = await User.findOne({ email: cleanEmail }); 

    if (!user || !user.otp) { 
      return res.status(400).json({ message: 'Invalid verification request or missing session.' }); 
    } 

    if (new Date() > user.otpExpiresAt) { 
      return res.status(400).json({ message: 'OTP code has expired. Please log in again.' }); 
    } 

    if (user.otp !== otp) { 
      return res.status(400).json({ message: 'Incorrect OTP code. Please try again.' }); 
    } 

    user.otp = null; 
    user.otpExpiresAt = null; 
    user.isMfaVerified = true; 
    await user.save(); 

    const token = jwt.sign( 
      { id: user._id, role: user.role }, 
      process.env.JWT_SECRET || 'secretkey123', 
      { expiresIn: '1h' } 
    ); 

    res.status(200).json({ 
      message: 'Login successful!', 
      token, 
      user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role } 
    }); 

  } catch (error) { 
    res.status(500).json({ message: 'Server error during OTP verification.', error: error.message }); 
  } 
}); 

// resend otp  
router.post('/resend-otp', async (req, res) => { 
  try { 
    const { email, signupToken } = req.body; 

    if (signupToken) { 
      let decoded; 
      try { 
        decoded = jwt.verify(signupToken, TEMP_SECRET, { ignoreExpiration: true }); 
      } catch (err) { 
        return res.status(400).json({ message: 'Invalid signup session. Please sign up again.' }); 
      } 

      const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString(); 

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

    const cleanEmail = email ? email.toLowerCase().trim() : ''; 
    const user = await User.findOne({ email: cleanEmail }); 
    if (!user) { 
      return res.status(400).json({ message: 'User not found.' }); 
    } 

    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString(); 
    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(Date.now() + 3 * 60 * 1000); 
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

    res.status(200).json({ message: 'A new verification code has been sent to your email address.' }); 

  } catch (error) { 
    res.status(500).json({ message: 'Server error during OTP resend.', error: error.message }); 
  } 
}); 

// forgot password 
router.post('/forgot-password', async (req, res) => { 
  try { 
    const { email } = req.body; 

    if (!email) { 
      return res.status(400).json({ message: 'Please provide your email address.' }); 
    } 

    const cleanEmail = email.toLowerCase().trim(); 
    const user = await User.findOne({ email: cleanEmail }); 

    if (!user) { 
      return res.status(404).json({ message: 'No account found with this email address.' }); 
    } 

    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString(); 
    user.otp = generatedOTP; 
    user.otpExpiresAt = new Date(Date.now() + 3 * 60 * 1000); // Expires in 3 minutes 
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

    res.status(200).json({ message: 'Password reset code sent to your email address!' }); 

  } catch (error) { 
    res.status(500).json({ message: 'Server error sending password reset code.', error: error.message }); 
  } 
}); 

// reset password 
router.post('/reset-password', async (req, res) => { 
  try { 
    const { email, otp, newPassword } = req.body; 

    if (!email || !otp || !newPassword) { 
      return res.status(400).json({ message: 'Please provide email, OTP, and new password.' }); 
    } 

    const cleanEmail = email.toLowerCase().trim(); 
    const user = await User.findOne({ email: cleanEmail }); 

    if (!user || !user.otp) { 
      return res.status(400).json({ message: 'Invalid request or missing session.' }); 
    } 

    if (new Date() > user.otpExpiresAt) { 
      return res.status(400).json({ message: 'Reset code has expired. Please request a new code.' }); 
    } 

    if (user.otp !== otp) { 
      return res.status(400).json({ message: 'Incorrect reset code. Please try again.' }); 
    } 

    // Hash  
    const salt = await bcrypt.genSalt(10); 
    user.password = await bcrypt.hash(newPassword, salt); 

    // Clear OTP fields 
    user.otp = null; 
    user.otpExpiresAt = null; 
    await user.save(); 

    res.status(200).json({ message: 'Password reset successful! You can now log in with your new password.' }); 

  } catch (error) { 
    res.status(500).json({ message: 'Server error resetting password.', error: error.message }); 
  } 
}); 

module.exports = router;