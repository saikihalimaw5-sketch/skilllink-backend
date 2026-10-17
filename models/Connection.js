
const mongoose = require('mongoose');

const connectionSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
      index: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent duplicate requests in the same direction
connectionSchema.index(
  { requester: 1, recipient: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.Connection ||
  mongoose.model('Connection', connectionSchema);
