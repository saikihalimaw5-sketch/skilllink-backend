
const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    reportType: {
      type: String,
      enum: [
        "Technical Issue",
        "User Complaint",
        "Project Issue",
      ],
      required: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },


description: {
  type: String,
  required: false,
  trim: true,
  default: "",
  maxlength: 300
},


    status: {
      type: String,
      enum: ["Pending", "Resolved", "Dismissed"],
      default: "Pending",
    },

    adminResponse: {
      type: String,
      trim: true,
      default: "",
    },

    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);
