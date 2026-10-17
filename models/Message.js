const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    // Messages hidden from specific users
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // Tracks whether the recipient has read the message
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Existing indexes
messageSchema.index({
  sender: 1,
  recipient: 1,
  createdAt: 1,
});

messageSchema.index({
  recipient: 1,
  sender: 1,
  createdAt: 1,
});

messageSchema.index({
  deletedFor: 1,
});

// Index for unread message counts
messageSchema.index({
  recipient: 1,
  isRead: 1,
  createdAt: -1,
});

module.exports = mongoose.model('Message', messageSchema);