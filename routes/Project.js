
const express = require('express');
const mongoose = require('mongoose');
const Project = require('../models/project');
const { verifyToken } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const ProjectMessage = require('../models/ProjectMessage');
const router = express.Router();

router.use(verifyToken);

function getUserId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.user?.userId ||
    req.user?.sub
  );
}

function isValidId(id) {
  return Boolean(id) && mongoose.Types.ObjectId.isValid(id);
}

function sameId(first, second) {
  return String(first) === String(second);
}

function populateProject(query) {
  return query
    .populate(
      'owner',
      'fullName username email profileImage avatarStyle'
    )
    .populate(
      'members',
      'fullName username email profileImage avatarStyle'
    )
    .populate(
      'joinRequests.user',
      'fullName username email profileImage avatarStyle'
    );
}

// ==========================================
// GET MY PROJECTS
// ==========================================

router.get('/my', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user account.'
      });
    }

    const projects = await populateProject(
      Project.find({ owner: userId }).sort({ createdAt: -1 })
    );

    return res.json(projects);
  } catch (error) {
    console.error('Load my projects error:', error);

    return res.status(500).json({
      message: 'Failed to load your projects.'
    });
  }
});

// ==========================================
// DISCOVER ACTIVE PROJECTS
// ==========================================

router.get('/discover', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user account.'
      });
    }

    const projects = await populateProject(
      Project.find({
        status: 'Active',
        owner: { $ne: userId }
      }).sort({ createdAt: -1 })
    );

    return res.json(projects);
  } catch (error) {
    console.error('Discover projects error:', error);

    return res.status(500).json({
      message: 'Failed to discover projects.'
    });
  }
});

// ==========================================
// GET PROJECT DETAILS
// ==========================================

router.get('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid project ID.'
      });
    }

    const project = await populateProject(Project.findById(id));

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(
      project.owner?._id || project.owner,
      userId
    );

    if (!isOwner) {
      project.joinRequests = project.joinRequests.filter(
        (request) =>
          sameId(request.user?._id || request.user, userId)
      );
    }

    return res.json(project);
  } catch (error) {
    console.error('Get project error:', error);

    return res.status(500).json({
      message: 'Failed to load project.'
    });
  }
});

// ==========================================
// CREATE PROJECT
// ==========================================

router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user account.'
      });
    }

    const {
      title,
      description,
      category,
      skillsNeeded,
      scheduleDate,
      scheduleTime
    } = req.body;

    if (
      typeof title !== 'string' ||
      !title.trim() ||
      typeof description !== 'string' ||
      !description.trim() ||
      typeof category !== 'string' ||
      !category.trim()
    ) {
      return res.status(400).json({
        message: 'Title, description, and category are required.'
      });
    }

    const project = await Project.create({
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      skillsNeeded: Array.isArray(skillsNeeded)
        ? skillsNeeded
            .filter((skill) => typeof skill === 'string')
            .map((skill) => skill.trim())
            .filter(Boolean)
        : [],
      scheduleDate: scheduleDate || null,
      scheduleTime:
        typeof scheduleTime === 'string' ? scheduleTime : '',
      owner: userId,
      members: [userId],
      joinRequests: []
    });

    const savedProject = await populateProject(
      Project.findById(project._id)
    );

    return res.status(201).json(savedProject);
  } catch (error) {
    console.error('Create project error:', error);

    return res.status(500).json({
      message: 'Failed to create project.'
    });
  }
});

// ==========================================
// REQUEST TO JOIN
// ==========================================

router.post('/:id/join', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    if (project.status !== 'Active') {
      return res.status(400).json({
        message: 'This project is not active.'
      });
    }

    if (sameId(project.owner, userId)) {
      return res.status(400).json({
        message: 'You already own this project.'
      });
    }

    if (project.members.some((member) => sameId(member, userId))) {
      return res.status(400).json({
        message: 'You are already a member of this project.'
      });
    }

    const existingRequest = project.joinRequests.find(
      (request) => sameId(request.user, userId)
    );

    if (existingRequest?.status === 'Pending') {
      return res.status(409).json({
        message: 'Your join request is already pending.',
        status: 'Pending'
      });
    }

    if (existingRequest?.status === 'Accepted') {
      return res.status(400).json({
        message: 'You have already been accepted into this project.'
      });
    }

    if (existingRequest) {
      existingRequest.status = 'Pending';
      existingRequest.requestedAt = new Date();
      existingRequest.respondedAt = null;
    } else {
      project.joinRequests.push({
        user: userId,
        status: 'Pending',
        requestedAt: new Date()
      });
    }

    await project.save();

    const savedRequest = project.joinRequests.find(
      (request) => sameId(request.user, userId)
    );

    const notification = await Notification.create({
      userId: project.owner,
      senderId: userId,
      type: 'Project',
      title: 'New Project Join Request',
      description: `Someone requested to join "${project.title}".`,
      status: 'pending',
      isRead: false,
      projectId: project._id,
      requestId: savedRequest._id
    });

    const io = req.app.get('io');

    if (io) {
      io.to(`user:${String(project.owner)}`).emit(
        'new_notification',
        notification
      );

      io.to(`user:${String(project.owner)}`).emit(
        'project_join_request_created',
        {
          projectId: String(project._id),
          requestId: String(savedRequest._id),
          requesterId: String(userId),
          status: 'Pending'
        }
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Join request sent. Wait for the project owner to respond.',
      status: 'Pending',
      projectId: project._id
    });
  } catch (error) {
    console.error('Request to join error:', error);

    return res.status(500).json({
      message: 'Failed to send join request.'
    });
  }
});

// ==========================================
// CANCEL PROJECT JOIN REQUEST
// REQUESTER ONLY
// ==========================================

router.delete(
  '/:id/join-requests/:requestId/cancel',
  async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id, requestId } = req.params;

      if (
        !isValidId(userId) ||
        !isValidId(id) ||
        !isValidId(requestId)
      ) {
        return res.status(400).json({
          message: 'Invalid user, project, or request ID.'
        });
      }

      const project = await Project.findById(id);

      if (!project) {
        return res.status(404).json({
          message: 'Project not found.'
        });
      }

      const joinRequest = project.joinRequests.id(requestId);

      if (
        !joinRequest ||
        !sameId(joinRequest.user, userId)
      ) {
        return res.status(404).json({
          message: 'Your project join request was not found.'
        });
      }

      if (joinRequest.status !== 'Pending') {
        return res.status(409).json({
          message: 'Only pending join requests can be cancelled.'
        });
      }

      const savedRequestId = String(joinRequest._id);
      const projectId = String(project._id);
      const ownerId = String(project.owner);
      const requesterId = String(userId);

      project.joinRequests.pull({ _id: requestId });

      await project.save();

      await Notification.updateMany(
        {
          type: 'Project',
          projectId: project._id,
          requestId: savedRequestId,
          userId: project.owner,
          status: 'pending'
        },
        {
          $set: {
            status: 'cancelled',
            isRead: true
          }
        }
      );

      const io = req.app.get('io');

      if (io) {
        io.to(`user:${ownerId}`).emit(
          'project_join_request_cancelled',
          {
            projectId,
            requestId: savedRequestId,
            requesterId
          }
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Project join request cancelled successfully.',
        projectId,
        requestId: savedRequestId
      });
    } catch (error) {
      console.error('Cancel project join request error:', error);

      return res.status(500).json({
        message: 'Failed to cancel project join request.'
      });
    }
  }
);

// ==========================================
// GET PENDING JOIN REQUESTS
// OWNER ONLY
// ==========================================

router.get('/:id/requests', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    const project = await Project.findById(id)
  .populate(
    'joinRequests.user',
    'fullName username email profileImage avatarStyle'
  );

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    if (!sameId(project.owner, userId)) {
      return res.status(403).json({
        message: 'Only the project owner can view join requests.'
      });
    }

    const pendingRequests = project.joinRequests.filter(
      (request) => request.status === 'Pending'
    );

    return res.json({
      projectId: project._id,
      projectTitle: project.title,
      requests: pendingRequests
    });
  } catch (error) {
    console.error('Get join requests error:', error);

    return res.status(500).json({
      message: 'Failed to load join requests.'
    });
  }
});

// ==========================================
// ACCEPT OR REJECT JOIN REQUEST
// OWNER ONLY
// ==========================================

router.patch('/:id/requests/:requestId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, requestId } = req.params;
    const { decision } = req.body;

    if (
      !isValidId(userId) ||
      !isValidId(id) ||
      !isValidId(requestId)
    ) {
      return res.status(400).json({
        message: 'Invalid user, project, or request ID.'
      });
    }

    if (!['Accept', 'Reject'].includes(decision)) {
      return res.status(400).json({
        message: 'Decision must be Accept or Reject.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    if (!sameId(project.owner, userId)) {
      return res.status(403).json({
        message: 'Only the project owner can respond to requests.'
      });
    }

    const joinRequest = project.joinRequests.id(requestId);

    if (!joinRequest) {
      return res.status(404).json({
        message: 'Join request not found.'
      });
    }

    if (joinRequest.status !== 'Pending') {
      return res.status(409).json({
        message: `This request has already been ${joinRequest.status.toLowerCase()}.`
      });
    }

    if (decision === 'Accept') {
      if (project.status !== 'Active') {
        return res.status(400).json({
          message: 'Only active projects can accept new members.'
        });
      }

      const alreadyMember = project.members.some((member) =>
        sameId(member, joinRequest.user)
      );

      if (!alreadyMember) {
        project.members.push(joinRequest.user);
      }

      joinRequest.status = 'Accepted';
    } else {
      joinRequest.status = 'Rejected';
    }

    joinRequest.respondedAt = new Date();

    await project.save();

    const notificationStatus =
      decision === 'Accept' ? 'accepted' : 'declined';

    await Notification.findOneAndUpdate(
      {
        type: 'Project',
        projectId: project._id,
        requestId: joinRequest._id,
        userId: project.owner
      },
      {
        $set: {
          status: notificationStatus,
          isRead: true
        }
      },
      { new: true }
    );

    const updatedProject = await populateProject(
      Project.findById(project._id)
    );

    const io = req.app.get('io');

    if (io) {
      const projectId = String(project._id);
      const requesterId = String(joinRequest.user);

      const eventData = {
        projectId,
        requestId: String(joinRequest._id),
        requesterId,
        decision,
        requestStatus: joinRequest.status,
        members: updatedProject.members,
        memberCount: updatedProject.members.length
      };

      // Notify the project owner.
      io.to(`user:${String(project.owner)}`).emit(
        'project_join_request_updated',
        eventData
      );

      // Notify the requester.
      io.to(`user:${requesterId}`).emit(
        'project_join_request_updated',
        eventData
      );
    }

    return res.json({
      success: true,
      message:
        decision === 'Accept'
          ? 'Join request accepted. The user is now a project member.'
          : 'Join request rejected.',
      requestStatus: joinRequest.status,
      project: updatedProject
    });
  } catch (error) {
    console.error('Accept or reject join request error:', error);

    return res.status(500).json({
      message: 'Failed to update join request.'
    });
  }
});

// ==========================================
// UPDATE PROJECT STATUS
// OWNER ONLY
// ==========================================

router.patch('/:id/status', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    if (!['Active', 'Completed', 'Archived'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid project status.'
      });
    }
    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    if (!sameId(project.owner, userId)) {
      return res.status(403).json({
        message: 'Only the project owner can update its status.'
      });
    }

    project.status = status;

    await project.save();

    const updatedProject = await populateProject(
      Project.findById(project._id)
    );

    return res.json({
      success: true,
      message: 'Project status updated successfully.',
      project: updatedProject
    });
  } catch (error) {
    console.error('Update project status error:', error);

    return res.status(500).json({
      message: 'Failed to update project status.'
    });
  }
});

// ==========================================
// DELETE PROJECT
// OWNER ONLY
// ==========================================

router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    if (!sameId(project.owner, userId)) {
      return res.status(403).json({
        message: 'Only the project owner can delete this project.'
      });
    }

    await Notification.updateMany(
      {
        type: 'Project',
        projectId: project._id,
        status: 'pending'
      },
      {
        $set: {
          status: 'cancelled',
          isRead: true
        }
      }
    );

    await Project.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: 'Project deleted successfully.'
    });
  } catch (error) {
    console.error('Delete project error:', error);

    return res.status(500).json({
      message: 'Failed to delete project.'
    });
  }
});
// ==========================================
// GET UNREAD PROJECT MESSAGES
// ==========================================
router.get('/messages/unread', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!isValidId(userId)) {
      return res.status(401).json({
        message: 'Invalid user account.'
      });
    }

    const projects = await Project.find({
      $or: [
        { owner: userId },
        { members: userId }
      ]
    }).select('_id title status');

    const projectIds = projects.map((project) => project._id);

    const unreadMessages = await ProjectMessage.find({
      project: { $in: projectIds },
      sender: { $ne: userId },
      readBy: { $ne: userId },
      hiddenFor: { $ne: userId }
    })
      .select('project createdAt')
      .sort({ createdAt: -1 });

    const unreadProjects = projects
      .map((project) => ({
        projectId: project._id,
        title: project.title,
        status: project.status,
        unreadCount: unreadMessages.filter(
          (message) =>
            String(message.project) === String(project._id)
        ).length
      }))
.filter((project) => project.unreadCount > 0)
.sort((a, b) => {
  const latestA = unreadMessages.find(
    (msg) => String(msg.project) === String(a.projectId)
  );

  const latestB = unreadMessages.find(
    (msg) => String(msg.project) === String(b.projectId)
  );

  return new Date(latestB?.createdAt || 0) -
         new Date(latestA?.createdAt || 0);
});
    return res.json({
      projectMessages: unreadMessages.length,
      unreadProjects
    });
  } catch (error) {
    console.error('Unread project messages error:', error);

    return res.status(500).json({
      message: 'Failed to load unread project messages.'
    });
  }
});
// ==========================================
// GROUP CHAT - GET PROJECT MESSAGES
// PROJECT OWNER AND MEMBERS ONLY
// ==========================================

router.get('/:id/messages', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(project.owner, userId);
    const isMember = project.members.some((member) =>
      sameId(member, userId)
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        message: 'Only project members can access this group chat.'
      });
    }

        const messages = await ProjectMessage.find({
        project: id,
        hiddenFor: { $ne: userId },
      })
        .populate(
        'sender',
        'fullName username email profileImage avatarStyle'
      )
        .sort({ createdAt: 1 });
await ProjectMessage.updateMany(
  {
    project: id,
    _id: { $in: messages.map((msg) => msg._id) },
    sender: { $ne: userId },
    readBy: { $ne: userId }
  },
  {
    $addToSet: { readBy: userId }
  }
);
    return res.json(messages);
  } catch (error) {
    console.error('Get project messages error:', error);

    return res.status(500).json({
      message: 'Failed to load group chat messages.'
    });
  }
});

// ==========================================
// GROUP CHAT - SEND PROJECT MESSAGE
// PROJECT OWNER AND MEMBERS ONLY
// ==========================================

router.post('/:id/messages', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { message } = req.body;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        message: 'Message cannot be empty.'
      });
    }

    if (message.trim().length > 2000) {
      return res.status(400).json({
        message: 'Message cannot exceed 2000 characters.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(project.owner, userId);
    const isMember = project.members.some((member) =>
      sameId(member, userId)
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        message: 'Only project members can send messages.'
      });
    }

    const savedMessage = await ProjectMessage.create({
  project: project._id,
  sender: userId,
  message: message.trim(),
  readBy: [userId]
});

    const populatedMessage = await ProjectMessage.findById(
  savedMessage._id
).populate(
  'sender',
  'fullName username email profileImage avatarStyle'
);

    const io = req.app.get('io');

    if (io) {
      io.to(`project:${String(project._id)}`).emit(
        'project_message_created',
        populatedMessage
      );
    }

    return res.status(201).json(populatedMessage);
  } catch (error) {
    console.error('Send project message error:', error);

    return res.status(500).json({
      message: 'Failed to send group chat message.'
    });
  }
});

// ==========================================
// GROUP CHAT - DELETE FOR ME
// OWN MESSAGE ONLY
// ==========================================

router.delete('/:id/messages/:messageId/for-me', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, messageId } = req.params;

    if (!isValidId(userId) || !isValidId(id) || !isValidId(messageId)) {
      return res.status(400).json({
        message: 'Invalid user, project, or message ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(project.owner, userId);
    const isMember = project.members.some((member) =>
      sameId(member, userId)
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        message: 'Only project members can delete messages.'
      });
    }

    const updatedMessage = await ProjectMessage.findOneAndUpdate(
      {
        _id: messageId,
        project: id,
        sender: userId
      },
      {
        $addToSet: { hiddenFor: userId }
      },
      { new: true }
    );

    if (!updatedMessage) {
      return res.status(404).json({
        message: 'Message not found or you cannot delete it.'
      });
    }

    return res.json({
      success: true,
      message: 'Message deleted for you.',
      messageId
    });

  } catch (error) {
    console.error('Delete for me error:', error);

    return res.status(500).json({
      message: 'Failed to delete message for you.'
    });
  }
});
// GROUP CHAT - DELETE FOR EVERYONE
// OWN MESSAGE ONLY


router.delete('/:id/messages/:messageId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id, messageId } = req.params;

    if (
      !isValidId(userId) ||
      !isValidId(id) ||
      !isValidId(messageId)
    ) {
      return res.status(400).json({
        message: 'Invalid user, project, or message ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(project.owner, userId);
    const isMember = project.members.some((member) =>
      sameId(member, userId)
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        message: 'Only project members can delete messages.'
      });
    }

    const deletedMessage = await ProjectMessage.findOneAndDelete({
      _id: messageId,
      project: id,
      sender: userId
    });

    if (!deletedMessage) {
      return res.status(404).json({
        message: 'Message not found or you cannot delete it.'
      });
    }

    const io = req.app.get('io');

    if (io) {
      io.to(`project:${String(project._id)}`).emit(
        'project_message_deleted',
        {
          projectId: String(project._id),
          messageId: String(messageId)
        }
      );
    }

    return res.json({
      success: true,
      message: 'Message deleted successfully.',
      messageId
    });
  } catch (error) {
    console.error('Delete project message error:', error);

    return res.status(500).json({
      message: 'Failed to delete message.'
    });
  }
});


// ==========================================
// GROUP CHAT - CLEAR CONVERSATION
// DELETE /api/projects/:id/messages
// ==========================================

router.delete('/:id/messages', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    if (!isValidId(userId) || !isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid user or project ID.'
      });
    }

    const project = await Project.findById(id);

    if (!project) {
      return res.status(404).json({
        message: 'Project not found.'
      });
    }

    const isOwner = sameId(project.owner, userId);
    const isMember = project.members.some((member) =>
      sameId(member, userId)
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        message: 'Only project members can clear conversations.'
      });
    }

    const result = await ProjectMessage.updateMany(
      {
        project: id,
        hiddenFor: { $ne: userId }
      },
      {
        $addToSet: {
          hiddenFor: userId
        }
      }
    );

    return res.json({
      success: true,
      message: 'Conversation cleared successfully.',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Clear project conversation error:', error);

    return res.status(500).json({
      message: 'Failed to clear conversation.'
    });
  }
});


module.exports = router;
