const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

require('dotenv').config();

const authRoutes = require('./routes/auth');
const User = require('./models/User');
const Message = require('./models/Message');
const { verifyToken, checkRole } = require('./middleware/authMiddleware');

const app = express();
const server = http.createServer(app);

// ==========================================
// SOCKET.IO
// ==========================================

const allowedOrigins = [
  'https://skillmatch-g7.vercel.app',
  'http://localhost:5173',
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json());

app.use('/api/auth', authRoutes);

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

const isValidId = (id) => {
  return Boolean(id) && mongoose.isValidObjectId(id);
};

// ==========================================
// NOTIFICATION MODEL
// ==========================================

const NotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    type: {
      type: String,
      default: 'Message',
    },

    title: {
      type: String,
      required: true,
    },

    description: {
      type: String,
      default: '',
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      default: 'pending',
    },

    // Hide notifications for specific users only.
    // This does NOT permanently delete notifications.
    hiddenFor: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', NotificationSchema);

// ==========================================
// NOTIFICATION TIME HELPER
// ==========================================

function getNotificationTime(date) {
  if (!date) return 'Just now';

  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  );

  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ==========================================
// HIDDEN CONVERSATION MODEL
// Delete for me only
// ==========================================

const HiddenConversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    otherUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

HiddenConversationSchema.index(
  {
    user: 1,
    otherUser: 1,
  },
  {
    unique: true,
  }
);

const HiddenConversation =
  mongoose.models.HiddenConversation ||
  mongoose.model('HiddenConversation', HiddenConversationSchema);

// ==========================================
// USER PROFILE
// ==========================================

app.get('/api/user/profile', verifyToken, (req, res) => {
  res.status(200).json({
    message: 'Access granted to user profile.',
    user: req.user,
  });
});

// ==========================================
// ADMIN DASHBOARD
// ==========================================

app.get(
  '/api/admin/dashboard',
  verifyToken,
  checkRole(['admin']),
  (req, res) => {
    res.status(200).json({
      message: 'Access granted to Admin Dashboard.',
    });
  }
);

// ==========================================
// GET USERS FOR CHATS LIST
// Excludes the logged-in user and users whose
// conversations are hidden by the logged-in user.
// ==========================================

app.get('/api/users', verifyToken, async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);

    if (!isValidId(currentUserId)) {
      return res.status(401).json({
        message: 'Invalid user identity in authentication token.',
      });
    }

    const hiddenConversations = await HiddenConversation.find({
      user: currentUserId,
    })
      .select('otherUser')
      .lean();

    const hiddenUserIds = hiddenConversations.map((item) =>
      String(item.otherUser)
    );

    const users = await User.find({
      _id: {
        $ne: currentUserId,
        $nin: hiddenUserIds,
      },
    })
      .select('fullName email role')
      .sort({ fullName: 1 })
      .lean();

    return res.status(200).json(
      users.map((user) => ({
        ...user,
        id: String(user._id),
        name: user.fullName,
      }))
    );
  } catch (error) {
    console.error('Error fetching users:', error.message);

    return res.status(500).json({
      message: 'Failed to fetch users.',
    });
  }
});

// ==========================================
// SEARCH USERS
// Includes registered users even if their
// conversations were previously hidden/deleted.
// ==========================================

app.get('/api/users/search', verifyToken, async (req, res) => {
  try {
    const currentUserId = getUserId(req.user);

    if (!isValidId(currentUserId)) {
      return res.status(401).json({
        message: 'Invalid user identity in authentication token.',
      });
    }

    const searchQuery =
      typeof req.query.q === 'string'
        ? req.query.q.trim()
        : '';

    const filter = {
      _id: {
        $ne: currentUserId,
      },
    };

    if (searchQuery) {
      const escapedQuery = searchQuery.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

      const searchRegex = new RegExp(escapedQuery, 'i');

      filter.$or = [
        { fullName: searchRegex },
        { name: searchRegex },
        { username: searchRegex },
        { email: searchRegex },
      ];
    }

    const users = await User.find(filter)
      .select('fullName name username email role')
      .sort({ fullName: 1 })
      .limit(50)
      .lean();

    return res.status(200).json(
      users.map((user) => ({
        ...user,
        id: String(user._id),
        name:
          user.fullName ||
          user.name ||
          user.username ||
          user.email,
      }))
    );
  } catch (error) {
    console.error('Error searching users:', error.message);

    return res.status(500).json({
      message: 'Failed to search users.',
    });
  }
});

// ==========================================
// GET NOTIFICATIONS
// Excludes notifications hidden by this user.
// ==========================================

app.get(
  '/api/notifications/:userId',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { userId } = req.params;

      if (!isValidId(currentUserId) || !isValidId(userId)) {
        return res.status(400).json({
          message: 'Invalid user ID.',
        });
      }

      if (currentUserId !== userId) {
        return res.status(403).json({
          message: 'You cannot access these notifications.',
        });
      }

      const notifications = await Notification.find({
        userId: currentUserId,
        hiddenFor: { $ne: currentUserId },
      })
        .sort({ createdAt: -1 })
        .lean();

      const formattedNotifications = notifications.map((notif) => ({
        ...notif,
        timeAgo: getNotificationTime(notif.createdAt),
      }));

      return res.status(200).json(formattedNotifications);
    } catch (error) {
      console.error('Error fetching notifications:', error.message);

      return res.status(500).json({
        message: 'Failed to fetch notifications.',
      });
    }
  }
);

// ==========================================
// HIDE ONE NOTIFICATION FOR ME
// Does not permanently delete the notification.
// ==========================================

app.patch(
  '/api/notifications/:id/hide',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { id } = req.params;

      if (!isValidId(currentUserId)) {
        return res.status(401).json({
          message: 'Invalid user identity.',
        });
      }

      if (!isValidId(id)) {
        return res.status(400).json({
          message: 'Invalid notification ID.',
        });
      }

      const notification = await Notification.findOneAndUpdate(
        {
          _id: id,
          userId: currentUserId,
        },
        {
          $addToSet: {
            hiddenFor: currentUserId,
          },
        },
        {
          new: true,
        }
      );

      if (!notification) {
        return res.status(404).json({
          message: 'Notification not found.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification hidden for you.',
      });
    } catch (error) {
      console.error('Error hiding notification:', error.message);

      return res.status(500).json({
        message: 'Failed to hide notification.',
      });
    }
  }
);

// ==========================================
// HIDE ALL NOTIFICATIONS FOR ME
// Does not permanently delete notifications.
// ==========================================

app.patch(
  '/api/notifications/hide-all',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);

      if (!isValidId(currentUserId)) {
        return res.status(401).json({
          message: 'Invalid user identity.',
        });
      }

      await Notification.updateMany(
        {
          userId: currentUserId,
          hiddenFor: { $ne: currentUserId },
        },
        {
          $addToSet: {
            hiddenFor: currentUserId,
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: 'All notifications hidden for you.',
      });
    } catch (error) {
      console.error('Error hiding all notifications:', error.message);

      return res.status(500).json({
        message: 'Failed to hide notifications.',
      });
    }
  }
);

// ==========================================
// MARK ALL NOTIFICATIONS AS READ
// ==========================================

app.put(
  '/api/notifications/mark-all-read/:userId',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { userId } = req.params;

      if (
        !isValidId(currentUserId) ||
        !isValidId(userId) ||
        currentUserId !== userId
      ) {
        return res.status(403).json({
          message: 'You cannot update these notifications.',
        });
      }

      await Notification.updateMany(
        {
          userId: currentUserId,
          hiddenFor: { $ne: currentUserId },
        },
        {
          $set: {
            isRead: true,
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: 'All notifications marked as read.',
      });
    } catch (error) {
      console.error('Error marking notifications:', error.message);

      return res.status(500).json({
        message: 'Failed to update notifications.',
      });
    }
  }
);

// ==========================================
// UPDATE NOTIFICATION STATUS
// ==========================================

app.put(
  '/api/notifications/action/:id',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { id } = req.params;
      const { status } = req.body;

      if (!isValidId(currentUserId)) {
        return res.status(401).json({
          message: 'Invalid user identity.',
        });
      }

      if (!isValidId(id)) {
        return res.status(400).json({
          message: 'Invalid notification ID.',
        });
      }

      if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({
          message: 'Invalid notification status.',
        });
      }

      const notification = await Notification.findOneAndUpdate(
        {
          _id: id,
          userId: currentUserId,
        },
        {
          $set: {
            status,
            isRead: true,
          },
        },
        {
          new: true,
        }
      );

      if (!notification) {
        return res.status(404).json({
          message: 'Notification not found.',
        });
      }

      return res.status(200).json({
        success: true,
        notification,
      });
    } catch (error) {
      console.error('Error updating notification:', error.message);

      return res.status(500).json({
        message: 'Failed to update notifications.',
      });
    }
  }
);

// ==========================================
// DELETE CONVERSATION FOR ME
//
// - Hides the conversation from this account.
// - Marks existing messages as deleted for this account.
// - Does not delete messages for the other participant.
// ==========================================

app.delete(
  '/api/conversations/:otherUserId',
  verifyToken,
  async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);
      const { otherUserId } = req.params;

      if (
        !isValidId(currentUserId) ||
        !isValidId(otherUserId)
      ) {
        return res.status(400).json({
          message: 'Invalid user ID.',
        });
      }

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

      // Mark existing messages as deleted for this account only.
      await Message.updateMany(
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
          $addToSet: {
            deletedFor: currentUserId,
          },
        }
      );

      // Hide this conversation from this account's Chats list.
      await HiddenConversation.findOneAndUpdate(
        {
          user: currentUserId,
          otherUser: otherUserId,
        },
        {
          $setOnInsert: {
            user: currentUserId,
            otherUser: otherUserId,
          },
        },
        {
          upsert: true,
          new: true,
        }
      );

      return res.status(200).json({
        success: true,
        message: 'Conversation deleted for you.',
      });
    } catch (error) {
      console.error('Error deleting conversation:', error.message);

      return res.status(500).json({
        message: 'Failed to delete conversation.',
      });
    }
  }
);

// ==========================================
// GET CHAT HISTORY
//
// Only the authenticated user's messages are returned.
// Messages deleted for this account stay hidden.
// ==========================================

app.get(
  '/api/messages/:userId1/:userId2',
  verifyToken,
  async (req, res) => {
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

      // The logged-in user must be one of the participants.
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
            deletedFor: {
              $ne: currentUserId,
            },
          },
        ],
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.status(200).json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error.message);

      return res.status(500).json({
        message: 'Failed to fetch messages.',
      });
    }
  }
);

// ==========================================
// SOCKET.IO AUTHENTICATION
// ==========================================

const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('Authentication required.'));
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secretkey123'
    );

    const userId = getUserId(decoded);

    if (!isValidId(userId)) {
      return next(new Error('Invalid user identity.'));
    }

    socket.data.userId = userId;

    return next();
  } catch (error) {
    return next(new Error('Invalid or expired token.'));
  }
});

// ==========================================
// REAL-TIME MESSAGING
// ==========================================

io.on('connection', (socket) => {
  const userId = socket.data.userId;

  console.log(`User connected: ${userId}`);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  socket.join(`user:${userId}`);

  io.emit('get_online_users', Array.from(onlineUsers.keys()));

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  socket.on('send_message', async (payload, callback) => {
    try {
      const recipientId = String(payload?.recipientId || '');

      const text =
        typeof payload?.text === 'string'
          ? payload.text.trim()
          : '';

      if (!isValidId(recipientId)) {
        return callback?.({
          success: false,
          message: 'Invalid recipient.',
        });
      }

      if (recipientId === userId) {
        return callback?.({
          success: false,
          message: 'You cannot message yourself.',
        });
      }

      if (!text || text.length > 2000) {
        return callback?.({
          success: false,
          message: 'Message must be between 1 and 2000 characters.',
        });
      }

      const recipientExists = await User.exists({
        _id: recipientId,
      });

      if (!recipientExists) {
        return callback?.({
          success: false,
          message: 'Recipient not found.',
        });
      }

      // Save the new message.
      const newMessage = await Message.create({
        sender: userId,
        recipient: recipientId,
        text,
      });

      const messageData = newMessage.toObject();

      // ==========================================
      // RESTORE CONVERSATION VISIBILITY
      //
      // A new message makes the conversation visible
      // again to both participants.
      //
      // Previously deleted messages remain hidden
      // for accounts that deleted them.
      // ==========================================

      await HiddenConversation.deleteMany({
        $or: [
          {
            user: userId,
            otherUser: recipientId,
          },
          {
            user: recipientId,
            otherUser: userId,
          },
        ],
      });

      // Notify both accounts to refresh their Chats list.
      io.to(`user:${userId}`).emit('conversation_restored', {
        otherUserId: recipientId,
      });

      io.to(`user:${recipientId}`).emit('conversation_restored', {
        otherUserId: userId,
      });

      // ==========================================
      // CREATE NOTIFICATION FOR RECIPIENT
      // ==========================================

      try {
        const sender = await User.findById(userId)
          .select('fullName name username')
          .lean();

        const senderName =
          sender?.fullName ||
          sender?.name ||
          sender?.username ||
          'Someone';

        const notification = await Notification.create({
          userId: recipientId,
          senderId: userId,
          type: 'Message',
          title: `New message from ${senderName}`,
          description:
            text.length > 100
              ? `${text.substring(0, 100)}...`
              : text,
          isRead: false,
          status: 'pending',
        });

        const notificationData = {
          ...notification.toObject(),
          timeAgo: 'Just now',
        };

        io.to(`user:${recipientId}`).emit(
          'new_notification',
          notificationData
        );
      } catch (notificationError) {
        console.error(
          'Error creating notification:',
          notificationError.message
        );
      }

      // Send the message to all recipient connections.
      io.to(`user:${recipientId}`).emit(
        'receive_message',
        messageData
      );

      // Confirm the saved message to the sender.
      return callback?.({
        success: true,
        message: messageData,
      });
    } catch (error) {
      console.error('Error sending message:', error.message);

      return callback?.({
        success: false,
        message: 'Failed to send message.',
      });
    }
  });

  // ==========================================
  // DISCONNECT
  // ==========================================

  socket.on('disconnect', () => {
    const userSockets = onlineUsers.get(userId);

    if (userSockets) {
      userSockets.delete(socket.id);

      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
      }
    }

    io.emit('get_online_users', Array.from(onlineUsers.keys()));

    console.log(`User disconnected: ${userId}`);
  });
});

// ==========================================
// MONGODB CONNECTION
// ==========================================

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000;

if (!MONGO_URI) {
  console.error('MONGO_URI is missing from your .env file.');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB (SkillLink DB)');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database connection error:', error.message);
    process.exit(1);
  });