
  const express = require('express');
  const http = require('http');
  const mongoose = require('mongoose');
  const cors = require('cors');
  const helmet = require('helmet');
  const jwt = require('jsonwebtoken');
  const { Server } = require('socket.io');

  require('dotenv').config();

  const authRoutes = require('./routes/auth');
  const projectsRoutes = require('./routes/Project');
  const notificationRoutes = require('./routes/Notification');
  const User = require('./models/User');
  const Message = require('./models/Message');
  const Project = require('./models/project');
  const Notification = require('./models/Notification');
  const Report = require('./models/Report');
  const SupportTicket = require('./models/SupportTicket');
  const Connection = require('./models/Connection');
  const connectionRoutes = require('./routes/connections');
  const messagesRoutes = require('./routes/messages');
  const adminHobbiesRoutes = require('./routes/AdminHobbies');
  const adminProjectsRoutes = require('./routes/AdminProjects');
  const adminCollaborationsRoutes = require('./routes/AdminCollaborations');
  const adminConnectionsRoutes = require('./routes/AdminConnections');
  const reportsRoutes = require('./routes/reports');
  const supportRoutes = require('./routes/supportRoutes');
  const { verifyToken, checkRole } = require('./middleware/authMiddleware');

  const app = express();
  app.set('trust proxy', 1);

  const server = http.createServer(app);

  // ==========================================
  // SOCKET.IO
  // ==========================================

  const allowedOrigins = [
    'https://skillmatch-g7.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // ==========================================
  // MIDDLEWARE
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
  app.set('io', io);

  // ==========================================
  // ROUTES
  // ==========================================

  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/connections', connectionRoutes);
  app.use('/api/admin/hobbies', adminHobbiesRoutes);
  app.use('/api/admin/projects', adminProjectsRoutes);
  app.use('/api/admin/collaborations', adminCollaborationsRoutes);
  app.use('/api/admin/connections', adminConnectionsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/support', supportRoutes);

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

  function getNotificationTime(date) {
    if (!date) return 'Just now';

    const timestamp = new Date(date).getTime();

    if (Number.isNaN(timestamp)) return 'Just now';

    const seconds = Math.max(
      0,
      Math.floor((Date.now() - timestamp) / 1000)
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

  /* ==========================================
    DASHBOARD STATISTICS
    GET /api/dashboard/stats
  ========================================== */

  app.get('/api/dashboard/stats', verifyToken, async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);

      if (!isValidId(currentUserId)) {
        return res.status(401).json({
          message: 'Invalid authenticated user.',
        });
      }

      const [
        projects,
        collaborations,
        messages,
        pendingConnections,
        pendingJoinRequests,
      ] = await Promise.all([
        // Projects owned by the logged-in user
        Project.countDocuments({
          owner: currentUserId,
        }),

        // Accepted connections
        Connection.countDocuments({
          status: 'accepted',
          $or: [
            { requester: currentUserId },
            { recipient: currentUserId },
          ],
        }),

        // Unread messages
        Message.countDocuments({
          recipient: currentUserId,
          isRead: { $ne: true },
          deletedFor: { $ne: currentUserId },
        }),

        // Pending connection requests
        Connection.countDocuments({
          recipient: currentUserId,
          status: 'pending',
        }),

        // Pending project join requests
        Project.aggregate([
          {
            $match: {
              owner: new mongoose.Types.ObjectId(currentUserId),
            },
          },
          {
            $unwind: '$joinRequests',
          },
          {
            $match: {
              'joinRequests.status': 'Pending',
            },
          },
          {
            $count: 'count',
          },
        ]),
      ]);

      const pendingProjectRequests =
        pendingJoinRequests[0]?.count || 0;

      return res.status(200).json({
        projects,
        collaborations,
        messages,
        requests: pendingConnections + pendingProjectRequests,
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error.message);

      return res.status(500).json({
        message: 'Failed to fetch dashboard statistics.',
      });
    }
  });


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
    { timestamps: true }
  );

  HiddenConversationSchema.index(
    { user: 1, otherUser: 1 },
    { unique: true }
  );

  const HiddenConversation =
    mongoose.models.HiddenConversation ||
    mongoose.model('HiddenConversation', HiddenConversationSchema);

  // ==========================================
  // USER PROFILE
  // ==========================================

  app.get('/api/user/profile', verifyToken, (req, res) => {
    return res.status(200).json({
      message: 'Access granted to user profile.',
      user: req.user,
    });
  });

  // ==========================================
  // ADMIN DASHBOARD
  // ==========================================



  // ==========================================
  // ADMIN DASHBOARD
  // ==========================================

  app.get(
    '/api/admin/dashboard',
    verifyToken,
    checkRole(['admin']),
    async (req, res) => {
      try {
        const now = new Date();

        const startOfMonth = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        );

        const startOfLastMonth = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          1
        );

        const studentFilter = { role: 'student' };
        // ==========================================
  // ADMIN DASHBOARD - ACCOUNT STATUS COUNTS
  // ==========================================

  const [activeUsers, suspendedUsers, blockedUsers] = await Promise.all([
    User.countDocuments({
      ...studentFilter,
      accountStatus: { $in: ['active', null] }
    }),

    User.countDocuments({
      ...studentFilter,
      accountStatus: 'suspended'
    }),

    User.countDocuments({
      ...studentFilter,
      accountStatus: 'blocked'
    })
  ]);

        const [
          totalUsers,
          newUsersThisMonth,
          newUsersLastMonth,
          registrations
        ] = await Promise.all([
          User.countDocuments(studentFilter),

          User.countDocuments({
            ...studentFilter,
            createdAt: { $gte: startOfMonth }
          }),

          User.countDocuments({
            ...studentFilter,
            createdAt: {
              $gte: startOfLastMonth,
              $lt: startOfMonth
            }
          }),

          User.find({
            ...studentFilter,
            createdAt: { $type: 'date' }
          })
            .select('createdAt')
            .lean()
        ]);

        const growthRate =
          newUsersLastMonth === 0
            ? null
            : Number(
                (
                  ((newUsersThisMonth - newUsersLastMonth) /
                    newUsersLastMonth) *
                  100
                ).toFixed(1)
              );

        const userGrowth = registrations.map((user) => ({
          date: user.createdAt
        }));
        // ==========================================
  // ADMIN DASHBOARD - TOP 5 HOBBIES
  // REAL MONGODB STUDENT DATA
  // ==========================================

  const topHobbies = await User.aggregate([
    {
      $match: {
        role: 'student'
      }
    },
    {
      $unwind: '$hobbies'
    },
    {
      $match: {
        hobbies: {
          $type: 'string',
          $ne: ''
        }
      }
    },
    {
      $group: {
        _id: {
          $toLower: {
            $trim: {
              input: '$hobbies'
            }
          }
        },
        students: {
          $addToSet: '$_id'
        }
      }
    },
    {
      $project: {
        _id: 0,
        hobby: '$_id',
        count: {
          $size: '$students'
        }
      }
    },
    {
      $sort: {
        count: -1,
        hobby: 1
      }
    },
    {
      $limit: 5
    }
  ]);
  // ==========================================
  // ADMIN DASHBOARD - COLLABORATION STATISTICS
  // REAL MONGODB PROJECT DATA
  // ==========================================

  const collaborationFilter = {
    'members.0': { $exists: true }
  };

  const [
    totalCollaborations,
    activeCollaborations,
    completedCollaborations,
    archivedCollaborations
  ] = await Promise.all([
    Project.countDocuments(collaborationFilter),

    Project.countDocuments({
      ...collaborationFilter,
      status: 'Active'
    }),

    Project.countDocuments({
      ...collaborationFilter,
      status: 'Completed'
    }),

    Project.countDocuments({
      ...collaborationFilter,
      status: 'Archived'
    })
  ]);
        return res.status(200).json({
        message: 'Admin dashboard data retrieved successfully.',
        totalUsers,
        activeUsers,
        suspendedUsers,
        blockedUsers,
        newUsersThisMonth,
        newUsersLastMonth,
        growthRate,
        userGrowth,
        topHobbies,
        totalCollaborations,
        activeCollaborations,
        completedCollaborations,
        archivedCollaborations
      });
      } catch (error) {
        console.error('Admin dashboard error:', error.message);

        return res.status(500).json({
          message: 'Failed to retrieve dashboard data.'
        });
      }
    }
  );



  /* ==========================================
    ADMIN NOTIFICATIONS
    GET /api/admin/notifications
  ========================================== */

  app.get(
    '/api/admin/notifications',
    verifyToken,
    checkRole(['admin']),
    async (req, res) => {
      try {

  const [
    recentUsers,
    recentProjects,
    recentReports,
    recentSupportTickets,
    adminEvents
  ] = await Promise.all([

            User.find({
              role: 'student',
              createdAt: { $type: 'date' }
            })

  .select('username profileImage avatarStyle createdAt')

              .sort({ createdAt: -1 })
              .limit(30)
              .lean(),

            Project.find({
              createdAt: { $type: 'date' }
            })

  .select('title owner createdAt')
  .populate('owner', 'username profileImage avatarStyle')

              .sort({ createdAt: -1 })
              .limit(30)
              .lean(),

            Report.find()

  .select('reporter reportType subject createdAt')
  .populate('reporter', 'username profileImage avatarStyle')

              .sort({ createdAt: -1 })
              .limit(30)
              .lean(),


            SupportTicket.find()

  .select('user subject category createdAt')
  .populate('user', 'username profileImage avatarStyle')

              .sort({ createdAt: -1 })
              .limit(30)
              .lean(),


  Notification.find({
    audience: 'admin'
  })
    .populate(
      'targetUserId',
      'username profileImage avatarStyle'
    )
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()

          ]);


  const registrations = recentUsers.map((user) => ({
    id: `registration-${user._id}`,
    userId: String(user._id),
    type: 'registration',
    title: 'New Student Registration',
    description: `${user.username || 'A student'} registered on SkillLink.`,
    username: user.username || 'Student',
    profileImage: user.profileImage || '',
    avatarStyle: user.avatarStyle || 'avataaars',
    createdAt: user.createdAt,
    isRead: false
  }));



  const projects = recentProjects.map((project) => ({
    id: `project-${project._id}`,
    userId: project.owner?._id ? String(project.owner._id) : null,
    type: 'project',
    title: 'New Project Created',
    description: `${project.title || 'A project'} was created.`,
    username: project.owner?.username || '',
    profileImage: project.owner?.profileImage || '',
    avatarStyle: project.owner?.avatarStyle || 'avataaars',
    createdAt: project.createdAt,
    isRead: false
  }));



  const reports = recentReports.map((report) => ({
    id: `report-${report._id}`,
    userId: report.reporter?._id ? String(report.reporter._id) : null,
    type: 'report',
    title: 'New Report Submitted',
    description: `${report.reportType || 'Report'}: ${
      report.subject || 'No subject'
    }`,
    username: report.reporter?.username || '',
    profileImage: report.reporter?.profileImage || '',
    avatarStyle: report.reporter?.avatarStyle || 'avataaars',
    createdAt: report.createdAt,
    isRead: false
  }));



  const supportTickets = recentSupportTickets.map((ticket) => ({
    id: `support-${ticket._id}`,
    userId: ticket.user?._id ? String(ticket.user._id) : null,
    type: 'support',
    title: 'New Support Inquiry',
    description: `${ticket.category || 'General'}: ${
      ticket.subject || 'No subject'
    }`,
    username: ticket.user?.username || '',
    profileImage: ticket.user?.profileImage || '',
    avatarStyle: ticket.user?.avatarStyle || 'avataaars',
    createdAt: ticket.createdAt,
    isRead: false
  }));



  const recordedEvents = adminEvents.map((event) => ({
    id: String(event._id),
    userId: event.targetUserId?._id
    ? String(event.targetUserId._id)
    : null,
    type: event.adminEventType,
    title: event.title,
    description: event.description,
    reason: event.reason || '',
    username: event.targetUserId?.username || '',
    profileImage: event.targetUserId?.profileImage || '',
    avatarStyle: event.targetUserId?.avatarStyle || 'avataaars',
    createdAt: event.createdAt,
    isRead: event.isRead
  }));




  const activities = [
    ...registrations,
    ...projects,
    ...reports,
    ...supportTickets,
    ...recordedEvents
  ]


          .sort(
            (a, b) =>
              new Date(b.createdAt) - new Date(a.createdAt)
          )
          .slice(0, 50);

        return res.status(200).json({
          success: true,
          activities
        });
      } catch (error) {
        console.error('Admin notifications error:', error.message);

        return res.status(500).json({
          message: 'Failed to retrieve admin notifications.'
        });
      }
    }
  );

  /* ==========================================
    ADMIN USERS MANAGEMENT
    GET /api/admin/users
  ========================================== */

  app.get(
    '/api/admin/users',
    verifyToken,
    checkRole(['admin']),
    async (req, res) => {
      try {
        const users = await User.find({ role: 'student' })
          .select(
            'username email role accountStatus accountRestrictionReason profileImage avatarStyle hobbies createdAt'
          )
          .sort({ createdAt: -1 })
          .lean();

        return res.status(200).json({
          message: 'Registered students retrieved successfully.',
          totalUsers: users.length,
          users
        });
      } catch (error) {
        console.error('Admin users error:', error.message);

        return res.status(500).json({
          message: 'Failed to retrieve registered students.'
        });
      }
    }
  );


  /* ==========================================
    ADMIN - UPDATE STUDENT ACCOUNT STATUS
    PATCH /api/admin/users/:userId/status
  ========================================== */

  app.patch(
    '/api/admin/users/:userId/status',
    verifyToken,
    checkRole(['admin']),
    async (req, res) => {
      try {
        const { userId } = req.params;
        const { status, reason } = req.body;

        // Validate MongoDB ID
        if (!mongoose.isValidObjectId(userId)) {
          return res.status(400).json({
            message: 'Invalid student ID.'
          });
        }

        // Only allow supported account statuses
        const allowedStatuses = ['active', 'suspended', 'blocked'];

        if (
          typeof status !== 'string' ||
          !allowedStatuses.includes(status)
        ) {
          return res.status(400).json({
            message: 'Invalid account status.'
          });
        }
        // Require a reason for suspension or blocking
        const requiresReason =
          status === 'suspended' || status === 'blocked';

        const restrictionReason =
          typeof reason === 'string' ? reason.trim() : '';

        if (
          requiresReason &&
          (restrictionReason.length === 0 ||
            restrictionReason.length > 500)
        ) {
          return res.status(400).json({
            message: 'Please provide a reason between 1 and 500 characters.'
          });
        }
        // Update student accounts only
        const updatedUser = await User.findOneAndUpdate(
          {
            _id: userId,
            role: 'student'
          },
          {
          $set: {
            accountStatus: status,
            accountRestrictionReason: requiresReason
              ? restrictionReason
              : ''
          }
        },
          {
            new: true,
            runValidators: true
          }
        ).select(
          'username email role accountStatus accountRestrictionReason profileImage avatarStyle hobbies createdAt'
        );

        if (!updatedUser) {
          return res.status(404).json({
            message: 'Student account not found.'
          });
        }

  if (status === 'suspended' || status === 'blocked') {
    disconnectUserSockets(updatedUser._id);
  }

  // Record account management activity for admin notifications.
  try {
    const eventType =
      status === 'active' ? 'reactivated' : status;

    const actionTitle = {
      suspended: 'Student Account Suspended',
      blocked: 'Student Account Blocked',
      reactivated: 'Student Account Reactivated'
    };

    await Notification.create({

  audience: 'admin',
  adminEventType: eventType,
  actorId: getUserId(req.user),
  targetUserId: updatedUser._id,

      title: actionTitle[eventType],
      description: `${updatedUser.username || 'A student'}'s account was ${eventType}.`,
      reason: restrictionReason,
      isRead: false
    });
  } catch (notificationError) {
    console.error(
      'Failed to record admin account activity:',
      notificationError.message
    );
  }


        return res.status(200).json({
          success: true,
          message: `Student account status updated to ${status}.`,
          user: updatedUser
        });

      } catch (error) {
        console.error(
          'Admin account status update error:',
          error.message
        );

        return res.status(500).json({
          message: 'Failed to update student account status.'
        });
      }
    }
  );

  // ==========================================
  // GET ACCEPTED CONNECTIONS ONLY
  // Used by Messages.jsx
  // ==========================================

  app.get('/api/users', verifyToken, async (req, res) => {
    try {
      const currentUserId = getUserId(req.user);

      if (!isValidId(currentUserId)) {
        return res.status(401).json({
          message: 'Invalid user identity in authentication token.',
        });
      }

      const connections = await Connection.find({
        status: 'accepted',
        $or: [
          { requester: currentUserId },
          { recipient: currentUserId },
        ],
      })
        .select('requester recipient')
        .lean();

      const connectedUserIds = connections.map((connection) =>
        String(connection.requester) === currentUserId
          ? String(connection.recipient)
          : String(connection.requester)
      );

      if (connectedUserIds.length === 0) {
        return res.status(200).json([]);
      }

      const hiddenConversations = await HiddenConversation.find({
        user: currentUserId,
      })
        .select('otherUser')
        .lean();

      const hiddenUserIds = hiddenConversations.map((item) =>
        String(item.otherUser)
      );

      const excludedIds = [
        currentUserId,
        ...hiddenUserIds,
      ];

    const users = await User.find({
    _id: {
      $in: connectedUserIds,
      $nin: excludedIds,
    },
  })
    .select('fullName name username email role profileImage avatarStyle')
    .sort({ fullName: 1 })
    .lean();

      return res.status(200).json(
        users.map((user) => ({
          ...user,
          id: String(user._id),
          name:
    user.username ||
    user.fullName ||
    user.name ||
    user.email ||
    'User',
        }))
      );
    } catch (error) {
      console.error('Error fetching connected users:', error.message);

      return res.status(500).json({
        message: 'Failed to fetch connected users.',
      });
    }
  });

  // ==========================================
  // SEARCH ACCEPTED CONNECTIONS ONLY
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

      const connections = await Connection.find({
        status: 'accepted',
        $or: [
          { requester: currentUserId },
          { recipient: currentUserId },
        ],
      })
        .select('requester recipient')
        .lean();

      const connectedUserIds = connections.map((connection) =>
        String(connection.requester) === currentUserId
          ? String(connection.recipient)
          : String(connection.requester)
      );

      if (connectedUserIds.length === 0) {
        return res.status(200).json([]);
      }

      const filter = {
        _id: {
          $in: connectedUserIds,
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
      .select('fullName name username email role profileImage avatarStyle')
      .sort({ fullName: 1 })
      .limit(50)
      .lean();

      return res.status(200).json(
        users.map((user) => ({
          ...user,
          id: String(user._id),
          name:
    user.username ||
    user.fullName ||
    user.name ||
    user.email ||
    'User',
        }))
      );
    } catch (error) {
      console.error('Error searching connections:', error.message);

      return res.status(500).json({
        message: 'Failed to search connected users.',
      });
    }
  });

  // ==========================================
  // GET NOTIFICATIONS
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
          .populate('senderId', 'username profileImage avatarStyle')
          .sort({ createdAt: -1 })
          .lean();

        return res.status(200).json(
          notifications.map((notif) => ({
            ...notif,
            timeAgo: getNotificationTime(notif.createdAt),
          }))
        );
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
          { new: true }
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
            $set: { isRead: true },
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

        const notification = await Notification.findOne({
          _id: id,
          userId: currentUserId,
        });

        if (!notification) {
          return res.status(404).json({
            message: 'Notification not found.',
          });
        }

        // Update the connection record when responding to a
        // connection request notification.
        const isConnectionRequest =
          String(notification.type || '').toLowerCase().includes('connection') ||
          String(notification.type || '').toLowerCase().includes('friend');

        if (isConnectionRequest && notification.senderId) {
          const connection = await Connection.findOne({
            requester: notification.senderId,
            recipient: currentUserId,
          });

          if (connection) {
            connection.status = status;
            await connection.save();
          }
        }

        notification.status = status;
        notification.isRead = true;
        await notification.save();

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
  // ==========================================

  app.delete(
    '/api/conversations/:otherUserId',
    verifyToken,
    async (req, res) => {
      try {
        const currentUserId = getUserId(req.user);
        const { otherUserId } = req.params;

        if (!isValidId(currentUserId) || !isValidId(otherUserId)) {
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
  // CHAT HISTORY
  // Keep this in routes/messages.js
  // ==========================================

  // ==========================================
  // SOCKET.IO AUTHENTICATION
  // ==========================================

  const onlineUsers = new Map();
  // Disconnect all active sockets of a suspended or blocked user
  const disconnectUserSockets = (userId) => {
    const room = `user:${String(userId)}`;

    io.in(room).disconnectSockets(true);
  };

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    try {
      if (!process.env.JWT_SECRET) {
  return next(new Error('JWT configuration is missing.'));
}

const decoded = jwt.verify(
  token,
  process.env.JWT_SECRET
);
      const userId = getUserId(decoded);

      if (!isValidId(userId)) {
        return next(new Error('Invalid user identity.'));
      }

      const user = await User.findById(userId)
        .select('role accountStatus')
        .lean();

      if (!user) {
        return next(new Error('User account not found.'));
      }

      if (user.accountStatus === 'suspended') {
        return next(new Error('Your account has been suspended.'));
      }

      if (user.accountStatus === 'blocked') {
        return next(new Error('Your account has been blocked.'));
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

      // ==========================================
    // GROUP CHAT - JOIN PROJECT ROOM
    // PROJECT OWNER AND MEMBERS ONLY
    // ==========================================

    socket.on('join_project_chat', async (payload, callback) => {
      try {
        const projectId = String(payload?.projectId || '');

        if (!isValidId(projectId)) {
          return callback?.({
            success: false,
            message: 'Invalid project ID.',
          });
        }

        const project = await Project.findById(projectId)
          .select('owner members')
          .lean();

        if (!project) {
          return callback?.({
            success: false,
            message: 'Project not found.',
          });
        }

        const isOwner = String(project.owner) === userId;

        const isMember = (project.members || []).some(
          (member) => String(member) === userId
        );

        if (!isOwner && !isMember) {
          return callback?.({
            success: false,
            message: 'Only project members can join this group chat.',
          });
        }

        const roomName = `project:${projectId}`;

        await socket.join(roomName);

        return callback?.({
          success: true,
          message: 'Joined project group chat.',
          projectId,
        });
      } catch (error) {
        console.error('Join project chat error:', error.message);

        return callback?.({
          success: false,
          message: 'Failed to join project group chat.',
        });
      }
    });

    // ==========================================
    // GROUP CHAT - LEAVE PROJECT ROOM
    // ==========================================

    socket.on('leave_project_chat', async (payload, callback) => {
      try {
        const projectId = String(payload?.projectId || '');

        if (!isValidId(projectId)) {
          return callback?.({
            success: false,
            message: 'Invalid project ID.',
          });
        }

        await socket.leave(`project:${projectId}`);

        return callback?.({
          success: true,
          projectId,
        });
      } catch (error) {
        console.error('Leave project chat error:', error.message);

        return callback?.({
          success: false,
          message: 'Failed to leave project group chat.',
        });
      }
    });

    io.emit('get_online_users', Array.from(onlineUsers.keys()));

    // ==========================================
    // SEND MESSAGE
    // Only accepted connections can chat
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

        const acceptedConnection = await Connection.exists({
          status: 'accepted',
          $or: [
            {
              requester: userId,
              recipient: recipientId,
            },
            {
              requester: recipientId,
              recipient: userId,
            },
          ],
        });

        if (!acceptedConnection) {
          return callback?.({
            success: false,
            message: 'You can only message accepted connections.',
          });
        }

        const newMessage = await Message.create({
          sender: userId,
          recipient: recipientId,
          text,
        });

        const messageData = newMessage.toObject();

        // Restore conversation visibility after a new message.
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

        io.to(`user:${userId}`).emit('conversation_restored', {
          otherUserId: recipientId,
        });

        io.to(`user:${recipientId}`).emit('conversation_restored', {
          otherUserId: userId,
        });

        // Create a notification for the recipient.
        try {
          const sender = await User.findById(userId)
            .select('fullName name username')
            .lean();

          const senderName =
    sender?.username ||
    sender?.fullName ||
    sender?.name ||
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

          io.to(`user:${recipientId}`).emit('new_notification', {
            ...notification.toObject(),
            timeAgo: 'Just now',
          });
        } catch (notificationError) {
          console.error(
            'Error creating notification:',
            notificationError.message
          );
        }

        io.to(`user:${recipientId}`).emit(
          'receive_message',
          messageData
        );

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
