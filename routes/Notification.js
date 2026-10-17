
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { verifyToken } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const Connection = require('../models/Connection');
const User = require('../models/User');

// Protect every route in this file.
router.use(verifyToken);

// Get the logged-in user's ID from the token.
const getUserId = (req) => {
  return (
    req.user?.id ||
    req.user?._id ||
    req.user?.userId ||
    req.user?.sub ||
    ''
  ).toString();
};

// Check valid MongoDB IDs.
const isValidId = (id) =>
  Boolean(id) && mongoose.isValidObjectId(id);

// Ensure a user can only access their own notifications.
const isOwnUser = (req, userId) =>
  getUserId(req) === String(userId);

// --------------------------------------------------
// GET ALL NOTIFICATIONS FOR A USER
// GET /api/notifications/:userId
// --------------------------------------------------
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidId(userId)) {
      return res.status(400).json({
        message: 'Invalid user ID.',
      });
    }

    if (!isOwnUser(req, userId)) {
      return res.status(403).json({
        message: 'You can only view your own notifications.',
      });
    }

    const notifications = await Notification.find({
      userId,
      hiddenFor: { $ne: userId },
    })
.populate('senderId', 'fullName username email profileImage avatarStyle')      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);

    return res.status(500).json({
      message: 'Failed to retrieve notifications.',
    });
  }
});

// --------------------------------------------------
// MARK ALL NOTIFICATIONS AS READ
// PUT /api/notifications/mark-all-read/:userId
// --------------------------------------------------
router.put('/mark-all-read/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidId(userId)) {
      return res.status(400).json({
        message: 'Invalid user ID.',
      });
    }

    if (!isOwnUser(req, userId)) {
      return res.status(403).json({
        message: 'You can only update your own notifications.',
      });
    }

    const result = await Notification.updateMany(
      {
        userId,
        hiddenFor: { $ne: userId },
        isRead: false,
      },
      {
        $set: { isRead: true },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);

    return res.status(500).json({
      message: 'Failed to mark notifications as read.',
    });
  }
});

// --------------------------------------------------
// HIDE ALL NOTIFICATIONS FOR THE LOGGED-IN USER
// PATCH /api/notifications/hide-all
// --------------------------------------------------
router.patch('/hide-all', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid or missing user identity.',
      });
    }

    const result = await Notification.updateMany(
      {
        userId,
        hiddenFor: { $ne: userId },
      },
      {
        $addToSet: { hiddenFor: userId },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Notifications hidden successfully.',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Hide all notifications error:', error);

    return res.status(500).json({
      message: 'Failed to hide notifications.',
    });
  }
});

// --------------------------------------------------
// ACCEPT OR DECLINE A CONNECTION REQUEST
// PUT /api/notifications/action/:notificationId
// --------------------------------------------------
router.put('/action/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { status } = req.body;
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user identity.',
      });
    }

    if (!isValidId(notificationId)) {
      return res.status(400).json({
        message: 'Invalid notification ID.',
      });
    }

    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be accepted or declined.',
      });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      userId,
      hiddenFor: { $ne: userId },
      type: 'Request',
    });

    if (!notification) {
      return res.status(404).json({
        message: 'Request notification not found.',
      });
    }

    if (notification.status !== 'pending') {
      return res.status(409).json({
        message: 'This request has already been processed.',
        status: notification.status,
      });
    }

    if (!notification.requestId) {
      return res.status(400).json({
        message: 'No connection request is linked to this notification.',
      });
    }

    // Only the actual recipient can accept or decline.
    const connection = await Connection.findOneAndUpdate(
      {
        _id: notification.requestId,
        recipient: userId,
        status: 'pending',
      },
      {
        $set: {
          status,
          respondedAt: new Date(),
        },
      },
      {
        new: true,
      }
    );

    if (!connection) {
      return res.status(409).json({
        message: 'Connection request is invalid or already processed.',
      });
    }

    // Update the original notification.
    notification.status = status;
    notification.isRead = true;
    await notification.save();

    // Get the responding user's display name.
    const responder = await User.findById(userId)
      .select('fullName name username')
      .lean();

    const responderName =
      responder?.fullName ||
      responder?.name ||
      responder?.username ||
      'A user';

    // Notify the original requester about the decision.
    const responseNotification = await Notification.create({
      userId: connection.requester,
      senderId: userId,
      type: 'Request',
      title:
        status === 'accepted'
          ? `${responderName} accepted your connection request`
          : `${responderName} declined your connection request`,
      description:
        status === 'accepted'
          ? 'You can now connect and start a conversation.'
          : 'Your connection request was declined.',
      isRead: false,
      status,
      requestId: connection._id,
    });
await responseNotification.populate(
  'senderId',
  'fullName username profileImage avatarStyle'
);
    // Send real-time events through the existing Socket.IO server.
    const io = req.app.get('io');

    if (io) {
      const requesterId = String(connection.requester);

      io.to(`user:${requesterId}`).emit('new_notification', {
        ...responseNotification.toObject(),
        timeAgo: 'Just now',
      });

      io.to(`user:${requesterId}`).emit('connection_updated', {
        otherUserId: userId,
        status,
      });

      io.to(`user:${userId}`).emit('connection_updated', {
        otherUserId: requesterId,
        status,
      });

      io.to(`user:${userId}`).emit('notification_updated', {
        notificationId: String(notification._id),
        status,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Connection request ${status} successfully.`,
      status,
      connection,
      notification,
    });
  } catch (error) {
    console.error('Update connection request error:', error);

    return res.status(500).json({
      message: 'Failed to process connection request.',
    });
  }
});

// --------------------------------------------------
// MARK ONE NOTIFICATION AS READ
// PATCH /api/notifications/:notificationId/read
// --------------------------------------------------
router.patch('/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = getUserId(req);

    if (!isValidId(notificationId)) {
      return res.status(400).json({
        message: 'Invalid notification ID.',
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        userId,
        hiddenFor: { $ne: userId },
      },
      {
        $set: { isRead: true },
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
      notification,
    });
  } catch (error) {
    console.error('Mark notification read error:', error);

    return res.status(500).json({
      message: 'Failed to mark notification as read.',
    });
  }
});

// --------------------------------------------------
// HIDE ONE NOTIFICATION
// PATCH /api/notifications/:notificationId/hide
// --------------------------------------------------
router.patch('/:notificationId/hide', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = getUserId(req);

    if (!isValidId(notificationId)) {
      return res.status(400).json({
        message: 'Invalid notification ID.',
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        userId,
        hiddenFor: { $ne: userId },
      },
      {
        $addToSet: { hiddenFor: userId },
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification hidden successfully.',
    });
  } catch (error) {
    console.error('Hide notification error:', error);

    return res.status(500).json({
      message: 'Failed to hide notification.',
    });
  }
});

module.exports = router;
