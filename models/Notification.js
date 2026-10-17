const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
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