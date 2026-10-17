
const express = require('express');
const mongoose = require('mongoose');

const { verifyToken } = require('../middleware/authMiddleware');
const User = require('../models/User');
const Message = require('../models/Message');
const Connection = require('../models/Connection');

const router = express.Router();

// Require authentication for all routes.
router.use(verifyToken);

// ==========================================
// HELPERS
// ==========================================

const getUserId = (user) => {
  const id =
    user?.id ||
    user?._id ||
    user?.userId ||
    user?.sub ||
    null;

  return id ? String(id) : null;
};

const isValidId = (id) =>
  Boolean(id) && mongoose.isValidObjectId(id);

async function hasAcceptedConnection(userId, otherUserId) {
  return Boolean(
    await Connection.exists({
      status: 'accepted',
      $or: [
        {
          requester: userId,
          recipient: otherUserId,
        },
        {
          requester: otherUserId,
          recipient: userId,
        },
      ],
    })
  );
}

// ==========================================
// GET UNREAD MESSAGE COUNT
// GET /api/messages/unread-count
// ==========================================

router.get('/unread-count', async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);

    if (!isValidId(currentUserId)) {
      return res.status(401).json({
        message: 'Invalid authenticated user.',
      });
    }

    const count = await Message.countDocuments({
      recipient: currentUserId,
      isRead: { $ne: true },
      deletedFor: { $ne: currentUserId },
    });

    return res.status(200).json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error.message);

    return res.status(500).json({
      message: 'Failed to fetch unread message count.',
    });
  }
});

// ==========================================
// MARK CONVERSATION MESSAGES AS READ
// PATCH /api/messages/:userId1/:userId2/read
// ==========================================

router.patch('/:userId1/:userId2/read', async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);
    const { userId1, userId2 } = req.params;

    if (
      !isValidId(currentUserId) ||
      !isValidId(userId1) ||
      !isValidId(userId2)
    ) {
      return res.status(400).json({
        message: 'Invalid user ID.',
      });
    }

    if (
      currentUserId !== userId1 &&
      currentUserId !== userId2
    ) {
      return res.status(403).json({
        message: 'You cannot access this conversation.',
      });
    }

    const otherUserId =
      currentUserId === userId1 ? userId2 : userId1;

    if (currentUserId === otherUserId) {
      return res.status(400).json({
        message: 'Invalid conversation.',
      });
    }

    const otherUserExists = await User.exists({
      _id: otherUserId,
    });

    if (!otherUserExists) {
      return res.status(404).json({
        message: 'User not found.',
      });
    }

    const connected = await hasAcceptedConnection(
      currentUserId,
      otherUserId
    );

    if (!connected) {
      return res.status(403).json({
        message: 'You can only access accepted connections.',
      });
    }

    const result = await Message.updateMany(
      {
        sender: otherUserId,
        recipient: currentUserId,
        deletedFor: { $ne: currentUserId },
        isRead: { $ne: true },
      },
      {
        $set: { isRead: true },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Messages marked as read.',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Error marking messages as read:', error.message);

    return res.status(500).json({
      message: 'Failed to mark messages as read.',
    });
  }
});

// ==========================================
// GET CHAT HISTORY
// GET /api/messages/:userId1/:userId2
// ==========================================

router.get('/:userId1/:userId2', async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);
    const { userId1, userId2 } = req.params;

    if (
      !isValidId(currentUserId) ||
      !isValidId(userId1) ||
      !isValidId(userId2)
    ) {
      return res.status(400).json({
        message: 'Invalid user ID.',
      });
    }

    if (
      currentUserId !== userId1 &&
      currentUserId !== userId2
    ) {
      return res.status(403).json({
        message: 'You cannot access this conversation.',
      });
    }

    const otherUserId =
      currentUserId === userId1 ? userId2 : userId1;

    if (currentUserId === otherUserId) {
      return res.status(400).json({
        message: 'Invalid conversation.',
      });
    }

    const otherUserExists = await User.exists({
      _id: otherUserId,
    });

    if (!otherUserExists) {
      return res.status(404).json({
        message: 'User not found.',
      });
    }

    const connected = await hasAcceptedConnection(
      currentUserId,
      otherUserId
    );

    if (!connected) {
      return res.status(403).json({
        message: 'You can only message accepted connections.',
      });
    }

    // Mark incoming messages as read before returning chat history.
    await Message.updateMany(
      {
        sender: otherUserId,
        recipient: currentUserId,
        deletedFor: { $ne: currentUserId },
        isRead: { $ne: true },
      },
      {
        $set: { isRead: true },
      }
    );

    const messages = await Message.find({
      $and: [
        {
          $or: [
            {
              sender: currentUserId,
              recipient: otherUserId,
            },
            {
              sender: otherUserId,
              recipient: currentUserId,
            },
          ],
        },
        {
          deletedFor: { $ne: currentUserId },
        },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.status(200).json(messages);
  } catch (error) {
    console.error('Error fetching chat history:', error.message);

    return res.status(500).json({
      message: 'Failed to fetch messages.',
    });
  }
});

 // ==========================================
 // DELETE SINGLE MESSAGE (FOR ME ONLY)
 // DELETE /api/messages/single/:messageId
 // ==========================================

router.delete('/single/:messageId', async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);
    const { messageId } = req.params;

    if (!isValidId(currentUserId)) {
      return res.status(401).json({
        message: 'Invalid authenticated user.',
      });
    }

    if (!isValidId(messageId)) {
      return res.status(400).json({
        message: 'Invalid message ID.',
      });
    }

    const message = await Message.findOne({
      _id: messageId,
      $or: [
        { sender: currentUserId },
        { recipient: currentUserId },
      ],
    });

    if (!message) {
      return res.status(404).json({
        message: 'Message not found.',
      });
    }

    await Message.updateOne(
      { _id: messageId },
      {
        $addToSet: {
          deletedFor: currentUserId,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully.',
    });
  } catch (error) {
    console.error('Error deleting message:', error.message);

    return res.status(500).json({
      message: 'Failed to delete message.',
    });
  }
});
// ==========================================
// DELETE SINGLE MESSAGE FOR EVERYONE
// DELETE /api/messages/everyone/:messageId
// ==========================================

router.delete('/everyone/:messageId', async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);
    const { messageId } = req.params;

    if (!isValidId(currentUserId)) {
      return res.status(401).json({
        message: 'Invalid authenticated user.',
      });
    }

    if (!isValidId(messageId)) {
      return res.status(400).json({
        message: 'Invalid message ID.',
      });
    }

    const message = await Message.findOneAndDelete({
      _id: messageId,
      sender: currentUserId,
    });

    if (!message) {
      return res.status(404).json({
        message: 'Message not found or you are not the sender.',
      });
    }
const io = req.app.get('io');

io.to(`user:${String(message.sender)}`)
  .to(`user:${String(message.recipient)}`)
  .emit('message_deleted_for_everyone', {
    messageId: String(message._id),
  });
    return res.status(200).json({
      success: true,
      message: 'Message deleted for everyone.',
    });
  } catch (error) {
    console.error('Error deleting message for everyone:', error.message);

    return res.status(500).json({
      message: 'Failed to delete message for everyone.',
    });
  }
});

module.exports = router;
