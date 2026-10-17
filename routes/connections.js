const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { verifyToken } = require('../middleware/authMiddleware');
const User = require('../models/User');
const Connection = require('../models/Connection');
const Notification = require('../models/Notification');

router.use(verifyToken);

const getUserId = (user) =>
  String(user?.id || user?._id || user?.userId || user?.sub || '');

const isValidId = (id) => mongoose.isValidObjectId(id);

const getDisplayName = (user) =>
  user?.fullName || user?.name || user?.username || 'SkillLink user';

const emitToUser = (req, userId, event, payload) => {
  req.app.get('io')?.to(`user:${String(userId)}`).emit(event, payload);
};

// ==========================================
// SEND CONNECTION REQUEST
// POST /api/connections
// ==========================================

router.post('/', async (req, res) => {
  try {
    const requesterId = getUserId(req.user);
    const { recipientId, note = '' } = req.body || {};

    if (!isValidId(requesterId) || !isValidId(recipientId)) {
      return res.status(400).json({ message: 'Invalid user ID.' });
    }

    if (requesterId === String(recipientId)) {
      return res.status(400).json({
        message: 'You cannot connect with yourself.',
      });
    }

    if (typeof note !== 'string' || note.length > 500) {
      return res.status(400).json({
        message: 'The note must be 500 characters or fewer.',
      });
    }

    const targetId = String(recipientId);
    const cleanNote = note.trim();

    const [recipient, sender] = await Promise.all([
      User.findById(targetId)
        .select('fullName name username')
        .lean(),
      User.findById(requesterId)
        .select('fullName name username')
        .lean(),
    ]);

    if (!recipient) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (!sender) {
      return res.status(401).json({
        message: 'Your user account could not be found. Please log in again.',
      });
    }

    const senderName = getDisplayName(sender);

    const existing = await Connection.findOne({
      $or: [
        { requester: requesterId, recipient: targetId },
        { requester: targetId, recipient: requesterId },
      ],
    });

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(200).json({
          success: true,
          status: 'accepted',
          connection: existing,
        });
      }

      if (existing.status === 'pending') {
        return res.status(409).json({
          message: 'A connection request already exists.',
          status: 'pending',
        });
      }

      // Only the original requester can resend after a decline.
      if (String(existing.requester) !== requesterId) {
        return res.status(409).json({
          message:
            'Only the original requester can resend this request.',
          status: 'declined',
        });
      }

      // Atomically reset the declined connection to pending.
      const connection = await Connection.findOneAndUpdate(
        {
          _id: existing._id,
          requester: requesterId,
          recipient: targetId,
          status: 'declined',
        },
        {
          $set: {
            status: 'pending',
            note: cleanNote,
            respondedAt: null,
          },
        },
        { new: true, runValidators: true }
      );

      if (!connection) {
        return res.status(409).json({
          message: 'This request has changed. Please refresh and try again.',
        });
      }

      let notification = await Notification.findOneAndUpdate(
        {
          requestId: connection._id,
          userId: targetId,
          type: 'Request',
        },
        {
          $set: {
            senderId: requesterId,
            status: 'pending',
            isRead: false,
            title: `${senderName} sent you a connection request`,
            description: cleanNote,
            hiddenFor: [],
          },
        },
        {
          new: true,
          sort: { createdAt: -1 },
          runValidators: true,
        }
      );

      if (!notification) {
        notification = await Notification.create({
          userId: targetId,
          senderId: requesterId,
          type: 'Request',
          title: `${senderName} sent you a connection request`,
          description: cleanNote,
          isRead: false,
          status: 'pending',
          requestId: connection._id,
          hiddenFor: [],
        });
      }

      emitToUser(req, targetId, 'new_notification', {
        ...notification.toObject(),
        timeAgo: 'Just now',
      });

      emitToUser(req, targetId, 'connection_request_updated', {
        connectionId: String(connection._id),
        requesterId,
        status: 'pending',
      });

      return res.status(200).json({
        success: true,
        status: 'pending',
        connection,
      });
    }

    // Create the connection record first.
    const connection = await Connection.create({
      requester: requesterId,
      recipient: targetId,
      note: cleanNote,
      status: 'pending',
    });

    try {
      const notification = await Notification.create({
        userId: targetId,
        senderId: requesterId,
        type: 'Request',
        title: `${senderName} sent you a connection request`,
        description: cleanNote,
        isRead: false,
        status: 'pending',
        requestId: connection._id,
      });

      emitToUser(req, targetId, 'new_notification', {
        ...notification.toObject(),
        timeAgo: 'Just now',
      });
    } catch (notificationError) {
      // Roll back the new connection if notification creation fails.
      await Connection.deleteOne({ _id: connection._id }).catch(() => {});
      throw notificationError;
    }

    return res.status(201).json({
      success: true,
      status: 'pending',
      connection,
    });
  } catch (error) {
    // Handle concurrent duplicate inserts from the unique index.
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'A connection request already exists. Please refresh.',
      });
    }

    console.error('Connection request error:', error);

    return res.status(500).json({
      message: 'Failed to send connection request.',
    });
  }
});

// ==========================================
// GET CONNECTIONS FOR LOGGED-IN USER
// GET /api/connections
// ==========================================

router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req.user);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user identity.',
      });
    }

    const connections = await Connection.find({
      $or: [
        { requester: userId },
        { recipient: userId },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ connections });
  } catch (error) {
    console.error('Fetch connections error:', error);

    return res.status(500).json({
      message: 'Failed to fetch connections.',
    });
  }
});

// ==========================================
// GET STATUS WITH ONE USER
// GET /api/connections/status/:otherUserId
// ==========================================

router.get('/status/:otherUserId', async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { otherUserId } = req.params;

    if (!isValidId(userId) || !isValidId(otherUserId)) {
      return res.status(400).json({
        message: 'Invalid user ID.',
      });
    }

    if (userId === String(otherUserId)) {
      return res.status(400).json({
        message: 'You cannot check a connection with yourself.',
      });
    }

    const connection = await Connection.findOne({
      $or: [
        { requester: userId, recipient: otherUserId },
        { requester: otherUserId, recipient: userId },
      ],
    }).lean();

    if (!connection) {
      return res.json({
        status: 'none',
        relation: null,
        connectionId: null,
      });
    }

    return res.json({
      status: connection.status,
      relation:
        String(connection.requester) === userId
          ? 'sent'
          : 'received',
      connectionId: String(connection._id),
    });
  } catch (error) {
    console.error('Connection status error:', error);

    return res.status(500).json({
      message: 'Failed to fetch connection status.',
    });
  }
});

// ==========================================
// CANCEL SENT CONNECTION REQUEST
// DELETE /api/connections/:connectionId/cancel
// ==========================================

router.delete('/:connectionId/cancel', async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { connectionId } = req.params;

    if (!isValidId(userId) || !isValidId(connectionId)) {
      return res.status(400).json({
        message: 'Invalid user or connection ID.',
      });
    }

    // Only the original requester can cancel a pending request.
    const connection = await Connection.findOneAndDelete({
      _id: connectionId,
      requester: userId,
      status: 'pending',
    });

    if (!connection) {
      return res.status(404).json({
        message:
          'Pending sent connection request not found. It may already have been answered or cancelled.',
      });
    }

    const recipientId = String(connection.recipient);

    // Remove the notification associated with this request.
    await Notification.deleteMany({
      requestId: connection._id,
      userId: recipientId,
      type: 'Request',
      status: 'pending',
    });

    emitToUser(req, recipientId, 'connection_request_cancelled', {
      connectionId: String(connection._id),
      requesterId: userId,
    });

    return res.status(200).json({
      success: true,
      message: 'Connection request cancelled successfully.',
      connectionId: String(connection._id),
    });
  } catch (error) {
    console.error('Cancel connection request error:', error);

    return res.status(500).json({
      message: 'Failed to cancel connection request.',
    });
  }
});

// ==========================================
// ACCEPT OR DECLINE CONNECTION REQUEST
// PATCH /api/connections/:connectionId/respond
// ==========================================

router.patch('/:connectionId/respond', async (req, res) => {
  try {
    const userId = getUserId(req.user);
    const { connectionId } = req.params;
    const { status } = req.body || {};

    if (!isValidId(userId) || !isValidId(connectionId)) {
      return res.status(400).json({
        message: 'Invalid user or connection ID.',
      });
    }

    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be accepted or declined.',
      });
    }

    // Atomic conditional update: only one response can win.
    const connection = await Connection.findOneAndUpdate(
      {
        _id: connectionId,
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
        runValidators: true,
      }
    );

    if (!connection) {
      return res.status(404).json({
        message:
          'Pending connection request not found. It may already have been answered.',
      });
    }

    // Update the request notification shown to the recipient.
    await Notification.updateMany(
      {
        requestId: connection._id,
        userId,
        type: 'Request',
      },
      {
        $set: {
          status,
          isRead: true,
        },
      }
    );

    const responder = await User.findById(userId)
      .select('fullName name username')
      .lean();

    const responderName = getDisplayName(responder);
    const requesterId = String(connection.requester);

    const responseNotification = await Notification.create({
      userId: requesterId,
      senderId: userId,
      type: 'Connection',
      title:
        status === 'accepted'
          ? `${responderName} accepted your connection request`
          : `${responderName} declined your connection request`,
      description:
        status === 'accepted'
          ? 'You are now connected.'
          : 'Your connection request was declined.',
      isRead: false,
      status,
      requestId: connection._id,
    });

    emitToUser(req, requesterId, 'new_notification', {
      ...responseNotification.toObject(),
      timeAgo: 'Just now',
    });

    emitToUser(req, requesterId, 'connection_status_updated', {
      connectionId: String(connection._id),
      otherUserId: userId,
      status,
    });

    emitToUser(req, userId, 'connection_status_updated', {
      connectionId: String(connection._id),
      otherUserId: requesterId,
      status,
    });

    return res.status(200).json({
      success: true,
      status,
      connection,
    });
  } catch (error) {
    console.error('Respond to connection error:', error);

    return res.status(500).json({
      message: 'Failed to respond to connection request.',
    });
  }
});

module.exports = router;