
const mongoose = require('mongoose');

const projectMessageSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
   readBy: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
],

hiddenFor: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
],
  },
  { timestamps: true }
);

projectMessageSchema.index({ project: 1, createdAt: 1 });

module.exports = mongoose.model(
  'ProjectMessage',
  projectMessageSchema
);
