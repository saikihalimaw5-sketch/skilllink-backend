const mongoose = require('mongoose');

const joinRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'Rejected'],
      default: 'Pending'
    },

    requestedAt: {
      type: Date,
      default: Date.now
    },

    respondedAt: {
      type: Date,
      default: null
    }
  },
  {
    _id: true
  }
);

const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      required: true,
      trim: true
    },

    category: {
      type: String,
      required: true,
      trim: true
    },

    skillsNeeded: {
      type: [String],
      default: []
    },

    scheduleDate: {
      type: Date,
      default: null
    },

    scheduleTime: {
      type: String,
      default: ''
    },

    status: {
      type: String,
      enum: ['Active', 'Completed', 'Archived'],
      default: 'Active'
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],

    // Join requests do not become members until accepted.
    joinRequests: {
      type: [joinRequestSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Project', projectSchema);