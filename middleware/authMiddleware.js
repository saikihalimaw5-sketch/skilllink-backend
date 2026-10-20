
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies JWT and checks the current account status
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Access denied. No authentication token provided.'
    });
  }

  const token = authHeader.split(' ')[1];

    if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is missing.');

    return res.status(500).json({
      message: 'Authentication service is not configured.'
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );
  } catch (error) {
    return res.status(403).json({
      message: 'Invalid or expired token. Please log in again.'
    });
  }

  try {
    // Support the existing JWT user ID formats
    const userId =
      decoded.id ||
      decoded._id ||
      decoded.userId ||
      decoded.sub;

    if (!userId) {
      return res.status(401).json({
        message: 'Invalid authenticated user.'
      });
    }

    const user = await User.findById(userId)
      .select('role accountStatus')
      .lean();

    if (!user) {
      return res.status(401).json({
        message: 'User account not found.'
      });
    }

    // Existing users without accountStatus remain active
    const accountStatus = user.accountStatus || 'active';

    if (accountStatus === 'suspended') {
      return res.status(403).json({
        message: 'Your account has been suspended. Please contact the administrator.',
        accountStatus: 'suspended'
      });
    }

    if (accountStatus === 'blocked') {
      return res.status(403).json({
        message: 'Your account has been blocked. Please contact the administrator.',
        accountStatus: 'blocked'
      });
    }

    // Preserve decoded token data and use the current database role
    req.user = {
      ...decoded,
      role: user.role,
      accountStatus
    };

    next();
  } catch (error) {
    console.error('Authentication middleware error:', error.message);

    return res.status(500).json({
      message: 'Failed to verify account status.'
    });
  }
};

// Restricts access based on user role
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Access forbidden. You do not have permission.'
      });
    }

    next();
  };
};

module.exports = { verifyToken, checkRole };
