const mongoose = require('mongoose');


const notificationSchema = new mongoose.Schema(
  {

    // ADMIN NOTIFICATIONS
    audience: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true
    },

    adminEventType: {
      type: String,
      enum: [
        'registration',
        'project',
        'report',
        'support',
        'suspended',
        'blocked',
        'reactivated'
      ],
      default: null
    },

    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },


    reason: {
      type: String,
      default: ''
    },


userId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: function () {
    return this.audience !== 'admin';
  },
  default: null,
  index: true
},



senderId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: function () {
    return this.audience !== 'admin';
  },
  default: null
},


    type: {
      type: String,
      enum: ['Message', 'Request', 'Project', 'Connection'],
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

    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },

    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

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

module.exports =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);