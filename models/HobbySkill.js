const mongoose = require("mongoose");

const hobbySkillSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },

    type: {
      type: String,
      required: true,
      enum: ["Hobby", "Skill"]
    },

    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },

    icon: {
      type: String,
      default: "🎯"
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate names within the same type
hobbySkillSchema.index(
  { name: 1, type: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("HobbySkill", hobbySkillSchema);